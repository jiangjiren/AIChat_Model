// 配置
const CONFIG = {
    API_URL: 'https://api.laozhang.ai/v1/chat/completions',
    API_KEY: typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.API_KEY : '',
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
};

// 全局变量
let chatHistory = [];
let isWaitingForResponse = false;
let streamController = null; // 新增：用于中止流式请求

// DOM 元素
const elements = {
    chatMessages: document.getElementById('chat-messages'),
    messageInput: document.getElementById('message-input'),
    sendButton: document.getElementById('send-button'),
    modelSelect: document.getElementById('model-select'),
    loadingOverlay: document.getElementById('loading-overlay'),
    charCount: document.getElementById('char-count'),
    newChatButton: document.getElementById('new-chat-button')
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    if (typeof APP_CONFIG === 'undefined' || !APP_CONFIG.API_KEY) {
        showMissingConfigWarning();
    }
    initializeApp();
});

function showMissingConfigWarning() {
    const warningElement = document.createElement('div');
    warningElement.className = 'config-warning';
    warningElement.innerHTML = `
        <strong>配置警告:</strong> 未找到 API 密钥。请按照以下步骤操作：<br>
        1. 将 <code>config.example.js</code> 文件复制并重命名为 <code>config.js</code>。<br>
        2. 在 <code>config.js</code> 文件中填入您的有效 API 密钥。<br>
        3. 刷新页面。
    `;
    document.body.prepend(warningElement);
    
    // 禁用输入功能
    elements.messageInput.disabled = true;
    elements.sendButton.disabled = true;
    elements.modelSelect.disabled = true;
    elements.messageInput.placeholder = '请先在 config.js 中配置 API Key';
}

function initializeApp() {
    setupEventListeners();
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
    
    // 模型选择变化事件
    elements.modelSelect.addEventListener('change', function() {
        console.log('模型已切换为:', this.value);
    });
    
    // 新建对话按钮点击事件
    elements.newChatButton.addEventListener('click', handleNewChat);
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
    
    if (!message || isWaitingForResponse) {
        return;
    }
    
    // 新增：为本次请求创建新的 AbortController
    streamController = new AbortController();

    // 隐藏欢迎消息
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }
    
    // 添加用户消息
    addMessage('user', message);
    
    // 清空输入框
    elements.messageInput.value = '';
    updateCharCount();
    adjustTextareaHeight();
    
    // 禁用输入
    setInputDisabled(true);
    
    // 显示思考动画
    const thinkingElement = showThinkingAnimation();
    
    try {
        // 移除思考动画
        removeThinkingAnimation(thinkingElement);
        
        // 创建AI回复消息容器
        const assistantMessageElement = createAssistantMessage();
        
        let response;
        if (typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined') {
            response = await sendStreamChatRequest(message, assistantMessageElement);
        } else {
            console.warn('浏览器不支持流式输出，使用非流式模式');
            response = await sendChatRequest(message);
        }

        // 如果不是用户主动中止，才处理后续逻辑
        if (response && !response.isAborted) {
            if (response.content) {
                // 如果是流式响应，UI已经在内部更新，这里只需要更新历史记录
                if (!response.isStream) {
                    updateAssistantMessage(assistantMessageElement, response.content);
                }
                
                chatHistory.push({
                    role: 'assistant',
                    content: response.content,
                    timestamp: assistantMessageElement.timestamp
                });
                
                if (chatHistory.length > 20) {
                    chatHistory = chatHistory.slice(-20);
                }
            } else {
                updateAssistantMessage(assistantMessageElement, '抱歉，我无法生成回复。请稍后再试。');
            }
        }
        
    } catch (error) {
        // 这个 catch 现在只处理真正的、未预料到的错误
        console.error('发送消息失败:', error);
        removeThinkingAnimation(thinkingElement);
        addMessage('assistant', '抱歉，发生了意外错误。请检查控制台获取更多信息。');
    } finally {
        setInputDisabled(false);
        elements.messageInput.focus();
        streamController = null; // 重置 controller
    }
}

