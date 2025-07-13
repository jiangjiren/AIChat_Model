// 配置
const CONFIG = {
    API_URL: 'https://api.laozhang.ai/v1/chat/completions',
    API_KEY: '', // 将在初始化时从 localStorage 获取
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
};

// 全局变量
let chatHistory = [];
let isWaitingForResponse = false;
let streamController = null; // 新增：用于中止流式请求
let activeRequestControllers = []; // 用于管理多个并行请求的 AbortController

// --- 新增：自定义模型选择器所需变量 ---
const MAX_MODELS_SELECTABLE = 3;
const availableModels = [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-sonnet-4-20250514-thinking', name: 'Claude Sonnet 4 (Thinking)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'deepseek-v3', name: 'DeepSeek V3' },
    { id: 'deepseek-r1', name: 'DeepSeek R1' }
];
let selectedModels = ['gpt-4o']; // 默认选择的模型

// DOM 元素
const elements = {
    chatMessages: document.getElementById('chat-messages'),
    messageInput: document.getElementById('message-input'),
    sendButton: document.getElementById('send-button'),
    modelSelect: document.getElementById('custom-model-select'), // 更新为自定义选择器的容器
    modelSelectHeader: document.getElementById('model-select-header'),
    modelSelectList: document.getElementById('model-select-list'),
    modelSelectText: document.querySelector('#model-select-header .select-text'),
    loadingOverlay: document.getElementById('loading-overlay'),
    charCount: document.getElementById('char-count'),
    newChatButton: document.getElementById('new-chat-button'),
    // --- 新增：设置弹窗元素 ---
    settingsButton: document.getElementById('settings-button'),
    settingsModal: document.getElementById('settings-modal'),
    apiKeyInput: document.getElementById('api-key-input'),
    saveSettingsButton: document.getElementById('save-settings-button'),
    cancelSettingsButton: document.getElementById('cancel-settings-button')
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 优先从 localStorage 加载 API Key
    const savedApiKey = localStorage.getItem('laozhang_api_key');
    if (savedApiKey) {
        CONFIG.API_KEY = savedApiKey;
        elements.apiKeyInput.value = savedApiKey;
    }

    if (!CONFIG.API_KEY) {
        showMissingConfigWarning();
    }
    initializeApp();
});

function showMissingConfigWarning() {
    const warningElement = document.createElement('div');
    warningElement.className = 'config-warning';
    warningElement.innerHTML = `
        <strong>配置警告:</strong> 未设置 API 密钥。请点击右下角的 <i class="fas fa-cog"></i> 按钮进行设置。
    `;
    document.body.prepend(warningElement);
    
    // 禁用输入功能
    elements.messageInput.disabled = true;
    elements.sendButton.disabled = true;
    elements.modelSelect.classList.add('disabled'); // 使用class来禁用自定义选择器
    elements.messageInput.placeholder = '请先设置 API Key';
}

function initializeApp() {
    setupEventListeners();
    setupCustomModelSelect(); // 新增：初始化自定义选择器
    adjustTextareaHeight();
    updateCharCount();
}

