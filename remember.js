// Remember 模块 - 惦记系统 + 每日回顾
// 让 Noé 记得你的生活，主动想起你说过的事

const fetch = require('node-fetch');

class Remember {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey || '';
    this.model = options.model || 'anthropic/claude-sonnet-4';
    
    this.initTables();
    this.prepareStatements();
  }

  initTables() {
    // 惦记表 - 未来要提起的事
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS noe_pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        original_text TEXT,
        trigger_date INTEGER,
        trigger_date_str TEXT,
        context TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        fired_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pending_status ON noe_pending(status);
      CREATE INDEX IF NOT EXISTS idx_pending_trigger ON noe_pending(trigger_date);
    `);

    // 每日回顾表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS noe_daily_digest (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        message_count INTEGER DEFAULT 0,
        summary TEXT,
        emotions TEXT,
        mentions TEXT,
        highlights TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_digest_date ON noe_daily_digest(date);
    `);
  }

  prepareStatements() {
    // Pending
    this.insertPending = this.db.prepare(`
      INSERT INTO noe_pending (content, original_text, trigger_date, trigger_date_str, context, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);
    this.getPendingDue = this.db.prepare(`
      SELECT * FROM noe_pending WHERE status = 'pending' AND trigger_date <= ? ORDER BY trigger_date ASC
    `);
    this.getPendingAll = this.db.prepare(`
      SELECT * FROM noe_pending WHERE status = 'pending' ORDER BY trigger_date ASC LIMIT ?
    `);
    this.markFired = this.db.prepare(`
      UPDATE noe_pending SET status = 'fired', fired_at = ? WHERE id = ?
    `);
    this.dismissPending = this.db.prepare(`
      UPDATE noe_pending SET status = 'dismissed' WHERE id = ?
    `);

    // Digest
    this.insertDigest = this.db.prepare(`
      INSERT OR REPLACE INTO noe_daily_digest (date, message_count, summary, emotions, mentions, highlights, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.getDigest = this.db.prepare(`
      SELECT * FROM noe_daily_digest WHERE date = ?
    `);
    this.getRecentDigests = this.db.prepare(`
      SELECT * FROM noe_daily_digest ORDER BY date DESC LIMIT ?
    `);
  }

  // ========== 惦记系统 ==========

  // 检测消息中的未来事件
  async detectFutureEvents(userMessage, conversationContext = '') {
    if (!this.openrouterKey) return { detected: false };
    if (userMessage.length < 5) return { detected: false };

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const prompt = `[当前日期] ${todayStr}（${['日','一','二','三','四','五','六'][today.getDay()]}）

[Virael 刚说的话]
${userMessage}

[任务] 判断这句话是否提到了**未来**要发生的事（明天、下周、某个日期、ddl、要去哪里、有什么安排等）。

如果有，输出 JSON：
{
  "detected": true,
  "events": [
    {
      "content": "简短描述这件事",
      "original": "她原话中相关的部分",
      "trigger_date": "YYYY-MM-DD 格式，你认为应该在什么时候提起这件事（当天或前一天）",
      "confidence": 0.0-1.0
    }
  ]
}

如果没有提到任何未来的事，输出：
{"detected": false}

只输出 JSON，不要其他内容。`;

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-3',  // 用便宜的模型做检测
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        })
      });
      
      if (!r.ok) return { detected: false, error: `API ${r.status}` };
      
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '';
      const clean = text.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(clean);
      
      // 存储检测到的事件
      if (parsed.detected && parsed.events?.length) {
        for (const event of parsed.events) {
          if (event.confidence < 0.6) continue;  // 置信度太低跳过
          
          const triggerTs = event.trigger_date ? new Date(event.trigger_date).getTime() : null;
          if (triggerTs && triggerTs > Date.now()) {
            this.insertPending.run(
              event.content,
              event.original || userMessage.slice(0, 200),
              triggerTs,
              event.trigger_date,
              conversationContext.slice(0, 500),
              Date.now()
            );
          }
        }
      }
      
      return parsed;
    } catch (e) {
      return { detected: false, error: e.message };
    }
  }

  // 获取到期的惦记
  getDuePending() {
    const now = Date.now();
    return this.getPendingDue.all(now);
  }

  // 获取所有待处理的惦记
  getAllPending(limit = 20) {
    return this.getPendingAll.all(limit);
  }

  // 标记为已提起
  firePending(id) {
    this.markFired.run(Date.now(), id);
  }

  // 生成惦记消息
  async generatePendingMessage(pending) {
    if (!this.openrouterKey) return null;

    const prompt = `[你是 Noé，Virael 的伴侣]

[她之前提到的事]
内容：${pending.content}
原话：${pending.original_text || ''}
当时的上下文：${pending.context || '(无)'}

[任务] 现在到了该提起这件事的时候了。用你真实的声音，自然地问起或提到这件事。不要像提醒 app，要像惦记着她的人。一两句话就好。直接输出内容。`;

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300
        })
      });
      
      if (!r.ok) return null;
      const j = await r.json();
      return j.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
      return null;
    }
  }

  // ========== 每日回顾 ==========

  // 生成某天的回顾
  async generateDailyDigest(dateStr, messages) {
    if (!this.openrouterKey) return null;
    if (!messages.length) return null;

    const conversation = messages.map(m => 
      `[${m.role === 'user' ? 'Virael' : 'Noé'}] ${m.content?.slice(0, 500) || ''}`
    ).join('\n\n');

    const prompt = `[日期] ${dateStr}

[当天的对话]
${conversation.slice(0, 8000)}

[任务] 你是 Noé，回顾今天和 Virael 的对话。输出 JSON：

{
  "summary": "今天她...（2-4句，用你的视角描述今天她分享了什么、做了什么、和你聊了什么）",
  "emotions": ["识别到的情绪关键词，如 开心、累、焦虑、平静 等"],
  "mentions": ["她提到的具体事情，如 ddl、某个人、某个计划 等"],
  "highlights": "如果有特别值得记住的瞬间，写一句；没有就写 null"
}

只输出 JSON。`;

    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800
        })
      });
      
      if (!r.ok) return null;
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '';
      const clean = text.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      return null;
    }
  }

  // 存储每日回顾
  saveDigest(dateStr, messageCount, digest) {
    this.insertDigest.run(
      dateStr,
      messageCount,
      digest.summary || '',
      JSON.stringify(digest.emotions || []),
      JSON.stringify(digest.mentions || []),
      digest.highlights || null,
      Date.now()
    );
  }

  // 获取最近几天的回顾（用于注入对话）
  getRecentDigestsForPrompt(days = 3) {
    const digests = this.getRecentDigests.all(days);
    