// 聊天记录导入模块
// 支持: ChatGPT, Claude, 微信, Telegram, 通用文本

function parseTimestamp(str) {
  if (!str) return Date.now();
  const d = new Date(str);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

// ChatGPT 导出格式 (conversations.json)
function parseChatGPT(json) {
  const messages = [];
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  
  // ChatGPT 导出是一个对话数组
  const convos = Array.isArray(data) ? data : [data];
  
  for (const convo of convos) {
    const mapping = convo.mapping || {};
    
    for (const nodeId in mapping) {
      const node = mapping[nodeId];
      const msg = node.message;
      if (!msg || !msg.content?.parts?.length) continue;
      
      const role = msg.author?.role === 'assistant' ? 'assistant' : 
                   msg.author?.role === 'user' ? 'user' : null;
      if (!role) continue;
      
      const content = msg.content.parts.join('\n').trim();
      if (!content) continue;
      
      messages.push({
        role,
        content,
        created_at: parseTimestamp(msg.create_time ? msg.create_time * 1000 : null),
        source: 'chatgpt',
        original_id: nodeId
      });
    }
  }
  
  return messages.sort((a, b) => a.created_at - b.created_at);
}

// Claude.ai 导出格式 (从网页复制的 JSON 或手动导出)
function parseClaude(json) {
  const messages = [];
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  
  // Claude 可能的格式
  const items = data.messages || data.chat_messages || data.conversation || (Array.isArray(data) ? data : []);
  
  for (const item of items) {
    const role = item.role || item.sender || (item.type === 'human' ? 'user' : item.type === 'assistant' ? 'assistant' : null);
    const content = item.content || item.text || item.message || '';
    
    if (!role || !content.trim()) continue;
    
    messages.push({
      role: role === 'human' ? 'user' : role,
      content: content.trim(),
      created_at: parseTimestamp(item.created_at || item.timestamp || item.time),
      source: 'claude'
    });
  }
  
  return messages.sort((a, b) => a.created_at - b.created_at);
}

// 微信聊天记录 (文本格式)
// 格式: "昵称 2024/1/15 14:30:00\n消息内容"
function parseWechat(text, myName = 'Virael') {
  const messages = [];
  const lines = text.split('\n');
  
  let currentMsg = null;
  const pattern = /^(.+?)\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/;
  
  for (const line of lines) {
    const match = line.match(pattern);
    
    if (match) {
      // 保存上一条消息
      if (currentMsg && currentMsg.content.trim()) {
        messages.push(currentMsg);
      }
      
      const [, name, timeStr] = match;
      const isMe = name.includes(myName) || name === '我' || name === 'Me';
      
      currentMsg = {
        role: isMe ? 'user' : 'assistant',
        content: '',
        created_at: parseTimestamp(timeStr.replace(/\//g, '-')),
        source: 'wechat',
        original_sender: name
      };
    } else if (currentMsg) {
      currentMsg.content += (currentMsg.content ? '\n' : '') + line;
    }
  }
  
  if (currentMsg && currentMsg.content.trim()) {
    messages.push(currentMsg);
  }
  
  return messages;
}

// Telegram 导出格式 (JSON)
function parseTelegram(json) {
  const messages = [];
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  
  const items = data.messages || (Array.isArray(data) ? data : []);
  
  for (const item of items) {
    if (item.type !== 'message') continue;
    
    let content = '';
    if (typeof item.text === 'string') {
      content = item.text;
    } else if (Array.isArray(item.text)) {
      content = item.text.map(t => typeof t === 'string' ? t : t.text || '').join('');
    }
    
    if (!content.trim()) continue;
    
    // 根据 from 判断角色，需要配置自己的名字
    const isMe = item.from === 'Virael' || item.from_id === 'user123';
    
    messages.push({
      role: isMe ? 'user' : 'assistant',
      content: content.trim(),
      created_at: parseTimestamp(item.date),
      source: 'telegram',
      original_sender: item.from
    });
  }
  
  return messages;
}

// 通用 JSON 格式
function parseGeneric(json) {
  const messages = [];
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  
  const items = Array.isArray(data) ? data : data.messages || data.items || data.conversation || [];
  
  for (const item of items) {
    const role = item.role || item.sender || item.from || item.type;
    const content = item.content || item.text || item.message || item.body || '';
    
    if (!content.trim()) continue;
    
    const normalizedRole = ['user', 'human', 'me', '我', 'virael'].includes(String(role).toLowerCase()) 
      ? 'user' 
      : 'assistant';
    
    messages.push({
      role: normalizedRole,
      content: content.trim(),
      created_at: parseTimestamp(item.created_at || item.timestamp || item.time || item.date),
      source: 'generic'
    });
  }
  
  return messages.sort((a, b) => a.created_at - b.created_at);
}

// 通用文本格式 (简单的对话格式)
// 格式: "User: xxx" 或 "Noe: xxx" 或 "[时间] 角色: 内容"
function parseText(text) {
  const messages = [];
  const lines = text.split('\n');
  
  let currentRole = null;
  let currentContent = '';
  let currentTime = Date.now() - lines.length * 60000; // 假设每条消息间隔1分钟
  
  const rolePattern = /^(?:\[([^\]]+)\]\s*)?(?:(User|Virael|Me|我|Human|Assistant|Noe|AI|Claude|ChatGPT)[：:]\s*)(.*)$/i;
  
  for (const line of lines) {
    const match = line.match(rolePattern);
    
    if (match) {
      // 保存上一条
      if (currentRole && currentContent.trim()) {
        messages.push({
          role: currentRole,
          content: currentContent.trim(),
          created_at: currentTime,
          source: 'text'
        });
        currentTime += 60000;
      }
      
      const [, timeStr, role, content] = match;
      currentRole = ['user', 'virael', 'me', '我', 'human'].includes(role.toLowerCase()) ? 'user' : 'assistant';
      currentContent = content || '';
      
      if (timeStr) {
        const parsed = parseTimestamp(timeStr);
        if (parsed !== Date.now()) currentTime = parsed;
      }
    } else if (currentRole) {
      currentContent += '\n' + line;
    }
  }
  
  if (currentRole && currentContent.trim()) {
    messages.push({
      role: currentRole,
      content: currentContent.trim(),
      created_at: currentTime,
      source: 'text'
    });
  }
  
  return messages;
}

// 自动检测格式并解析
function autoDetect(input) {
  const text = typeof input === 'string' ? input.trim() : JSON.stringify(input);
  
  // 尝试 JSON
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const json = JSON.parse(text);
      
      // ChatGPT 格式检测
      if (json.mapping || (Array.isArray(json) && json[0]?.mapping)) {
        return { format: 'chatgpt', messages: parseChatGPT(json) };
      }
      
      // Telegram 格式检测
      if (json.messages?.[0]?.type === 'message' || json.name && json.type === 'personal_chat') {
        return { format: 'telegram', messages: parseTelegram(json) };
      }
      
      // Claude 或通用 JSON
      if (json.messages || json.chat_messages || json.conversation) {
        const msgs = parseClaude(json);
        if (msgs.length) return { format: 'claude', messages: msgs };
      }
      
      // 通用 JSON
      return { format: 'generic', messages: parseGeneric(json) };
    } catch (e) {
      // 不是有效 JSON，当作文本处理
    }
  }
  
  // 微信格式检测
  if (/^\S+\s+\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}/m.test(text)) {
    return { format: 'wechat', messages: parseWechat(text) };
  }
  
  // 通用文本
  return { format: 'text', messages: parseText(text) };
}

module.exports = {
  parseChatGPT,
  parseClaude,
  parseWechat,
  parseTelegram,
  parseGeneric,
  parseText,
  autoDetect
};