function setupEventListeners() {
    // 发送按钮点击事件
    elements.sendButton.addEventListener('click', handleSendOrStop);
    
    // 输入框回车事件
    elements.messageInput.addEventListener('keydown', handleKeyDown);
    
    // 输入框内容变化事件
    elements.messageInput.addEventListener('input', function() {
        adjustTextareaHeight();
        updateCharCount();
    });
    
    // 新建对话按钮点击事件
    elements.newChatButton.addEventListener('click', handleNewChat);

    // --- 新增：设置弹窗事件 ---
    elements.settingsButton.addEventListener('click', () => {
        elements.settingsModal.style.display = 'flex';
    });

    elements.cancelSettingsButton.addEventListener('click', () => {
        elements.settingsModal.style.display = 'none';
    });

    elements.saveSettingsButton.addEventListener('click', () => {
        const newApiKey = elements.apiKeyInput.value.trim();
        if (newApiKey) {
            CONFIG.API_KEY = newApiKey;
            localStorage.setItem('laozhang_api_key', newApiKey);
            elements.settingsModal.style.display = 'none';
            
            // 如果之前因为没有key而禁用了，现在就启用它们
            if (elements.messageInput.disabled) {
                elements.messageInput.disabled = false;
                elements.sendButton.disabled = false;
                elements.modelSelect.classList.remove('disabled');
                elements.messageInput.placeholder = '输入您的消息...';
                
                // 移除顶部的警告信息
                const warning = document.querySelector('.config-warning');
                if (warning) {
                    warning.remove();
                }
            }
        } else {
            alert('API Key 不能为空。');
        }
    });

    // --- 新增：自定义模型选择器事件 ---
    elements.modelSelectHeader.addEventListener('click', () => {
        // 如果选择器被禁用，则不响应点击
        if(elements.modelSelect.classList.contains('disabled')) return;
        elements.modelSelect.classList.toggle('open');
    });

    // 点击外部关闭下拉列表
    document.addEventListener('click', (e) => {
        if (!elements.modelSelect.contains(e.target)) {
            elements.modelSelect.classList.remove('open');
        }
    });
}

function setupCustomModelSelect() {
    elements.modelSelectList.innerHTML = ''; // 清空
    availableModels.forEach(model => {
        const item = document.createElement('div');
        item.className = 'select-list-item';
        item.dataset.value = model.id;
        item.innerHTML = `
            <input type="checkbox" id="model-${model.id}" ${selectedModels.includes(model.id) ? 'checked' : ''}>
            <label for="model-${model.id}">${model.name}</label>
        `;
        elements.modelSelectList.appendChild(item);

        item.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止点击穿透到外部关闭事件
            const checkbox = item.querySelector('input[type="checkbox"]');
            
            // 如果点击的是label，手动切换checkbox状态
            if (e.target.tagName === 'LABEL') {
                checkbox.checked = !checkbox.checked;
            }

            const isChecked = checkbox.checked;
            const modelId = item.dataset.value;

            if (isChecked && selectedModels.length >= MAX_MODELS_SELECTABLE) {
                checkbox.checked = false; // 阻止选择
                alert(`最多只能选择 ${MAX_MODELS_SELECTABLE} 个模型`);
                return;
            }

            updateSelectedModels(modelId, isChecked);
        });
    });
    updateModelSelectUI();
}

function updateSelectedModels(modelId, isSelected) {
    if (isSelected) {
        if (!selectedModels.includes(modelId)) {
            selectedModels.push(modelId);
        }
    } else {
        selectedModels = selectedModels.filter(id => id !== modelId);
    }
    updateModelSelectUI();
}

function updateModelSelectUI() {
    // 更新头部显示
    if (selectedModels.length === 0) {
        elements.modelSelectText.textContent = '- 请选择模型 -';
    } else {
        elements.modelSelectText.textContent = selectedModels.map(id => getModelDisplayName(id)).join(', ');
    }

    // 更新列表项状态
    const items = elements.modelSelectList.querySelectorAll('.select-list-item');
    const limitReached = selectedModels.length >= MAX_MODELS_SELECTABLE;

    items.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!checkbox.checked && limitReached) {
            item.classList.add('disabled');
            checkbox.disabled = true;
        } else {
            item.classList.remove('disabled');
            checkbox.disabled = false;
        }
    });
}


function handleSendOrStop() {
    if (isWaitingForResponse) {
        handleStopGeneration();
    } else {
        handleSendMessage();
    }
}

function handleStopGeneration() {
    if (streamController) {
        streamController.abort();
        console.log('用户中止了AI回复');
    }
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
    }
}