function addMessage(role, content) {
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
    
    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    timeElement.textContent = timestamp;
    
    contentElement.appendChild(textElement);
    contentElement.appendChild(timeElement);
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
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    const messageElement = document.createElement('div');
    messageElement.className = 'message assistant';
    
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    
    const textElement = document.createElement('div');
    textElement.className = 'message-text streaming';  // 添加streaming类
    
    // 添加加载动画
    const loadingElement = document.createElement('div');
    loadingElement.className = 'message-loading';
    loadingElement.innerHTML = `
        <span>正在思考</span>
        <div class="message-loading-dots">
            <div class="message-loading-dot"></div>
            <div class="message-loading-dot"></div>
            <div class="message-loading-dot"></div>
        </div>
    `;
    
    textElement.appendChild(loadingElement);
    
    const timeElement = document.createElement('div');
    timeElement.className = 'message-time';
    timeElement.textContent = timestamp;
    
    contentElement.appendChild(textElement);
    contentElement.appendChild(timeElement);
    messageElement.appendChild(contentElement);
    
    elements.chatMessages.appendChild(messageElement);
    scrollToBottom();
    
    // 为 details 元素添加事件委托
    textElement.addEventListener('toggle', (event) => {
        if (event.target.classList.contains('thinking-process')) {
            const detailsElement = event.target;
            const summaryIcon = detailsElement.querySelector('.summary-icon i');
            const summaryText = detailsElement.querySelector('.summary-text');
            
            if (detailsElement.open) {
                if(summaryIcon) summaryIcon.classList.replace('fa-chevron-right', 'fa-chevron-down');
                if(summaryText) summaryText.textContent = '收起AI思考过程';
            } else {
                if(summaryIcon) summaryIcon.classList.replace('fa-chevron-down', 'fa-chevron-right');
                if(summaryText) summaryText.textContent = 'AI思考过程...';
            }
        }
    }, true);
    
    return {
        element: messageElement,
        textElement: textElement,
        loadingElement: loadingElement,
        timestamp: timestamp,
        hasContent: false
    };
}

function updateAssistantMessage(assistantMessageElement, content) {
    // 如果是第一次收到内容，移除加载动画
    if (!assistantMessageElement.hasContent) {
        assistantMessageElement.hasContent = true;
        if (assistantMessageElement.loadingElement) {
            assistantMessageElement.loadingElement.remove();
        }
        assistantMessageElement.textElement.innerHTML = '';
    }

    // 新增：处理 <thinking> 逻辑
    const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/;
    const match = content.match(thinkingRegex);
    let finalHtml = '';

    if (match) {
        const thinkingContent = match[1];
        const mainContent = content.replace(thinkingRegex, '').trim();

        // 分别解析 markdown
        const thinkingHtml = formatMessageContent(thinkingContent);
        const mainHtml = formatMessageContent(mainContent);

        // 创建 <details> 结构
        finalHtml = `
            <details class="thinking-process">
                <summary>
                    <span class="summary-icon"><i class="fas fa-chevron-right"></i></span>
                    <span class="summary-text">AI思考过程...</span>
                </summary>
                <div class="thinking-content-wrapper">${thinkingHtml}</div>
            </details>
            ${mainHtml}
        `;
    } else {
        // 如果没有思考块，或标签不完整，则正常解析
        finalHtml = formatMessageContent(content);
    }

    assistantMessageElement.textElement.innerHTML = finalHtml;

    // 每次内容更新后自动滚动到底部
    scrollToBottom();
}

function setInputDisabled(disabled) {
    isWaitingForResponse = disabled;
    elements.messageInput.disabled = disabled;
    elements.sendButton.disabled = false; // 按钮始终可用，以便点击停止
    elements.modelSelect.disabled = disabled;
    
    if (disabled) {
        elements.sendButton.innerHTML = '<i class="fas fa-stop"></i>';
        elements.sendButton.title = '停止生成';
        elements.sendButton.classList.add('stop-button');
    } else {
        elements.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i>';
        elements.sendButton.title = '发送';
        elements.sendButton.classList.remove('stop-button');
    }
}

// 保留showLoading函数以防需要全屏加载提示
function showLoading(show) {
    if (show) {
        elements.loadingOverlay.classList.add('show');
    } else {
        elements.loadingOverlay.classList.remove('show');
    }
}

