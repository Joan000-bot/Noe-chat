// 对话聚合 - 等用户说完再回复
// 替换 chat.html 中的 send 函数

// ===== 聚合状态 =====
let pendingMessages = [];    // 待发送的消息队列
let aggregateTimer = null;   // 聚合计时器
const AGGREGATE_DELAY = 3000; // 3秒聚合窗口
let isWaitingForAI = false;  // 是否正在等待 AI 回复

async function send(e) {
  e.preventDefault();
  const v = txt.value.trim();
  if (!v && !pendingImage) return;
  
  // 如果正在等待 AI 回复，直接加入队列，不重新发送
  if (isWaitingForAI) {
    // 用户在 AI 回复期间又发了消息 - 先显示，但不触发新请求
    const img = pendingImage;
    txt.value = ''; txt.style.height = 'auto'; clearImage();
    render({ role:'user', content:v, image:img, created_at:Date.now(), auto:0 });
    pendingMessages.push({ text: v, image: img });
    return;
  }
  
  const img = pendingImage;
  txt.value = ''; txt.style.height = 'auto'; clearImage();
  
  // 显示用户消息
  render({ role:'user', content:v, image:img, created_at:Date.now(), auto:0 });
  
  // 加入待发送队列
  pendingMessages.push({ text: v, image: img });
  
  // 重置计时器
  if (aggregateTimer) clearTimeout(aggregateTimer);
  
  // 显示"正在输入"提示（带聚合指示）
  updateTypingIndicator();
  
  // 3秒后发送
  aggregateTimer = setTimeout(() => {
    flushMessages();
  }, AGGREGATE_DELAY);
}

function updateTypingIndicator() {
  // 移除旧的 typing 指示器
  const old = document.querySelector('.typing');
  if (old) old.remove();
  
  // 如果有待发送消息，显示聚合提示
  if (pendingMessages.length > 0 && !isWaitingForAI) {
    const hint = document.createElement('div');
    hint.className = 'typing aggregate-hint';
    hint.innerHTML = `<span class="aggregate-text">等待中... 继续说？</span>`;
    hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; padding: 8px 16px;';
    log.appendChild(hint);
    log.scrollTop = log.scrollHeight;
  }
}

async function flushMessages() {
  if (pendingMessages.length === 0) return;
  
  aggregateTimer = null;
  isWaitingForAI = true;
  
  // 收集所有待发送消息
  const messages = [...pendingMessages];
  pendingMessages = [];
  
  // 合并消息文本
  const combinedText = messages.map(m => m.text).filter(Boolean).join('\n\n');
  // 取最后一张图片（如果有）
  const lastImage = messages.filter(m => m.image).pop()?.image || null;
  
  // 移除聚合提示，显示 typing 动画
  const hint = document.querySelector('.aggregate-hint');
  if (hint) hint.remove();
  
  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  log.appendChild(typing);
  log.scrollTop = log.scrollHeight;
  
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: combinedText, image: lastImage })
    });
    const j = await r.json();
    typing.remove();
    
    if (j.reply) {
      render({
        role: 'assistant',
        content: j.reply,
        model: j.model,
        reasoning: j.reasoning,
        tool_calls: j.tool_calls,
        created_at: Date.now(),
        auto: 0
      });
    } else {
      render({ role: 'assistant', content: '[错误] ' + (j.error || 'unknown'), created_at: Date.now(), auto: 0 });
    }
  } catch (err) {
    typing.remove();
    render({ role: 'assistant', content: '[网络错误] ' + err.message, created_at: Date.now(), auto: 0 });
  }
  
  isWaitingForAI = false;
  
  // 如果在等待期间又有新消息进来，继续处理
  if (pendingMessages.length > 0) {
    updateTypingIndicator();
    aggregateTimer = setTimeout(() => flushMessages(), AGGREGATE_DELAY);
  }
}

// 允许手动立即发送（比如按 Ctrl+Enter）
function sendNow() {
  if (aggregateTimer) {
    clearTimeout(aggregateTimer);
    aggregateTimer = null;
  }
  // 先把当前输入框内容加入队列
  const v = txt.value.trim();
  if (v || pendingImage) {
    const img = pendingImage;
    txt.value = ''; txt.style.height = 'auto'; clearImage();
    render({ role:'user', content:v, image:img, created_at:Date.now(), auto:0 });
    pendingMessages.push({ text: v, image: img });
  }
  flushMessages();
}

window.send = send;
window.sendNow = sendNow;