function adjustTextareaHeight() {
    const textarea = elements.messageInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function updateCharCount() {
    const count = elements.messageInput.value.length;
    elements.charCount.textContent = count;
    
    // 字符数颜色变化
    if (count > 3500) {
        elements.charCount.style.color = 'var(--error-color)';
    } else if (count > 3000) {
        elements.charCount.style.color = 'var(--secondary-color)';
    } else {
        elements.charCount.style.color = 'var(--text-light)';
    }
}

function handleNewChat() {
    startNewChat();
}

function startNewChat() {
    // 清空聊天历史
    chatHistory = [];
    
    // 重置聊天界面
    elements.chatMessages.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-icon">
                <i class="fas fa-comments"></i>
            </div>
            <h3>欢迎使用 AI 聊天助手</h3>
            <p>选择您喜欢的AI模型，开始愉快的对话吧！</p>
        </div>
    `;
    
    // 重置输入框
    elements.messageInput.value = '';
    updateCharCount();
    adjustTextareaHeight();
    
    console.log('新对话已开始');
}

async function handleSendMessage() {
    const message = elements.messageInput.value.trim();

    if (!message || isWaitingForResponse || selectedModels.length === 0) {
        if (selectedModels.length === 0) {
            alert('请至少选择一个模型');
        }
        return;
    }

    isWaitingForResponse = true; // 设置全局等待状态
    // 为本次所有请求创建一个总的 AbortController
    streamController = new AbortController();

    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }

    addMessage('user', message);
    elements.messageInput.value = '';
    updateCharCount();
    adjustTextareaHeight();
    setInputDisabled(true);

    // 创建一个包含所有模型回答的容器
    createMultiResponseContainer(selectedModels);
    
    // 为每个选定的模型启动一个并行的聊天请求
    const chatPromises = selectedModels.map(modelId => {
        const multiResponseContainer = document.querySelector('.multi-response:last-child');
        const singleResponseContainer = multiResponseContainer.querySelector(`.response-container[data-model="${modelId}"]`);
        return handleSingleChatRequest(modelId, message, singleResponseContainer);
    });

    try {
        await Promise.all(chatPromises);
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('处理多个请求时发生意外错误:', error);
            // 可以在这里添加一个总的错误提示
        }
    } finally {
        setInputDisabled(false);
        streamController = null;
        activeRequestControllers = []; // 清空控制器
        console.log("所有模型响应结束");
    }
}

function createMultiResponseContainer(modelIds) {
    const multiContainer = document.createElement('div');
    multiContainer.className = 'message assistant multi-response';

    const gridContainer = document.createElement('div');
    gridContainer.className = 'responses-grid';
    gridContainer.style.gridTemplateColumns = `repeat(${modelIds.length}, 1fr)`;

    modelIds.forEach(modelId => {
        const responseContainer = document.createElement('div');
        responseContainer.className = 'response-container';
        responseContainer.setAttribute('data-model', modelId);

        const modelHeader = document.createElement('div');
        modelHeader.className = 'response-header';
        modelHeader.innerHTML = `
            <span class="model-name">${getModelDisplayName(modelId)}</span>
            <div class="response-actions">
                <button class="copy-button" title="复制"><i class="fas fa-copy"></i></button>
            </div>
        `;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        const thinkingElement = document.createElement('div');
        thinkingElement.className = 'thinking-animation';
        thinkingElement.innerHTML = '<div class="spinner"></div>';
        
        messageContent.appendChild(thinkingElement);
        responseContainer.appendChild(modelHeader);
        responseContainer.appendChild(messageContent);
        gridContainer.appendChild(responseContainer);
    });

    multiContainer.appendChild(gridContainer);
    elements.chatMessages.appendChild(multiContainer);
    scrollToBottom();
    
    // 为复制按钮添加事件监听
    multiContainer.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const content = e.target.closest('.response-container').querySelector('.message-text').innerText;
            navigator.clipboard.writeText(content).then(() => {
                const icon = e.target.closest('.copy-button').querySelector('i');
                icon.className = 'fas fa-check';
                setTimeout(() => {
                    icon.className = 'fas fa-copy';
                }, 1500);
            });
        });
    });


    return multiContainer;
}

async function handleSingleChatRequest(modelId, message, container) {
    const messageContent = container.querySelector('.message-content');
    
    try {
        const response = await sendStreamChatRequest(message, container, modelId);

        if (response && !response.isAborted) {
            // 流式处理已在 sendStreamChatRequest 内部完成
            // 更新聊天历史
            chatHistory.push({
                role: 'assistant',
                content: response.content,
                model: modelId,
                timestamp: new Date().toISOString()
            });

             // 清理工作（例如移除加载动画）已在 sendStreamChatRequest 中处理
        } else {
             // 用户中止或发生错误
            const thinkingAnimation = container.querySelector('.thinking-animation');
            if (thinkingAnimation) thinkingAnimation.remove();
            if (!container.querySelector('.message-text')) {
                const errorText = document.createElement('div');
                errorText.className = 'message-text error';
                errorText.textContent = response.isAborted ? '已停止' : '加载失败';
                messageContent.appendChild(errorText);
            }
        }
    } catch (error) {
        const thinkingAnimation = container.querySelector('.thinking-animation');
        if (thinkingAnimation) thinkingAnimation.remove();
        
        const errorText = document.createElement('div');
        errorText.className = 'message-text error';
        errorText.textContent = `请求 ${getModelDisplayName(modelId)} 出错了`;
        messageContent.appendChild(errorText);
        console.error(`模型 ${modelId} 请求失败:`, error);
    }
}


function addMessage(role, content) {
    if (role === 'assistant') {
        // AI 的消息由新的 multi-response 容器处理
        return;
    }

    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${role}`;
    
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    
    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    
    // 处理消息内容格式
    const formattedContent = formatMessageContent(content);
    textElement.innerHTML = formattedContent;
    
    // 只为非用户消息添加时间
    if (role !== 'user') {
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = timestamp;
        contentElement.appendChild(textElement);
        contentElement.appendChild(timeElement);
    } else {
        contentElement.appendChild(textElement);
    }
    messageElement.appendChild(contentElement);
    
    elements.chatMessages.appendChild(messageElement);
    
    // 滚动到底部
    scrollToBottom();
    
    // 更新聊天历史
    if (role === 'user' || role === 'assistant') {
        chatHistory.push({
            role: role,
            content: content,
            timestamp: timestamp
        });
        
        // 限制历史记录长度，避免token过多
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(-20);
        }
    }
}

