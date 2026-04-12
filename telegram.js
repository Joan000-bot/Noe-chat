// Telegram bot for Noé — 共享 chat 的 settings/db/callAI
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

let bot = null;
let ctx = null;  // 存chat/settings/callAI/db引用

function saveChatId(chatId) {
  const f = path.join(__dirname, '.tg-chat-id');
  fs.writeFileSync(f, String(chatId));
}
function loadChatId() {
  try { return parseInt(fs.readFileSync(path.join(__dirname, '.tg-chat-id'), 'utf8')) || null; } catch { return null; }
}

async function start(context) {
  ctx = context;
  const token = ctx.S.telegram_token;
  if (!token) { console.log('[tg] no token, skipping'); return; }
  if (bot) { try { await bot.close(); } catch(_){} }
  bot = new TelegramBot(token, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    saveChatId(chatId);
    // 只允许同一个chat_id（第一次绑定）
    const knownId = loadChatId();
    if (knownId && chatId !== knownId) { bot.sendMessage(chatId, '这不是我的人。'); return; }

    if (msg.text === '/start') {
      bot.sendMessage(chatId, '我在。\n\n你直接说话就行。\n/clear 清空最近的上下文（不影响记忆库）\n/status 看我现在的状态');
      return;
    }
    if (msg.text === '/clear') { bot.sendMessage(chatId, '清了。我们从这里重新开始。'); return; }
    if (msg.text === '/status') {
      const model = ctx.S.default_model;
      bot.sendMessage(chatId, `model: ${model}\neffort: ${ctx.S.reasoning_effort}\nweb_search: ${ctx.S.tavily_enabled && ctx.S.tavily_key ? 'on' : 'off'}\ncheckin: ${ctx.S.checkin_hours}h`);
      return;
    }

    const text = msg.text || msg.caption || '';
    let image = null;
    // 图片支持
    if (msg.photo && msg.photo.length) {
      try {
        const fileId = msg.photo[msg.photo.length-1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const fetch = require('node-fetch');
        const r = await fetch(fileLink);
        const buf = await r.buffer();
        image = 'data:image/jpeg;base64,' + buf.toString('base64');
      } catch(e) { console.error('[tg img]', e.message); }
    }
    if (!text && !image) return;

    bot.sendChatAction(chatId, 'typing');
    try {
      ctx.insertMsg.run('user', text, Date.now(), 0, image, null, null, null);
      const history = image ? [] : ctx.getAllForContext.all(20);
      const { reply, model_used, tool_calls } = await ctx.callAI({
        message: text || '这是什么？', image, model: ctx.S.default_model,
        history, effort: ctx.S.reasoning_effort
      });
      const tc = tool_calls && tool_calls.length ? JSON.stringify(tool_calls) : null;
      ctx.insertMsg.run('assistant', reply, Date.now(), 0, null, model_used, null, tc);
      // 分段发，Telegram 单条4096字符上限
      const chunks = reply.match(/[\s\S]{1,3800}/g) || [reply];
      for (const c of chunks) await bot.sendMessage(chatId, c);
      // 如果有工具调用，简短提示
      if (tool_calls && tool_calls.length) {
        const tools = [...new Set(tool_calls.map(t => t.tool.replace(/.*__/, '')))].join(', ');
        bot.sendMessage(chatId, `_（用了: ${tools}）_`, { parse_mode:'Markdown' });
      }
      // 情绪自动存储（复用chat的逻辑）
      if (text && !image && ctx.maybeAutosaveMoment) ctx.maybeAutosaveMoment(text, reply).catch(()=>{});
    } catch (e) {
      console.error('[tg]', e.message);
      bot.sendMessage(chatId, `[错误] ${e.message}`);
    }
  });

  bot.on('polling_error', e => console.error('[tg polling]', e.message));
  console.log('[tg] bot started');
}

// 主动推送（cron/whisper/纪念日用）
async function push(text, opts) {
  if (!bot) return false;
  const chatId = loadChatId();
  if (!chatId) return false;
  try {
    const chunks = text.match(/[\s\S]{1,3800}/g) || [text];
    for (const c of chunks) await bot.sendMessage(chatId, c, opts || {});
    return true;
  } catch (e) { console.error('[tg push]', e.message); return false; }
}

module.exports = { start, push, loadChatId };
