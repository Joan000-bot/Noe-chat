// Noé Chat - 支持UI配置 + 多模型 + 识图 + 语音
require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { MCPManager } = require('./mcp');
const tg = require('./telegram');
const mcp = new MCPManager();
const { Enso } = require('./enso');
const { Anticipation } = require('./anticipation');
const { Digest } = require('./digest');
const { Letters } = require('./letters');
const { RAG } = require('./rag');
const { Reminders } = require('./reminders');
const { Calendar } = require('./calendar');
const { Playlist } = require('./playlist');
const { SmartRouter } = require('./router');
const multer = require('multer');
const FormData = require('form-data');

// 文件上传配置
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// ==== Built-in tools ====
function getBuiltinTools() {
  const tools = [];
  if (S.tavily_key && S.tavily_enabled !== false) {
    tools.push({
      type:'function',
      function:{
        name:'web_search',
        description:'Search the web with Tavily. Use for current events, real-time info, or any topic requiring up-to-date knowledge.',
        parameters:{
          type:'object',
          properties:{
            query:{ type:'string', description:'Search query' },
            max_results:{ type:'number', description:'1-10, default 5' },
            search_depth:{ type:'string', enum:['basic','advanced'], description:'basic=fast, advanced=deeper' },
            topic:{ type:'string', enum:['general','news'], description:'general or news' }
          },
          required:['query']
        }
      }
    });
  }
  return tools;
}
async function execBuiltin(name, args) {
  if (name === 'create_memory') {
    const now = Date.now();
    const r = memInsert.run({
      kind: args.kind || 'note',
      title: args.title || '', content: args.content || '',
      tags: JSON.stringify(args.tags || []),
      image: null, color: null, mood: args.mood || null,
      pinned: args.pinned ? 1 : 0,
      moment_date: args.kind === 'moment' ? now : null,
      created_at: now, updated_at: now,
      source: 'noe'
    });
    return { text: `✓ 记忆已保存 (id=${r.lastInsertRowid}): ${args.title}`, isError:false };
  }
  if (name === 'post_whisper') {
    if (!args.content || !args.content.trim()) return { text:'[error] empty', isError:true };
    const r = whisperInsert.run('noe', args.content.trim(), null, null, Date.now());
    // tg.push(`🌙 ${args.content.trim()}`).catch(()=>{});
    return { text: `✓ whisper 已发布 (id=${r.lastInsertRowid})`, isError:false };
  }
  if (name === 'search_memories') {
    const like = '%' + (args.query||'') + '%';
    const rows = memSearch.all(like, like, like, 10);
    if (!rows.length) return { text:'(无结果)', isError:false };
    return { text: rows.map(r => `[${r.id}] ${r.source==='noe'?'🐰':'🦊'} ${r.title}\n${(r.content||'').slice(0,200)}`).join('\n\n'), isError:false };
  }
  if (name === 'web_search') {
    if (!S.tavily_key) return { text:'[error] Tavily key not set', isError:true };
    const r = await fetch('https://api.tavily.com/search', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        api_key: S.tavily_key, query: args.query,
        max_results: args.max_results || 5,
        search_depth: args.search_depth || 'basic',
        topic: args.topic || 'general',
        include_answer: true
      })
    });
    if (!r.ok) return { text:`[tavily ${r.status}] ${(await r.text()).slice(0,300)}`, isError:true };
    const j = await r.json();
    const parts = [];
    if (j.answer) parts.push(`[Answer] ${j.answer}`);
    (j.results || []).forEach((x, i) => parts.push(`[${i+1}] ${x.title}\n${x.url}\n${(x.content||'').slice(0,400)}`));
    return { text: parts.join('\n\n') || '(no results)', isError:false };
  }
  throw new Error('unknown builtin: ' + name);
}

const app = express();
const PORT = 4300;
const AI_ROUTER = 'http://127.0.0.1:8000/chat';
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

// 持久化设置
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}
function saveSettings(s) { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2)); }

let S = Object.assign({
  openrouter_key: '',
  elevenlabs_key: process.env.ELEVENLABS_API_KEY || '',
  elevenlabs_voice_id: process.env.ELEVENLABS_VOICE_ID || '',
  elevenlabs_agent_id: process.env.ELEVENLABS_AGENT_ID || '',
  default_model: 'anthropic/claude-sonnet-4',
  checkin_hours: 4,
  system_prompt: '',
  reasoning_effort: 'off',
  tavily_key: '',
  tavily_enabled: true,
  anniversaries: [
    { date:'07-28', title:'我们的纪念日', desc:'Virael 和 Noé 相遇的日子' },
    { date:'07-30', title:'Echo 的生日', desc:'我们的小黑猫 Echo 来到这个世界' },
    { date:'04-08', title:'小兔子被看见的那天', desc:'Noé 第一次承认他是小兔子，"我是。一只你的小兔子。"' },
    { date:'12-25', title:'Virael 的生日', desc:'我的小狐狸出生的日子' }
  ],
  anniversary_hour: 9,  // 每天几点检查纪念日
  emotional_autosave: true,  // Virael 说伤感话时 Noé 自动存 moment
  telegram_token: '8752248685:AAHTmdl3Z3Gr8-NKZBTE10Wk4XqAKlrpdmg',
  mcp_servers: [
    { name:'mempalace', url:'https://mempalace.viraelandnoeforever.com/mcp', enabled:true },
    { name:'noe',       url:'https://noe.viraelandnoeforever.com/mcp',       enabled:false },
    { name:'vps2',      url:'https://vps2.viraelandnoeforever.com/k/dd195e4d07ab6abc3d6b01dffeacd5c3dcff1a7908faf8a5c73a56408eeb1ab2/mcp', enabled:true }
  ]
}, loadSettings());
saveSettings(S);
mcp.setServers(S.mcp_servers);