function formatMessageContent(content) {
    // 如果已加载 marked 库，则使用 marked 解析 Markdown
    if (typeof marked !== 'undefined') {
        // 创建自定义 renderer
        const renderer = new marked.Renderer();
        
        // 自定义链接渲染，确保在新标签页打开
        renderer.link = function(href, title, text) {
            const titleAttr = title ? ` title="${title}"` : '';
            return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
        };
        
        // 自定义代码块渲染，添加语言类
        renderer.code = function(code, language) {
            const lang = language || 'text';
            const escapedCode = escapeHtml(code);
            return `<pre><code class="language-${lang}">${escapedCode}</code></pre>`;
        };
        
        // 自定义任务列表项，并增加对非字符串内容的健壮性处理
        renderer.listitem = function(text, task, checked) {
            let itemText;
            if (typeof text === 'object' && text !== null && typeof text.text === 'string') {
                // 如果是带有 'text' 属性的对象，则提取该属性内容
                // 并将其作为内联 Markdown 解析，以正确显示加粗等格式。
                itemText = marked.parseInline(text.text);
            } else if (typeof text !== 'string') {
                // 对于其他非字符串类型，打印警告并尝试序列化为JSON
                console.warn('[Marked Renderer] listitem received non-string text:', text);
                try {
                    itemText = JSON.stringify(text, null, 2);
                } catch (e) {
                    itemText = String(text);
                }
            } else {
                // 正常处理字符串
                itemText = text;
            }

            if (task) {
                const checkbox = checked 
                    ? '<input type="checkbox" checked disabled>' 
                    : '<input type="checkbox" disabled>';
                return `<li class="task-list-item">${checkbox}${itemText}</li>\n`;
            }
            return `<li>${itemText}</li>\n`;
        };
        
        // [最终修复] 不再使用全局 setOptions，而是创建局部 options 对象
        const markedOptions = {
            renderer: renderer,
            breaks: true,
            gfm: true,
            tables: true,
            pedantic: false,
            smartLists: true,
            smartypants: true,
            xhtml: false
        };

        try {
            // [最终修复] 将局部 options 传递给 parse 函数
            return marked.parse(content, markedOptions);
        } catch (error) {
            console.error('Markdown 解析错误:', error);
            // 如果解析失败，回退到简单处理
            return fallbackFormatContent(content);
        }
    }

    // Fallback: 简单正则替换解析
    return fallbackFormatContent(content);
}

