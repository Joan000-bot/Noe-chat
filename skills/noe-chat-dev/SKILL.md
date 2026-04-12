---
name: noe-chat-dev
description: |
  vps2 上的 noe-chat 项目开发指南。这是 Virael 的私人 AI 聊天系统，运行在 66.94.126.98:4300。
  当需要修改 noe-chat 功能、添加新模块、调试问题、或理解项目架构时使用此 skill。
  触发场景：提到 vps2、noe-chat、chat.viraelandnoeforever.com、语音转写、对话聚合、
  Enso/Anticipation/Digest 模块、或任何涉及这个聊天系统的开发工作。
---

# Noé Chat 开发指南

Virael 的私人 AI 聊天系统，运行在 vps2 (66.94.126.98)。

## 快速信息

| 项目 | 值 |
|------|-----|
| 服务器 | vps2 (66.94.126.98) |
| 端口 | 4300 (bind 127.0.0.1) |
| 域名 | chat.viraelandnoeforever.com |
| PM2 名称 | noe-chat (id=1) |
| 项目路径 | `/root/noe-chat/` |
| 数据库 | `/root/noe-chat/chat.db` (SQLite) |

## 技术栈

- **后端**: Express.js + better-sqlite3
- **AI**: OpenRouter API (`anthropic/claude-sonnet-4` 默认)
- **本地 AI**: Ollama + Gemma 4 e4b (简单任务)
- **语音转写**: Groq Whisper API
- **前端**: 单文件 `public/chat.html` (vanilla JS)

## 文件结构

```
/root/noe-chat/
├── server.js          # 主服务器 (~750行)
├── chat.db            # SQLite 数据库
├── settings.json      # 持久化配置
├── .env               # 环境变量 (dotenvx)
│
├── enso.js            # 自我学习模块
├── anticipation.js    # 未来事件追踪
├── digest.js          # 每日回顾
├── router.js          # 智能路由 (本地/云端)
├── mcp.js             # MCP 工具管理
│
├── public/
│   └── chat.html      # 主聊天界面 (~800行)
│
└── skills/            # 开发文档
    └── noe-chat-dev/
        └── SKILL.md   # 本文件
```

## 模块系统

### 1. Enso (自我学习)

**文件**: `enso.js`

捕获工具调用错误 → LLM 提取教训 → 注入 system prompt

```javascript
// 初始化
enso = new Enso(db, { openrouterKey, model });

// 捕获错误 (在工具调用 catch 块)
enso.captureError(toolName, errorMsg, args, userMessage);

// 提取教训 (cron 每小时整点)
await enso.distillLessons();

// 注入到 prompt
const lessons = enso.getLessonsForPrompt(toolNames);
```

**API**: `/api/enso/status`, `/api/enso/distill`

### 2. Anticipation (惦记)

**文件**: `anticipation.js`

检测用户消息中的未来事件 → 到时间主动想起

```javascript
// 检测 (在 /api/chat 后异步调用)
await anticipation.detectFromMessage(userMessage);

// 获取今天待触发
const pending = anticipation.getTodayPending();

// 生成提醒消息
const msg = await anticipation.generateReminder(item);
```

**数据表**: `anticipations` (content, target_date, fired, ...)

**API**: `/api/anticipation/status`, `/api/anticipation/upcoming`

### 3. Digest (每日回顾)

**文件**: `digest.js`

每天凌晨总结昨天对话 → 第二天注入上下文

```javascript
// 生成 (cron 凌晨2点)
await digest.generateDigest('2024-04-11');

// 注入到 prompt
const context = digest.getContextForToday();
```

**数据表**: `daily_digests` (date, summary, mood, highlights)

**API**: `/api/digest/status`, `/api/digest/generate`

### 4. SmartRouter (智能路由)

**文件**: `router.js`

简单任务 → Ollama 本地，复杂任务 → OpenRouter 云端

```javascript
router = new SmartRouter({
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma4:e4b',
  openrouterKey: '...',
  openrouterModel: 'anthropic/claude-sonnet-4'
});

// 自动路由
const result = await router.call(message, { needsTools: false });
// result.route = 'local' | 'cloud'
```

**API**: `/api/router/status`

## Cron 任务时间表

| 时间 | 任务 |
|------|------|
| 每10分钟 | Check-in (沉默超时检查) |
| 每小时整点 | Enso distill + 纪念日检查 |
| 每小时半点 | Anticipation 触发今日惦记 |
| 凌晨2点 | Digest 生成昨日回顾 |
| 凌晨3点 | Enso forget + 清理旧数据 |

## 前端修改指南

### 文件位置
`/root/noe-chat/public/chat.html`