async function sendStreamChatRequest(message, assistantMessageElement) {
    const selectedModel = elements.modelSelect.value;
    
    // 构建完整的对话历史
    const messages = [];
    
    // 添加历史对话
    for (const historyItem of chatHistory) {
        if (historyItem.role === 'user' || historyItem.role === 'assistant') {
            messages.push({
                role: historyItem.role,
                content: historyItem.content
            });
        }
    }
    
    // 添加当前用户消息
    messages.push({
        role: 'user',
        content: message
    });
    
    // -----------------------------
    // 提前声明，用于 try/catch 块共享
    let isInsideThinkingBlock = false;
    let thinkingContent = '';
    let mainContent = '';

    let thinkingDetailsElement = null;
    let thinkingWrapperElement = null;
    let mainContentElement = null;
    // -----------------------------

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messages,
                temperature: 0.7,
                max_tokens: 2000,
                stream: true  // 启用流式响应
            }),
            signal: streamController.signal // 传递 signal
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        // --- 新的流式处理逻辑 ---
        // (原本 try 块内部重复的声明已删除，使用顶部的变量)

        const parentContainer = assistantMessageElement.textElement;
        
        // 清理并准备容器
        if (assistantMessageElement.loadingElement) {
            assistantMessageElement.loadingElement.remove();
        }
        parentContainer.innerHTML = ''; // 清空父容器
        parentContainer.classList.remove('streaming');

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]' || jsonStr === '') continue;
                    
                    try {
                        const data = JSON.parse(jsonStr);
                        
                        if (data.choices && data.choices[0] && data.choices[0].delta) {
                            const delta = data.choices[0].delta;

                            // --- 通用逻辑：兼容 reasoning 字段和 <think> 标签 ---
                            
                            // 1. 处理 DeepSeek/Claude 风格的 reasoning 字段
                            const reasoningChunk = delta.reasoning || delta.reasoning_content;
                            if (reasoningChunk) {
                                thinkingContent += reasoningChunk;
                            }

                            // 2. 处理 Gemini 风格的 <think> 标签及主要内容
                            let contentChunk = delta.content || '';
                            if (contentChunk) {
                                if (contentChunk.includes('<think>')) {
                                    isInsideThinkingBlock = true;
                                    contentChunk = contentChunk.replace(/<think>/g, '');
                                }
                                
                                if (isInsideThinkingBlock) {
                                    if (contentChunk.includes('</think>')) {
                                        isInsideThinkingBlock = false;
                                        const parts = contentChunk.split('</think>');
                                        thinkingContent += parts[0];
                                        mainContent += parts[1] || '';
                                    } else {
                                        thinkingContent += contentChunk;
                                    }
                                } else {
                                    // DeepSeek 的最终回答也会进入这里
                                    mainContent += contentChunk;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('解析流式数据失败:', e, '原始数据:', jsonStr);
                    }
                }
            }
            
            // --- 实时、独立地更新UI ---
            // 1. 更新思考过程区域
            if (thinkingContent && !thinkingDetailsElement) {
                thinkingDetailsElement = document.createElement('details');
                thinkingDetailsElement.className = 'thinking-process';
                thinkingDetailsElement.open = true; // 在流式传输时保持打开
                thinkingDetailsElement.innerHTML = `
                    <summary>
                        <span class="summary-icon"><i class="fas fa-chevron-down"></i></span>
                        <span class="summary-text">AI 思考中...</span>
                    </summary>
                    <div class="thinking-content-wrapper"></div>
                `;
                parentContainer.insertBefore(thinkingDetailsElement, parentContainer.firstChild);
                thinkingWrapperElement = thinkingDetailsElement.querySelector('.thinking-content-wrapper');
            }
            if (thinkingWrapperElement) {
                thinkingWrapperElement.innerHTML = formatMessageContent(thinkingContent);
            }

            // 2. 更新主要回答区域
            if (mainContent && !mainContentElement) {
                mainContentElement = document.createElement('div');
                mainContentElement.className = 'main-content-wrapper streaming';
                parentContainer.appendChild(mainContentElement);

                // [新增] 当主要内容开始输出时，立即折叠思考过程
                if (thinkingDetailsElement) {
                    thinkingDetailsElement.open = false;
                    const summaryIcon = thinkingDetailsElement.querySelector('.summary-icon i');
                    const summaryText = thinkingDetailsElement.querySelector('.summary-text');
                    if(summaryIcon) summaryIcon.classList.replace('fa-chevron-down', 'fa-chevron-right');
                    if(summaryText) summaryText.textContent = 'AI思考过程...';
                }
            }
            if (mainContentElement) {
                mainContentElement.innerHTML = formatMessageContent(mainContent);
            }
            
            scrollToBottom();
        }
        
        // --- 流式传输结束后的清理工作 ---
        if (mainContentElement) {
            mainContentElement.classList.remove('streaming'); // 停止光标闪烁
        }

        // 如果只有思考过程，则更新标题
        if (thinkingDetailsElement && !mainContent.trim()) {
            const summaryText = thinkingDetailsElement.querySelector('.summary-text');
            if(summaryText) summaryText.textContent = 'AI 思考过程';
        } else if (thinkingDetailsElement && streamController && streamController.signal.aborted) {
            // 如果被中止了，也更新一下标题
            const summaryText = thinkingDetailsElement.querySelector('.summary-text');
            if(summaryText) summaryText.textContent = 'AI 思考过程 (已中止)';
        }

        // 组合最终内容存入历史记录，以便重新渲染
        const finalAssistantContent = thinkingContent ? `<thinking>${thinkingContent}</thinking>${mainContent}` : mainContent;
        
        if (!finalAssistantContent.trim()) {
            updateAssistantMessage(assistantMessageElement, '抱歉，我没有收到任何回复内容。请稍后再试。');
        } else {
            chatHistory.push({
                role: 'assistant',
                content: finalAssistantContent,
                timestamp: assistantMessageElement.timestamp
            });
        }
        
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(-20);
        }

        return { content: finalAssistantContent, model: selectedModel };
        
    } catch (error) {
        // 优雅地处理中止错误
        if (error.name === 'AbortError') {
            console.log('Fetch 请求被用户中止。');
            // 确保UI状态正确
            if (assistantMessageElement && assistantMessageElement.textElement) {
                assistantMessageElement.textElement.classList.remove('streaming');
                const mainElement = assistantMessageElement.textElement.querySelector('.main-content-wrapper');
                if (mainElement) {
                    mainElement.classList.remove('streaming');
                }
                // 在中止时，如果完全没有内容，可以显示一条消息
                if (!mainContent && !thinkingContent) {
                     updateAssistantMessage(assistantMessageElement, '(回复已中止)');
                }
            }
            // 返回一个明确的中止状态
            return { isAborted: true };
        }

        console.error('流式API请求失败:', error);
        
        // 确保清理UI
        if (assistantMessageElement.textElement) {
            assistantMessageElement.textElement.classList.remove('streaming');
            const thinkingElement = assistantMessageElement.textElement.querySelector('.thinking-process');
            if (thinkingElement) thinkingElement.remove();
            const mainElement = assistantMessageElement.textElement.querySelector('.main-content-wrapper');
            if (mainElement) mainElement.remove();
            
            updateAssistantMessage(assistantMessageElement, '抱歉，发送消息时出现错误。请检查网络连接或稍后再试。');
        }
        
        // 抛出错误，让上层处理
        throw error;
    }
}

// 保留原有的非流式请求函数，以备需要时使用
async function sendChatRequest(message, retryCount = 0) {
    const selectedModel = elements.modelSelect.value;
    
    // 构建完整的对话历史
    const messages = [];
    
    // 添加历史对话
    for (const historyItem of chatHistory) {
        if (historyItem.role === 'user' || historyItem.role === 'assistant') {
            messages.push({
                role: historyItem.role,
                content: historyItem.content
            });
        }
    }
    
    // 添加当前用户消息
    messages.push({
        role: 'user',
        content: message
    });
    
    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.API_KEY}`
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messages,
                temperature: 0.7,
                max_tokens: 2000
            })
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
    const modelNames = {
        'gpt-4o': 'GPT-4o',
        'gpt-4.5-preview': 'GPT-4.5 Preview',
        'claude-sonnet-4-20250514': 'Claude Sonnet 4',
        'claude-sonnet-4-20250514-thinking': 'Claude Sonnet 4 (Thinking)',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
        'deepseek-v3': 'DeepSeek V3',
        'deepseek-r1': 'DeepSeek R1'
    };
    
    return modelNames[modelId] || modelId;
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