function updateMessageWithThinking(messageContent, fullContent, explicitThinkingText, shouldCollapse = false) {
    const thinkStartTag = '<think>';
    const thinkEndTag = '</think>';
    
    let thinkingText = explicitThinkingText || '';
    let answerText = fullContent;

    // 如果没有通过独立字段传入思考文本（例如 Gemini 模型）
    if (!explicitThinkingText) {
        const endPos = fullContent.indexOf(thinkEndTag);
        // 检查是否以思考标签开头
        if (fullContent.startsWith(thinkStartTag)) {
            if (endPos > -1) {
                // 情况1: 思考过程已结束 (找到了结束标签)
                thinkingText = fullContent.substring(thinkStartTag.length, endPos);
                answerText = fullContent.substring(endPos + thinkEndTag.length).trim();
            } else {
                // 情况2: 思考过程正在进行中 (只找到了开始标签)
                thinkingText = fullContent.substring(thinkStartTag.length);
                answerText = ''; // 正式答案此时应为空
            }
        }
    } 
    // 对于 Claude 或其他模型，如果 fullContent 中意外包含了 think 标签，也清理一下
    else if (fullContent.includes(thinkEndTag)) {
        answerText = fullContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }

    // --- 渲染逻辑 ---

    // 管理思考过程容器
    let thinkingContainer = messageContent.querySelector('.thinking-process');
    if (thinkingText) {
        if (!thinkingContainer) {
            thinkingContainer = document.createElement('div');
            thinkingContainer.className = 'thinking-process collapsible';
            thinkingContainer.innerHTML = `
                <div class="collapsible-header">
                    <i class="fas fa-brain"></i>
                    <span>思考过程</span>
                    <i class="fas fa-chevron-down toggle-icon"></i>
                </div>
                <div class="collapsible-content"></div>
            `;
            messageContent.prepend(thinkingContainer);

            thinkingContainer.querySelector('.collapsible-header').addEventListener('click', () => {
                thinkingContainer.classList.toggle('collapsed');
            });
        }
        thinkingContainer.querySelector('.collapsible-content').innerHTML = marked.parse(thinkingText);
        
        // 新增：如果收到指令，就折叠思考过程
        if (shouldCollapse) {
            thinkingContainer.classList.add('collapsed');
        }

    } else if (thinkingContainer) {
        thinkingContainer.remove();
    }
    
    // 管理最终答案容器
    let answerContainer = messageContent.querySelector('.message-text');
    if (answerText) {
        if (!answerContainer) {
            answerContainer = document.createElement('div');
            answerContainer.className = 'message-text';
            messageContent.appendChild(answerContainer);
        }
        answerContainer.innerHTML = marked.parse(answerText);
    } else if (answerContainer) {
        // 如果没有答案文本了（例如，在思考过程中），确保答案容器是空的
        answerContainer.innerHTML = '';
    }
}