### 常见修改

**添加设置项**:
1. HTML: 在 `<div class="panel">` 里加 `<input id="set-xxx">`
2. 加载: 在 `openSettings()` 里加 `getElementById('set-xxx').value = cfg.xxx`
3. 保存: 在 `saveSettings()` 的 body 里加 `xxx: getElementById('set-xxx').value`
4. 后端: 在 `allowed` 数组加 `'xxx'`，在 `/api/settings` 返回里加 `xxx: S.xxx`

**添加按钮**:
```html
<!-- 在 form#input 里 -->
<button type="button" id="my-btn" onclick="myFunc()">图标</button>
```

**添加 JS 功能**:
在 `</script>` 前加代码，记得 `window.myFunc = myFunc;`

### 验证 JS 语法
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('chat.html', 'utf8');
const match = html.match(/<script[^>]*>([\\s\\S]*?)<\\/script>/g);
match.forEach((s, i) => {
  try { new Function(s.replace(/<\\/?script[^>]*>/g, '')); console.log('Script', i+1, '✓'); }
  catch (e) { console.log('Script', i+1, '✗', e.message); }
});
"
```

## 后端修改指南

### 添加新 API

```javascript
// 在 app.listen 前添加
app.get('/api/myapi', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/myapi', async (req, res) => {
  const { param } = req.body;
  // ...
  res.json({ result });
});
```

### 添加新模块

1. 创建 `mymodule.js`:
```javascript
class MyModule {
  constructor(db, options = {}) {
    this.db = db;
    // 初始化表
    db.exec(`CREATE TABLE IF NOT EXISTS my_table (...)`);
  }
  // 方法...
}
module.exports = { MyModule };
```

2. 在 `server.js` 顶部 require:
```javascript
const { MyModule } = require('./mymodule');
```

3. 在 `initModules()` 里初始化:
```javascript
try {
  mymodule = new MyModule(db, { ... });
  console.log('[mymodule] initialized');
} catch (e) { console.error('[mymodule] init failed:', e.message); }
```

4. 添加 API 端点

### 添加设置项到 allowed 列表

```javascript
const allowed = ['openrouter_key', ..., 'my_new_setting'];
```

## 常用命令

```bash
# 重启服务
pm2 restart noe-chat

# 查看日志
pm2 logs noe-chat --lines 30

# 检查语法
node -c server.js

# 测试 API
curl http://localhost:4300/api/settings | jq '.'

# 查看数据库
sqlite3 chat.db ".tables"
sqlite3 chat.db "SELECT * FROM messages ORDER BY created_at DESC LIMIT 5"

# Ollama 状态
ollama list
curl http://localhost:11434/api/tags | jq '.models[].name'
```

## 数据库表

```sql
-- 消息
messages (id, role, content, created_at, auto, image, model, reasoning, tool_calls)

-- Enso 教训
enso_lessons (id, tool, lesson, created_at, last_used, use_count)
enso_errors (id, tool, error, args, user_message, created_at, processed)

-- Anticipation 惦记
anticipations (id, content, summary, target_date, target_time, fired, created_at, source_message)

-- Digest 回顾
daily_digests (id, date, message_count, summary, mood, highlights, created_at)
```

## 调试技巧

### 模块未初始化
```bash
pm2 logs noe-chat --lines 20 | grep "initialized\|failed"
```
应该看到 `[enso] initialized` 等。

### API 返回 503
模块未初始化。检查 `server.js` 里的 `setTimeout` 延迟和依赖。

### 前端不更新
浏览器缓存。Ctrl+Shift+R 强刷。

### Ollama 超时
模型首次加载需要时间（加载到内存）。之后会快。
```bash
# 预热
curl http://localhost:11434/api/generate -d '{"model":"gemma4:e4b","prompt":"hi","stream":false}'
```

## 今日新增功能 (2024-04-12)

### 对话聚合
- 发消息后等待 3 秒，可继续发多条
- 3 秒后合并发送
- Ctrl+Enter 立即发送
- 设置：`aggregate_enabled`, `aggregate_delay`

### 语音转写
- 🎤 按钮录音，⏹ 停止
- Groq Whisper API 转写
- 设置：`groq_key`
- API: `POST /api/transcribe` (multipart/form-data, field: audio)

### Ollama + Gemma 4
- 模型：`gemma4:e4b` (9.6GB), `gemma4:26b` (17GB)
- e4b 可用，26b CPU 太慢
- 用于简单任务（写记忆、留言）

### SmartRouter
- 自动判断任务复杂度
- 简单 → 本地 Ollama
- 复杂/需工具 → OpenRouter