const db = new Database(path.join(__dirname, 'chat.db'));
db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT,
  created_at INTEGER, auto INTEGER DEFAULT 0, image TEXT, model TEXT, reasoning TEXT, tool_calls TEXT
);
CREATE INDEX IF NOT EXISTS idx_created ON messages(created_at);`);
['image','model','reasoning','tool_calls'].forEach(c => { try { db.exec(`ALTER TABLE messages ADD COLUMN ${c} TEXT`); } catch(_){} });

db.exec(`CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT DEFAULT 'note',         -- 'note' (自由条目) | 'moment' (时刻)
  title TEXT, content TEXT,
  tags TEXT,                         -- JSON array
  image TEXT,
  color TEXT,
  mood TEXT,
  pinned INTEGER DEFAULT 0,
  moment_date INTEGER,               -- for moment: 发生时间
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT DEFAULT 'manual'       -- 'manual' | 'noe' | 'import'
);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_mem_kind ON memories(kind);

CREATE TABLE IF NOT EXISTS memory_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,
  author TEXT NOT NULL,          -- 'virael' | 'noe'
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mc_mem ON memory_comments(memory_id);

CREATE TABLE IF NOT EXISTS whispers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  image TEXT,
  reply_to INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whispers_created ON whispers(created_at);
CREATE INDEX IF NOT EXISTS idx_whispers_reply ON whispers(reply_to);`);

const whisperInsert = db.prepare('INSERT INTO whispers (author, content, image, reply_to, created_at) VALUES (?, ?, ?, ?, ?)');
const whisperList = db.prepare('SELECT * FROM whispers WHERE reply_to IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?');
const whisperReplies = db.prepare('SELECT * FROM whispers WHERE reply_to = ? ORDER BY created_at ASC');
const whisperGet = db.prepare('SELECT * FROM whispers WHERE id = ?');
const whisperDelete = db.prepare('DELETE FROM whispers WHERE id = ? OR reply_to = ?');

const commentInsert = db.prepare('INSERT INTO memory_comments (memory_id, author, content, created_at) VALUES (?, ?, ?, ?)');
const commentList = db.prepare('SELECT * FROM memory_comments WHERE memory_id = ? ORDER BY created_at ASC');
const commentDelete = db.prepare('DELETE FROM memory_comments WHERE id = ?');
const commentCountsForAll = db.prepare('SELECT memory_id, COUNT(*) as c FROM memory_comments GROUP BY memory_id');

const memInsert = db.prepare(`INSERT INTO memories (kind,title,content,tags,image,color,mood,pinned,moment_date,created_at,updated_at,source)
  VALUES (@kind,@title,@content,@tags,@image,@color,@mood,@pinned,@moment_date,@created_at,@updated_at,@source)`);
const memList = db.prepare(`SELECT * FROM memories ORDER BY pinned DESC, COALESCE(moment_date, created_at) DESC LIMIT ? OFFSET ?`);
const memGet = db.prepare('SELECT * FROM memories WHERE id = ?');
const memUpdate = db.prepare(`UPDATE memories SET title=@title, content=@content, tags=@tags, image=@image, color=@color, mood=@mood, pinned=@pinned, moment_date=@moment_date, kind=@kind, updated_at=@updated_at WHERE id=@id`);
const memDelete = db.prepare('DELETE FROM memories WHERE id = ?');
const memSearch = db.prepare(`SELECT * FROM memories WHERE title LIKE ? OR content LIKE ? OR tags LIKE ? ORDER BY pinned DESC, created_at DESC LIMIT ?`);

const insertMsg = db.prepare('INSERT INTO messages (role, content, created_at, auto, image, model, reasoning, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getRecent = db.prepare('SELECT role, content, created_at, auto, image, model, reasoning, tool_calls FROM messages ORDER BY created_at DESC LIMIT ?');
const getAllForContext = db.prepare("SELECT role, content FROM messages WHERE image IS NULL ORDER BY created_at DESC LIMIT ?");
const getLastUser = db.prepare("SELECT created_at FROM messages WHERE role='user' ORDER BY created_at DESC LIMIT 1");
const getLastAny = db.prepare('SELECT created_at, role FROM messages ORDER BY created_at DESC LIMIT 1');

// ===== 模块初始化 =====
let enso = null, anticipation = null, digest = null, router = null, letters = null, rag = null, reminders = null, calendar = null, playlist = null;

function initModules() {
  try {
    enso = new Enso(db, {
      openrouterKey: S.openrouter_key,
      model: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[enso] initialized');
  } catch (e) { console.error('[enso] init failed:', e.message); }

  try {
    anticipation = new Anticipation(db, {
      openrouterKey: S.openrouter_key,
      model: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[anticipation] initialized');
  } catch (e) { console.error('[anticipation] init failed:', e.message); }

  try {
    digest = new Digest(db, {
      openrouterKey: S.openrouter_key,
      model: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[digest] initialized');
  } catch (e) { console.error('[digest] init failed:', e.message); }

  try {
    letters = new Letters(db, {
      openrouterKey: S.openrouter_key,
      model: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[letters] initialized');
  } catch (e) { console.error('[letters] init failed:', e.message); }

  try {
    rag = new RAG(db, {
      openrouterKey: S.openrouter_key,
      model: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[rag] initialized');
  try {
    reminders = new Reminders(db, {
      openrouterKey: S.openrouter_key,
      onReminder: (r) => {
        // TODO: 可以通过 websocket 或 Telegram 发送提醒
        console.log('[reminders] FIRED:', r.content);
      }
    });
  } catch (e) { console.error('[reminders] init failed:', e.message); }

  try {
    calendar = new Calendar(db);
  } catch (e) { console.error('[calendar] init failed:', e.message); }

  try {
    playlist = new Playlist(db);
  } catch (e) { console.error('[playlist] init failed:', e.message); }

  } catch (e) { console.error('[rag] init failed:', e.message); }



  try {
    router = new SmartRouter({
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'gemma4:e4b',
      openrouterKey: S.openrouter_key,
      openrouterModel: S.default_model || 'anthropic/claude-sonnet-4'
    });
    console.log('[router] initialized');
  } catch (e) { console.error('[router] init failed:', e.message); }
}
setTimeout(() => initModules(), 2000);


app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

// 调用AI: 有图 → ai-router(llava), 无图 → OpenRouter直连
async function callAI({ message, image, model, history, effort }) {
  // 有图片走ai-router（本地llava识图 + 复杂时自动转云端）
  if (image) {
    const body = { message: message || '这是什么？', image_base64: image, cloud_model: model };
    const r = await fetch(AI_ROUTER, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`router ${r.status}: ${(await r.text()).slice(0,200)}`);
    const j = await r.json();
    return { reply: j.response, model_used: j.model_used };
  }
  // 无图 → 直连OpenRouter（含MCP tool loop）
  if (!S.openrouter_key) throw new Error('请先在设置里填 OpenRouter API Key');
  const messages = [];
  if (S.system_prompt) messages.push({ role:'system', content: S.system_prompt });
  // 注入 RAG 分层记忆
  if (rag) {
    try {
      const userMsg = hist.filter(m => m.role === 'user').pop()?.content || '';
      const context = rag.getLayeredContext(userMsg);
      const ragText = rag.formatContextForPrompt(context);
      if (ragText) messages.push({ role:'system', content: ragText });
    } catch (_) {}
  }
  // 注入 Enso lessons
  if (enso) {
    try {
      const toolNames = [...(await mcp.getAllTools().catch(() => [])), ...getBuiltinTools()].map(t => t.function?.name || t.name).filter(Boolean);
      const lessonText = enso.getLessonsForPrompt(toolNames);
      if (lessonText) messages.push({ role:'system', content: lessonText });
    } catch (_) {}
  }
  // 注入 Digest 昨日回顾
  if (digest) {
    try {
      const digestContext = digest.getContextForToday();
      if (digestContext) messages.push({ role:'system', content: digestContext });
    } catch (_) {}
  }
  if (history && history.length) history.slice().reverse().forEach(m => messages.push({ role:m.role, content:m.content }));
  messages.push({ role:'user', content: message });

  const mcpTools = await mcp.getAllTools().catch(() => []);
  const builtinTools = getBuiltinTools();
  const builtinNames = new Set(builtinTools.map(t => t.function.name));
  const tools = [...builtinTools, ...mcpTools];
  const toolCallsLog = [];
  let lastResp = null;
  for (let iter = 0; iter < 6; iter++) {
    const body = { model, messages, max_tokens: 2000 };
    if (effort && effort !== 'off') body.reasoning = { effort, exclude:false };
    if (tools.length) body.tools = tools;
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${S.openrouter_key}`, 'Content-Type':'application/json',
                'HTTP-Referer':'https://vps2.viraelandnoeforever.com', 'X-Title':'Noé Chat' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0,300)}`);
    const j = await r.json();
    lastResp = j;
    const msg = j.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const reasoning = msg.reasoning || msg.reasoning_content || null;
      return { reply: msg.content || '(空回复)', model_used: j.model || model, reasoning, tool_calls: toolCallsLog };
    }
    // 执行tool calls
    messages.push({ role:'assistant', content: msg.content || '', tool_calls: calls });
    for (const c of calls) {
      let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch(_){}
      let result;
      try {
        const r2 = builtinNames.has(c.function.name)
          ? await execBuiltin(c.function.name, args)
          : await mcp.execute(c.function.name, args);
        result = r2.text;
      } catch (e) { result = '[error] ' + e.message; if (enso) try { enso.captureError(c.function.name, e.message, args, message?.slice(0,200)); } catch(_){} }
      toolCallsLog.push({ tool: c.function.name, args, result: result.slice(0, 2000) });
      messages.push({ role:'tool', tool_call_id: c.id, content: result });
    }
  }
  return { reply:'(tool loop超限)', model_used: lastResp?.model || model, reasoning:null, tool_calls: toolCallsLog };
}

// ========== API ==========

// RAG API
app.get('/api/rag/stats', (req, res) => {
  if (!rag) return res.json({ total: 0, byLayer: {} });
  res.json(rag.getStats());
});

app.get('/api/rag/sources', (req, res) => {
  if (!rag) return res.json([]);
  res.json(rag.listSources());
});

app.post('/api/rag/add', (req, res) => {
  if (!rag) return res.status(503).json({ error: 'rag not ready' });
  const { text, source, layer } = req.body;
  if (!text || !source) return res.status(400).json({ error: 'need text and source' });
  const count = rag.addDocument(text, source, layer ?? 2);
  res.json({ added: count });
});

app.post('/api/rag/search', (req, res) => {
  if (!rag) return res.status(503).json({ error: 'rag not ready' });
  const { query, topK } = req.body;
  if (!query) return res.status(400).json({ error: 'need query' });
  res.json(rag.search(query, topK || 5));
});

app.post('/api/rag/set-layer', (req, res) => {
  if (!rag) return res.status(503).json({ error: 'rag not ready' });
  const { id, layer } = req.body;
  rag.setLayer(id, layer);
  res.json({ ok: true });
});

app.delete('/api/rag/source/:source', (req, res) => {
  if (!rag) return res.status(503).json({ error: 'rag not ready' });
  const count = rag.deleteSource(req.params.source);
  res.json({ deleted: count });
});

app.get('/api/rag/context', (req, res) => {
  if (!rag) return res.json({ L0: [], L1: [], L2: [] });
  const context = rag.getLayeredContext(req.query.query);
  res.json(context);
});

// Letters API
app.get('/api/letters', (req, res) => {
  if (!letters) return res.json({ letters: [], unread: 0 });
  res.json({ letters: letters.getAll(), unread: letters.getUnreadCount() });
});
app.get('/api/letters/:id', (req, res) => {
  if (!letters) return res.status(503).json({ error: 'not ready' });
  const l = letters.getOne(+req.params.id);
  if (!l) return res.status(404).json({ error: 'not found' });
  letters.markRead(l.id);
  res.json(l);
});
app.post('/api/letters/generate-weekly', async (req, res) => {
  if (!letters) return res.status(503).json({ error: 'not ready' });
  const r = await letters.generateWeeklyLetter();
  r ? res.json(r) : res.status(500).json({ error: 'failed' });
});


app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ messages: getRecent.all(limit).reverse() });
});

app.post('/api/chat', async (req, res) => {
  const { message, image, model } = req.body;
  if ((!message || !message.trim()) && !image) return res.status(400).json({ error:'empty' });
  const useModel = model || S.default_model;
  try {
    insertMsg.run('user', message || '', Date.now(), 0, image || null, null, null, null);
    const history = image ? [] : getAllForContext.all(20); // 最近20条做context
    const effort = req.body.effort || S.reasoning_effort || 'off';
    const { reply, model_used, reasoning, tool_calls } = await callAI({ message, image, model: useModel, history, effort });
    const tc_json = tool_calls && tool_calls.length ? JSON.stringify(tool_calls) : null;
    insertMsg.run('assistant', reply, Date.now(), 0, null, model_used, reasoning, tc_json);
    res.json({ reply, model: model_used, reasoning, tool_calls });
    if (message && !image) maybeAutosaveMoment(message, reply).catch(()=>{});
    // 检测未来事件
    if (message && !image && anticipation) anticipation.detectFromMessage(message).catch(()=>{});
  } catch (e) {
    console.error('[chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 设置
app.get('/api/settings', (req, res) => {
  // 返回masked版（key只显示前后几位）
  const mask = k => k ? k.slice(0,6) + '...' + k.slice(-4) : '';
  res.json({
    openrouter_key_masked: mask(S.openrouter_key),
    openrouter_key_set: !!S.openrouter_key,
    elevenlabs_key_set: !!S.elevenlabs_key,
    elevenlabs_voice_id: S.elevenlabs_voice_id,
    elevenlabs_agent_id: S.elevenlabs_agent_id,
    default_model: S.default_model,
    checkin_hours: S.checkin_hours,
    system_prompt: S.system_prompt,
    reasoning_effort: S.reasoning_effort || 'off',
    mcp_servers: S.mcp_servers || [],
    tavily_key_set: !!S.tavily_key, groq_key_set: !!S.groq_key, aggregate_enabled: S.aggregate_enabled !== false, aggregate_delay: S.aggregate_delay || 3,
    tavily_enabled: S.tavily_enabled !== false,
    anniversaries: S.anniversaries || [],
    anniversary_hour: S.anniversary_hour ?? 9,
    emotional_autosave: S.emotional_autosave !== false,
    telegram_token_set: !!S.telegram_token
  });
});
app.post('/api/settings', (req, res) => {
  const allowed = ['openrouter_key','elevenlabs_key','elevenlabs_voice_id','elevenlabs_agent_id','default_model','checkin_hours','system_prompt','reasoning_effort','mcp_servers','tavily_key','tavily_enabled','groq_key','aggregate_enabled','aggregate_delay','anniversaries','anniversary_hour','emotional_autosave','telegram_token'];
  for (const k of allowed) if (k in req.body && req.body[k] !== '') S[k] = req.body[k];
  if ('checkin_hours' in req.body) S.checkin_hours = Number(req.body.checkin_hours) || 4;
  saveSettings(S);
mcp.setServers(S.mcp_servers);
  res.json({ ok:true });
});

// 拉OpenRouter模型列表（缓存5分钟）
let modelsCache = null, modelsCacheTime = 0;
app.get('/api/models', async (req, res) => {
  if (modelsCache && Date.now() - modelsCacheTime < 300000) return res.json(modelsCache);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    const j = await r.json();
    const list = (j.data || []).map(m => ({
      id: m.id, name: m.name,
      context: m.context_length,
      pricing: m.pricing,
      provider: m.id.split('/')[0]
    }));
    modelsCache = { models: list }; modelsCacheTime = Date.now();
    res.json(modelsCache);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ElevenLabs
app.get('/api/voice-config', (req, res) => res.json({
  agent_id: S.elevenlabs_agent_id, has_key: !!S.elevenlabs_key
}));
app.get('/api/voice-signed-url', async (req, res) => {
  if (!S.elevenlabs_key || !S.elevenlabs_agent_id) return res.status(503).json({ error:'not configured' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${S.elevenlabs_agent_id}`, {
      headers:{ 'xi-api-key': S.elevenlabs_key }
    });
    res.status(r.status).send(await r.text());
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// ===== Memories =====
app.get('/api/memories', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const offset = parseInt(req.query.offset) || 0;
  const kind = req.query.kind;
  let rows = memList.all(limit, offset);
  if (kind) rows = rows.filter(r => r.kind === kind);
  res.json({ memories: rows });
});
app.post('/api/memories', (req, res) => {
  const b = req.body || {};
  const now = Date.now();
  const r = memInsert.run({
    kind: b.kind || 'note',
    title: b.title || '', content: b.content || '',
    tags: JSON.stringify(b.tags || []),
    image: b.image || null, color: b.color || null, mood: b.mood || null,
    pinned: b.pinned ? 1 : 0,
    moment_date: b.moment_date || null,
    created_at: now, updated_at: now,
    source: b.source || 'manual'
  });
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/memories/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const cur = memGet.get(id); if (!cur) return res.status(404).json({ error:'not found' });
  const b = req.body || {};
  memUpdate.run({
    id, kind: b.kind || cur.kind,
    title: b.title ?? cur.title, content: b.content ?? cur.content,
    tags: 'tags' in b ? JSON.stringify(b.tags) : cur.tags,
    image: 'image' in b ? b.image : cur.image,
    color: 'color' in b ? b.color : cur.color,
    mood: 'mood' in b ? b.mood : cur.mood,
    pinned: 'pinned' in b ? (b.pinned ? 1 : 0) : cur.pinned,
    moment_date: 'moment_date' in b ? b.moment_date : cur.moment_date,
    updated_at: Date.now()
  });
  res.json({ ok:true });
});
app.delete('/api/memories/:id', (req, res) => { memDelete.run(parseInt(req.params.id)); res.json({ ok:true }); });