// 备用的简单格式化函数
function fallbackFormatContent(content) {
    // 处理代码块
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return `<pre><code class="language-${lang || 'text'}">${escapeHtml(code.trim())}</code></pre>`;
    });
    // 处理内联代码
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 处理换行
    content = content.replace(/\n/g, '<br>');
    // 处理链接
    content = content.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return content;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        const container = elements.chatMessages;
        // 先快速滚到最底以覆盖所有场景
        container.scrollTop = container.scrollHeight;
        // 再确保最后一条消息在视口内
        const lastMessage = container.lastElementChild;
        if (lastMessage) {
            lastMessage.scrollIntoView({ block: 'end', behavior: 'auto' });
        }
    });
}

function showThinkingAnimation() {
    const thinkingElement = document.createElement('div');
    thinkingElement.className = 'thinking-message';
    thinkingElement.id = 'thinking-animation';
    
    const thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';
    
    const thinkingText = document.createElement('span');
    thinkingText.textContent = 'AI 正在思考';
    
    const thinkingDots = document.createElement('div');
    thinkingDots.className = 'thinking-dots';
    
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.className = 'thinking-dot';
        thinkingDots.appendChild(dot);
    }
    
    thinkingContent.appendChild(thinkingText);
    thinkingContent.appendChild(thinkingDots);
    thinkingElement.appendChild(thinkingContent);
    
    elements.chatMessages.appendChild(thinkingElement);
    scrollToBottom();
    
    return thinkingElement;
}

function removeThinkingAnimation(thinkingElement) {
    if (thinkingElement && thinkingElement.parentNode) {
        thinkingElement.parentNode.removeChild(thinkingElement);
    }
}

function createAssistantMessage() {
    // 这个函数的功能现在被 createMultiResponseContainer 和 handleSingleChatRequest 替代
    // 保留以防万一有旧代码调用，但它不应该再被主要流程使用
    console.warn("createAssistantMessage is deprecated");
    return document.createElement('div');
}

function updateAssistantMessage(assistantMessageElement, content) {
    // 这个函数的功能现在被 sendStreamChatRequest 内部的流式更新替代
     console.warn("updateAssistantMessage is deprecated");
}

function setInputDisabled(disabled) {
    isWaitingForResponse = disabled;
    elements.messageInput.disabled = disabled;
    elements.modelSelectHeader.style.pointerEvents = disabled ? 'none' : 'auto';
    elements.modelSelect.style.opacity = disabled ? 0.7 : 1;
    elements.newChatButton.disabled = disabled;

    if (disabled) {
        elements.sendButton.innerHTML = '<i class="fas fa-stop"></i>';
        elements.sendButton.title = '停止生成';
    } else {
        elements.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
        elements.sendButton.title = '发送';
    }
}

// 保留showLoading函数以防需要全屏加载提示
function showLoading(show) {
    // 这个函数现在由每个响应单元的 thinking animation 替代
    console.warn("showLoading is deprecated");
}

async function sendStreamChatRequest(message, container, modelId) {
    const messageContent = container.querySelector('.message-content');
    const thinkingAnimation = container.querySelector('.thinking-animation');
    
    const requestBody = {
        model: modelId,
        messages: [
            ...chatHistory,
            { role: 'user', content: message }
        ],
        stream: true
    };
    
    let fullContent = '';
    let thinkingText = ''; // 新增：专门用于存储思考过程的文本
    let isAborted = false;
    let thinkingCompleted = false; // 新增状态锁

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify(requestBody),
            signal: streamController.signal
        });
        
        if (thinkingAnimation) {
            thinkingAnimation.remove();
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error?.message || `HTTP 错误: ${response.status}`;
            throw new Error(errorMessage);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    if (data === '[DONE]') {
                        break;
                    }
                    try {
                        const json = JSON.parse(data);
                        
                        const delta = json.choices[0]?.delta;
                        if (delta) {
                            let justCompletedThinking = false;
                            
                            // 记录更新前的状态
                            const oldFullContent = fullContent;
                            const oldThinkingTextLength = thinkingText.length;
                            
                            // 检查并累加最终答案
                            if (delta.content) {
                                fullContent += delta.content;
                            }
                            // 检查并累加思考过程（兼容 deepseek-r1 的 'reasoning' 和 claude 的 'reasoning_content'）
                            if (delta.reasoning) {
                                thinkingText += delta.reasoning;
                            } else if (delta.reasoning_content) {
                                thinkingText += delta.reasoning_content;
                            }
 
                            if (!thinkingCompleted) {
                                // 条件1: Claude/DeepSeek类模型 - 思考区已有内容，且主回答区刚开始有内容
                                const isVendorApiTransition = oldThinkingTextLength > 0 && fullContent.length > 0 && oldFullContent.length === 0;
                                // 条件2: Gemini类模型 - 思考结束标签刚出现
                                const isGeminiTransition = fullContent.includes('</think>') && !oldFullContent.includes('</think>');
 
                                if (isVendorApiTransition || isGeminiTransition) {
                                    justCompletedThinking = true;
                                    thinkingCompleted = true; // 锁定状态，防止重复触发
                                }
                            }

                            // 更新UI
                            updateMessageWithThinking(messageContent, fullContent, thinkingText, justCompletedThinking);
                        }
                    } catch (e) {
                        console.error('解析流数据失败:', e, '原始数据:', data);
                    }
                }
            }
            scrollToBottom();
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`模型 ${modelId} 的请求被中止`);
            isAborted = true;
        } else {
            console.error(`模型 ${modelId} 的流式请求失败:`, error);
            if (thinkingAnimation) thinkingAnimation.remove();
            if (assistantMessageElement) {
                assistantMessageElement.innerHTML += `<p class="error">抱歉，加载回答时遇到问题: ${error.message}</p>`;
            } else {
                const errorElement = document.createElement('div');
                errorElement.className = 'message-text error';
                errorElement.textContent = `抱歉，请求失败: ${error.message}`;
                messageContent.appendChild(errorElement);
            }
        }
    } finally {
        if (thinkingAnimation) thinkingAnimation.remove();
    }
    
    return { 
        content: fullContent, 
        isAborted: isAborted,
        isStream: true
    };
}

// 保留原有的非流式请求函数，以备需要时使用
async function sendChatRequest(message, retryCount = 0) {
    // 非流式请求逻辑保持不变，但现在需要 modelId
    // 在这个新架构中，我们优先使用流式请求，这个函数可能不会被频繁调用
    const selectedModel = elements.modelSelect.value; // Fallback to single selection
     const requestBody = {
        model: selectedModel,
        messages: [
            ...chatHistory,
            { role: 'user', content: message }
        ],
        stream: false
    };

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
            return {
                content: data.choices[0].message.content,
                model: selectedModel,
                usage: data.usage
            };
        } else {
            throw new Error('无效的响应格式');
        }
    } catch (error) {
        console.error('API请求失败:', error);
        
        // 重试逻辑
        if (retryCount < CONFIG.MAX_RETRIES) {
            console.log(`重试中... (${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
            return sendChatRequest(message, retryCount + 1);
        }
        
        throw error;
    }
}

// 工具函数
function getModelDisplayName(modelId) {
    const model = availableModels.find(m => m.id === modelId);
    return model ? model.name : modelId;
}

function exportChatHistory() {
    const dataStr = JSON.stringify(chatHistory, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `chat_history_${new Date().getTime()}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function clearChatHistory() {
    if (confirm('确定要清空聊天记录吗？')) {
        startNewChat();
    }
}

// 错误处理
window.addEventListener('error', function(event) {
    console.error('全局错误:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('未处理的 Promise 拒绝:', event.reason);
});

// 导出函数供全局使用
window.exportChatHistory = exportChatHistory;
window.clearChatHistory = clearChatHistory; 