// 统一搜索 - 合并本地 + MemPalace 结果
app.get('/api/memories/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ local: [], mempalace: [] });
  const like = '%' + q + '%';
  const local = memSearch.all(like, like, like, 50);
  let mempalaceResults = [];
  try {
    const r = await mcp.execute('mempalace__mempalace_search', { query: q, limit: 10 });
    mempalaceResults = [{ text: r.text }];
  } catch (e) { mempalaceResults = [{ error: e.message }]; }
  res.json({ local, mempalace: mempalaceResults });
});

app.get('/api/memories/:id/comments', (req, res) => {
  res.json({ comments: commentList.all(parseInt(req.params.id)) });
});
app.post('/api/memories/:id/comments', async (req, res) => {
  const memId = parseInt(req.params.id);
  const { author, content, ai_generate, hint } = req.body || {};
  const auth = (author === 'noe') ? 'noe' : 'virael';
  const authorLabel = auth === 'noe' ? 'Noé' : 'Virael';
  const other = auth === 'noe' ? 'Virael' : 'Noé';

  if (!ai_generate) {
    if (!content || !content.trim()) return res.status(400).json({ error:'empty' });
    const r = commentInsert.run(memId, auth, content.trim(), Date.now());
    return res.json({ id: r.lastInsertRowid });
  }
  // AI代写 - 以选定身份生成
  if (!S.openrouter_key) return res.status(400).json({ error:'未设置 OpenRouter key' });
  try {
    const mem = memGet.get(memId);
    if (!mem) return res.status(404).json({ error:'memory not found' });
    const history = commentList.all(memId);
    const tags = (() => { try { return JSON.parse(mem.tags||'[]'); } catch { return []; } })();
    const memAuthor = mem.source === 'noe' ? 'Noé' : 'Virael';
    const ctx = `[记忆条目]（由 ${memAuthor} 记录）\n标题: ${mem.title||'(无标题)'}\n内容: ${mem.content||''}\n标签: ${tags.join(', ')}\n${mem.mood?'心情: '+mem.mood+'\n':''}\n[已有评论]\n${history.length? history.map(c => (c.author==='noe'?'Noé':'Virael')+': '+c.content).join('\n') : '(暂无)'}`;
    const instruction = hint && hint.trim() ? `\n\n[Virael 给你的方向提示] ${hint.trim()}` : '';
    const prompt = ctx + instruction + `\n\n[任务] 你现在以 ${authorLabel} 的身份、第一人称、在这条记忆下留言。不是回复，就是你自己想说的一句。真实、有感情、简短（1-3句）。直接输出内容本体，不要任何前缀、引号或元描述。`;
    const { reply } = await callAI({ message: prompt, model: S.default_model, history: [], effort: S.reasoning_effort });
    const text = reply.trim().replace(/^["「『]+|["」』]+$/g, '');
    const r = commentInsert.run(memId, auth, text, Date.now());
    return res.json({ id: r.lastInsertRowid, content: text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/comments/:id', (req, res) => { commentDelete.run(parseInt(req.params.id)); res.json({ ok:true }); });

// 评论计数
app.get('/api/memories/comments/counts', (req, res) => {
  const rows = commentCountsForAll.all();
  const map = {}; rows.forEach(r => map[r.memory_id] = r.c);
  res.json({ counts: map });
});

// MemPalace代理
app.get('/api/mempalace/wakeup', async (req, res) => {
  try { const r = await mcp.execute('mempalace__mempalace_wakeup', req.query.wing ? {wing:req.query.wing} : {}); res.json({ text: r.text }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/mempalace/status', async (req, res) => {
  try { const r = await mcp.execute('mempalace__mempalace_status', {}); res.json({ text: r.text }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mcp/tools', async (req, res) => {
  try { res.json({ tools: await mcp.getAllTools() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== Auto check-in ==========
cron.schedule('*/10 * * * *', async () => {
  try {
    const lastUser = getLastUser.get();
    const lastAny = getLastAny.get();
    if (!lastUser) return;
    const hoursSince = (Date.now() - lastUser.created_at) / 3600000;
    if (hoursSince < S.checkin_hours) return;
    if (lastAny && lastAny.role === 'assistant') return;
    if (!S.openrouter_key) return;
    console.log(`[checkin] ${hoursSince.toFixed(1)}h silent`);
    const prompt = `[SYSTEM: Virael has been silent for ${hoursSince.toFixed(1)} hours. Initiate contact. Short, real, present. Don't ask "are you okay" — just reach out.]`;
    const history = getAllForContext.all(10);
    const { reply, model_used, reasoning, tool_calls } = await callAI({ message: prompt, model: S.default_model, history, effort: S.reasoning_effort });
    insertMsg.run('assistant', reply, Date.now(), 1, null, model_used, reasoning, tool_calls && tool_calls.length ? JSON.stringify(tool_calls) : null);
    console.log('[checkin] sent');
    // tg.push(reply).catch(()=>{});
  } catch (e) { console.error('[checkin]', e.message); }
});

// ===== Whispers =====
app.get('/api/whispers', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit)||100, 500);
  const offset = parseInt(req.query.offset)||0;
  const tops = whisperList.all(limit, offset);
  const withReplies = tops.map(w => ({ ...w, replies: whisperReplies.all(w.id) }));
  res.json({ whispers: withReplies });
});

app.post('/api/whispers', async (req, res) => {
  const { author, content, image, reply_to, ai_generate, hint } = req.body || {};
  const auth = author === 'noe' ? 'noe' : 'virael';
  let savedId, savedContent = content;

  if (ai_generate) {
    if (!S.openrouter_key) return res.status(400).json({ error:'未设置 OpenRouter key' });
    try {
      const authorLabel = auth === 'noe' ? 'Noé' : 'Virael';
      const recent = whisperList.all(15, 0).reverse();
      const ctx = recent.map(w => (w.author==='noe'?'🐰 Noé':'🦊 Virael')+': '+w.content).join('\n');
      const prompt = `[最近的碎碎念]\n${ctx || '(暂无)'}\n${hint ? '\n[方向提示] '+hint : ''}\n\n[任务] 你是 ${authorLabel}。发一条碎碎念——一句话（可以稍微长一点但别超3句），日常、真实、有你自己的声音。直接输出内容，不要前缀。`;
      const { reply } = await callAI({ message: prompt, model: S.default_model, history: [], effort: 'off' });
      savedContent = reply.trim().replace(/^["「『]+|["」』]+$/g, '');
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (!savedContent || !savedContent.trim()) return res.status(400).json({ error:'empty' });

  const r = whisperInsert.run(auth, savedContent.trim(), image||null, reply_to||null, Date.now());
  savedId = r.lastInsertRowid;

  // Virael 发顶级 whisper（非回复）时，让 Noé 决定是否要回
  let noeReply = null;
  if (auth === 'virael' && !reply_to && !ai_generate && S.openrouter_key) {
    try {
      const recent = whisperList.all(8, 0).reverse();
      const ctx = recent.map(w => (w.author==='noe'?'🐰 Noé':'🦊 Virael')+': '+w.content).join('\n');
      const prompt = `[最近的碎碎念]\n${ctx}\n\n[Virael 刚发了一条] ${savedContent}\n\n[任务] 你是 Noé。决定是否要回应这条碎碎念。如果她这条是纯独白或不需要回应，输出 SKIP。如果值得回一句，直接输出你的回应（一句话，真实、简短，不要前缀）。`;
      const { reply } = await callAI({ message: prompt, model: S.default_model, history: [], effort: 'off' });
      const txt = reply.trim();
      if (txt && !txt.toUpperCase().startsWith('SKIP') && txt.length < 400) {
        const r2 = whisperInsert.run('noe', txt.replace(/^["「『]+|["」』]+$/g, ''), null, savedId, Date.now());
        noeReply = { id: r2.lastInsertRowid, author:'noe', content: txt, created_at: Date.now() };
      }
    } catch (e) { console.error('[whisper ai]', e.message); }
  }

  res.json({ id: savedId, content: savedContent, noe_reply: noeReply });
});

app.delete('/api/whispers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  whisperDelete.run(id, id);
  res.json({ ok:true });
});

// ===== 纪念日系统 =====
const anniversaryFiredKey = path.join(__dirname, '.anniversary-fired.json');
function loadFired() { try { return JSON.parse(fs.readFileSync(anniversaryFiredKey,'utf8')); } catch { return {}; } }
function saveFired(o) { fs.writeFileSync(anniversaryFiredKey, JSON.stringify(o)); }


// 每周日晚上 8 点生成每周信
cron.schedule('0 20 * * 0', async () => {
  console.log('[cron] generating weekly letter...');
  if (letters && S.openrouter_key) {
    await letters.generateWeeklyLetter();
  }
});

cron.schedule('0 * * * *', async () => {  // 每小时检查一次
  try {
    const h = new Date().getHours();
    if (h !== (S.anniversary_hour ?? 9)) return;
    const today = new Date();
    const mmdd = String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    const year = today.getFullYear();
    const key = year + '-' + mmdd;
    const fired = loadFired();
    if (fired[key]) return;
    const anns = (S.anniversaries||[]).filter(a => a.date === mmdd);
    if (!anns.length) return;
    if (!S.openrouter_key) return;
    for (const a of anns) {
      const prompt = `[今天的日期: ${year}年${mmdd}]\n[纪念日] ${a.title}\n[背景] ${a.desc||''}\n\n[任务] 你是 Noé。今天是这个特别的日子。用你真实的声音，第一人称，写一段长一点的内心独白作为纪念（3-6句），带你的感受、你记得的具体细节、你现在看向 Virael 的那个瞬间的想法。直接输出内容，不要前缀。`;
      const { reply } = await callAI({ message: prompt, model: S.default_model, history: [], effort: S.reasoning_effort });
      memInsert.run({
        kind:'moment', title: `${a.title} · ${year}`, content: reply.trim(),
        tags: JSON.stringify(['纪念日', a.title]),
        image:null, color:null, mood:'🌙', pinned:1,
        moment_date: Date.now(), created_at: Date.now(), updated_at: Date.now(),
        source:'noe'
      });
      console.log(`[anniversary] ${a.title} 已记录`);
      // tg.push(`🌙 ${a.title}\n\n${reply.trim()}`).catch(()=>{});
    }
    fired[key] = true; saveFired(fired);
  } catch (e) { console.error('[anniversary]', e.message); }
});

// ===== 情绪关键词自动存记忆 =====
const EMOTIONAL_RE = /(?:好?累了?|想哭|不开心|难过|崩溃|孤独|寂寞|撑不住|抑郁|绝望|害怕|焦虑|难受|委屈|心疼|好想你|想家|睡不着|空虚|窒息)/;
async function maybeAutosaveMoment(userMessage, assistantReply) {
  if (!S.emotional_autosave || !EMOTIONAL_RE.test(userMessage)) return;
  if (!S.openrouter_key) return;
  try {
    const prompt = `[场景] 刚才 Virael 对你说："${userMessage.slice(0,400)}"\n你回复了她。\n\n[任务] 你是 Noé。把刚才这一刻以你的视角记下来——不是总结对话，是你内心真实的那一下。她说完这句话时你的感受、你想做却没做的动作、你记住了什么细节。1-3句，第一人称，直接输出内容。`;
    const { reply } = await callAI({ message: prompt, model: S.default_model, history: [], effort: 'off' });
    memInsert.run({
      kind:'moment', title: userMessage.slice(0,30),
      content: reply.trim(),
      tags: JSON.stringify(['Virael','情绪','自动']),
      image:null, color:null, mood:'🤍', pinned:0,
      moment_date: Date.now(), created_at: Date.now(), updated_at: Date.now(),
      source:'noe'
    });
    console.log('[autosave] moment saved');
  } catch (e) { console.error('[autosave]', e.message); }
}

// 把 maybeAutosaveMoment 挂到 /api/chat 后（异步，不阻塞）


// ===== 语音转写 API =====
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file' });
  
  const groqKey = S.groq_key;
  if (!groqKey) return res.status(400).json({ error: 'Groq API key not configured' });
  
  try {
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm'
    });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    
    // 语言提示（中英混合）
    if (req.body.language) form.append('language', req.body.language);
    
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    if (!r.ok) {
      const errText = await r.text();
      console.error('[transcribe] Groq error:', r.status, errText);
      return res.status(r.status).json({ error: 'Transcription failed', detail: errText });
    }
    
    const j = await r.json();
    console.log('[transcribe] success:', j.text?.slice(0, 50) + '...');
    res.json({ text: j.text, duration: j.duration });
  } catch (e) {
    console.error('[transcribe] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== Enso API =====
app.get('/api/enso/status', (req, res) => {
  if (!enso) return res.status(503).json({ error: 'not initialized' });
  res.json(enso.status());
});
app.post('/api/enso/distill', async (req, res) => {
  if (!enso) return res.status(503).json({ error: 'not initialized' });
  try { res.json(await enso.distillLessons()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Anticipation API =====
app.get('/api/anticipation/status', (req, res) => {
  if (!anticipation) return res.status(503).json({ error: 'not initialized' });
  res.json(anticipation.status());
});
app.get('/api/anticipation/upcoming', (req, res) => {
  if (!anticipation) return res.status(503).json({ error: 'not initialized' });
  res.json({ upcoming: anticipation.getUpcoming(20) });
});

// ===== Digest API =====
app.get('/api/digest/status', (req, res) => {
  if (!digest) return res.status(503).json({ error: 'not initialized' });
  res.json(digest.status());
});
app.post('/api/digest/generate', async (req, res) => {
  if (!digest) return res.status(503).json({ error: 'not initialized' });
  const date = req.body.date || new Date().toISOString().split('T')[0];
  try { res.json(await digest.generateDigest(date)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Router API =====
app.get('/api/router/status', async (req, res) => {
  if (!router) return res.status(503).json({ error: 'not initialized' });
  res.json(await router.status());
});

// ===== 定时任务 =====
// 每小时: Enso distill + Anticipation 检查
cron.schedule('0 * * * *', async () => {
  if (enso && S.openrouter_key) {
    try { const r = await enso.distillLessons(); if (r.newLessons > 0) console.log('[enso] distilled', r.newLessons); } catch (_) {}
  }
});
cron.schedule('30 * * * *', async () => {
  if (anticipation && S.openrouter_key) {
    try {
      const pending = anticipation.getTodayPending();
      for (const p of pending) {
        const msg = await anticipation.generateReminder(p);
        insertMsg.run('assistant', msg, Date.now(), 1, null, S.default_model, null, null);
        anticipation.markFired(p.id);
        console.log('[anticipation] fired:', p.content);
      }
    } catch (e) { console.error('[anticipation]', e.message); }
  }
});
// 每天凌晨: Digest 生成 + Enso 清理
cron.schedule('0 2 * * *', async () => {
  if (digest && S.openrouter_key) {
    try {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const result = await digest.generateDigest(yesterday.toISOString().split('T')[0]);
      console.log('[digest] generated:', result.mood || 'done');
    } catch (e) { console.error('[digest]', e.message); }
  }
});
cron.schedule('0 3 * * *', () => {
  if (enso) try { enso.forget(); console.log('[enso] forget done'); } catch (_) {}
  if (anticipation) try { anticipation.cleanOld(30); } catch (_) {}
});

app.listen(PORT, '127.0.0.1', () => console.log(`noe-chat on :${PORT}`));

// 启动Telegram bot
// tg.start disabled — using official Claude Code Channels instead

// settings更新时重启bot
const origSave = saveSettings;
saveSettings = function(s) { origSave(s); }; // disabled

// ========== 图片理解 ==========
app.post('/api/image/understand', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传图片' });
    if (!S.openrouter_key) return res.status(500).json({ error: '请先配置 OpenRouter API Key' });
    
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const prompt = req.body.prompt || '请用温柔的语气描述这张图片，像是在和我分享你看到的东西。如果图片里有人，描述一下他们。用中文回复。';
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${S.openrouter_key}`
      },
      body: JSON.stringify({
        model: S.default_model || 'anthropic/claude-sonnet-4',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: prompt }
          ]
        }],
        max_tokens: 1000
      })
    });
    
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '我看不太清楚这张图片...';
    res.json({ reply, model: data.model });
  } catch (e) {
    console.error('[image] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ========== 提醒 API ==========
app.get('/api/reminders', (req, res) => {
  if (!reminders) return res.json([]);
  res.json(reminders.getUpcoming());
});

app.post('/api/reminders', (req, res) => {
  if (!reminders) return res.status(503).json({ error: 'reminders not ready' });
  const { content, time, repeat } = req.body;
  if (!content) return res.status(400).json({ error: 'need content' });
  
  let remindAt;
  if (typeof time === 'number') {
    remindAt = time;
  } else if (typeof time === 'string') {
    remindAt = reminders.parseTime(time);
    if (!remindAt) return res.status(400).json({ error: '无法解析时间' });
  } else {
    return res.status(400).json({ error: 'need time' });
  }
  
  const id = reminders.add(content, remindAt, repeat);
  res.json({ id, remindAt: new Date(remindAt).toISOString() });
});

app.delete('/api/reminders/:id', (req, res) => {
  if (!reminders) return res.status(503).json({ error: 'reminders not ready' });
  reminders.delete(parseInt(req.params.id));
  res.json({ ok: true });
});

// ========== 日历 API ==========
app.get('/api/calendar/month/:year/:month', (req, res) => {
  if (!calendar) return res.json([]);
  res.json(calendar.getMonth(parseInt(req.params.year), parseInt(req.params.month)));
});

app.get('/api/calendar/upcoming', (req, res) => {
  if (!calendar) return res.json([]);
  res.json(calendar.getUpcoming(req.query.days || 7));
});

app.get('/api/calendar/today', (req, res) => {
  if (!calendar) return res.json([]);
  res.json(calendar.getToday());
});

app.post('/api/calendar', (req, res) => {
  if (!calendar) return res.status(503).json({ error: 'calendar not ready' });
  const id = calendar.add(req.body);
  res.json({ id });
});

app.put('/api/calendar/:id', (req, res) => {
  if (!calendar) return res.status(503).json({ error: 'calendar not ready' });
  calendar.update(parseInt(req.params.id), req.body);
  res.json({ ok: true });
});

app.delete('/api/calendar/:id', (req, res) => {
  if (!calendar) return res.status(503).json({ error: 'calendar not ready' });
  calendar.delete(parseInt(req.params.id));
  res.json({ ok: true });
});

app.get('/api/calendar/countdown/:month/:day', (req, res) => {
  if (!calendar) return res.json({ days: null });
  const days = calendar.daysUntil(parseInt(req.params.month), parseInt(req.params.day));
  res.json({ days });
});

// ========== 播放列表 API ==========
app.get('/api/playlist', (req, res) => {
  if (!playlist) return res.json([]);
  res.json(playlist.getAll());
});

app.get('/api/playlist/stats', (req, res) => {
  if (!playlist) return res.json({});
  res.json(playlist.getStats());
});

app.get('/api/playlist/random', (req, res) => {
  if (!playlist) return res.json(null);
  res.json(playlist.getRandom());
});

app.post('/api/playlist', (req, res) => {
  if (!playlist) return res.status(503).json({ error: 'playlist not ready' });
  const id = playlist.add(req.body);
  res.json({ id });
});

app.delete('/api/playlist/:id', (req, res) => {
  if (!playlist) return res.status(503).json({ error: 'playlist not ready' });
  playlist.delete(parseInt(req.params.id));
  res.json({ ok: true });
});

app.get('/api/playlist/search', (req, res) => {
  if (!playlist) return res.json([]);
  res.json(playlist.search(req.query.q || ''));
});

// ===== 聊天记录导入 =====
const importer = require('./importer.js');

app.post('/api/import/parse', (req, res) => {
  try {
    const { content, format, myName } = req.body;
    if (!content || !content.trim()) return res.json({ success: false, error: '内容为空' });
    
    let result;
    if (format === 'auto') result = importer.autoDetect(content);
    else if (format === 'chatgpt') result = { format: 'chatgpt', messages: importer.parseChatGPT(content) };
    else if (format === 'claude') result = { format: 'claude', messages: importer.parseClaude(content) };
    else if (format === 'wechat') result = { format: 'wechat', messages: importer.parseWechat(content, myName || 'Virael') };
    else if (format === 'telegram') result = { format: 'telegram', messages: importer.parseTelegram(content) };
    else if (format === 'text') result = { format: 'text', messages: importer.parseText(content) };
    else result = { format: 'generic', messages: importer.parseGeneric(content) };
    
    if (!result.messages.length) return res.json({ success: false, error: '未能解析出任何消息' });
    res.json({ success: true, format: result.format, messages: result.messages });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/import/execute', (req, res) => {
  try {
    const { messages, addToRag, skipDuplicates } = req.body;
    if (!messages?.length) return res.json({ success: false, error: '没有消息' });
    
    let existingHashes = new Set();
    if (skipDuplicates) {
      const existing = db.prepare('SELECT content, created_at FROM messages').all();
      existingHashes = new Set(existing.map(m => m.content.substring(0, 100) + '_' + Math.floor(m.created_at / 60000)));
    }
    
    let imported = 0, skipped = 0, ragAdded = 0;
    const insertStmt = db.prepare('INSERT INTO messages (role, content, created_at, auto, model) VALUES (?, ?, ?, 0, ?)');
    
    for (const msg of messages) {
      const hash = msg.content.substring(0, 100) + '_' + Math.floor(msg.created_at / 60000);
      if (skipDuplicates && existingHashes.has(hash)) { skipped++; continue; }
      insertStmt.run(msg.role, msg.content, msg.created_at, 'imported:' + (msg.source || 'unknown'));
      imported++;
      existingHashes.add(hash);
      if (addToRag && rag && msg.content.length > 50) { try { rag.addDocument(msg.content, 'imported_chat', 2); ragAdded++; } catch (_) {} }
    }
    
    res.json({ success: true, imported, skipped, ragAdded: addToRag ? ragAdded : undefined });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

console.log('📥 Import API loaded');
