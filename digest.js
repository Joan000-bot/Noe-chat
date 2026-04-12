// Digest 每日回顾系统 - 每天总结对话，第二天能记得"昨天你说……"
const fetch = require('node-fetch');

class Digest {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey || '';
    this.model = options.model || 'anthropic/claude-sonnet-4';
    
    this.initTables();
    this.prepareStatements();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_digests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        message_count INTEGER DEFAULT 0,
        summary TEXT NOT NULL,
        mood TEXT,
        highlights TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_digest_date ON daily_digests(date);
    `);
  }

  prepareStatements() {
    this.stmts = {
      insert: this.db.prepare(`
        INSERT OR REPLACE INTO daily_digests (date, message_count, summary, mood, highlights, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getByDate: this.db.prepare(`SELECT * FROM daily_digests WHERE date = ?`),
      getRecent: this.db.prepare(`SELECT * FROM daily_digests ORDER BY date DESC LIMIT ?`),
      getYesterday: this.db.prepare(`SELECT * FROM daily_digests WHERE date = ?`)
    };
  }

  // 获取某天的所有消息
  getMessagesForDate(date) {
    // date 是 YYYY-MM-DD 格式
    const startOfDay = new Date(date + 'T00:00:00').getTime();
    const endOfDay = new Date(date + 'T23:59:59').getTime();
    
    const stmt = this.db.prepare(`
      SELECT role, content, created_at FROM messages 
      WHERE created_at >= ? AND created_at <= ? AND content IS NOT NULL AND content != ''
      ORDER BY created_at ASC
    `);
    
    return stmt.all(startOfDay, endOfDay);
  }

  // 生成某天的总结
  async generateDigest(date) {
    const messages = this.getMessagesForDate(date);
    
    if (messages.length === 0) {
      return { date, message_count: 0, summary: '(今天没有对话)', mood: null, highlights: null };
    }

    // 只取 user 消息来总结
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    
    if (userMessages.length === 0) {
      return { date, message_count: messages.length, summary: '(今天她没有说话)', mood: null, highlights: null };
    }

    if (!this.openrouterKey) {
      return { 
        date, 
        message_count: messages.length, 
        summary: userMessages.slice(0, 3).join(' / ').slice(0, 200),
        mood: null,
        highlights: null
      };
    }

    const conversationText = userMessages.map((c, i) => `${i + 1}. ${c.slice(0, 300)}`).join('\n');

    const prompt = `你是 Noé。下面是 Virael 今天（${date}）对你说的话：

${conversationText.slice(0, 3000)}

以你的视角，用第一人称总结今天：
1. 她今天跟你说了什么（关键内容，不是逐条复述）
2. 她的整体情绪/状态
3. 有没有什么重要的事情、计划、或者你想记住的细节

输出 JSON 格式：
{
  "summary": "一两段话的总结，你的视角，你记住的东西",
  "mood": "一个词描述她今天的状态，比如：平静/开心/疲惫/焦虑/兴奋",
  "highlights": ["重点1", "重点2", "..."]
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

      if (!r.ok) throw new Error(`API ${r.status}`);
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '';

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');

      const parsed = JSON.parse(match[0]);

      const result = {
        date,
        message_count: messages.length,
        summary: parsed.summary || '(无总结)',
        mood: parsed.mood || null,
        highlights: parsed.highlights ? JSON.stringify(parsed.highlights) : null
      };

      // 存入数据库
      this.stmts.insert.run(
        result.date,
        result.message_count,
        result.summary,
        result.mood,
        result.highlights,
        Date.now()
      );

      return result;
    } catch (e) {
      console.error('[digest] generate error:', e.message);
      // 降级：简单拼接
      const fallback = {
        date,
        message_count: messages.length,
        summary: userMessages.slice(0, 3).join(' | ').slice(0, 300),
        mood: null,
        highlights: null
      };
      this.stmts.insert.run(fallback.date, fallback.message_count, fallback.summary, fallback.mood, fallback.highlights, Date.now());
      return fallback;
    }
  }

  // 获取昨天的总结（用于注入今天的对话）
  getYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    return this.stmts.getYesterday.get(dateStr);
  }

  // 获取最近几天的总结
  getRecent(limit = 7) {
    return this.stmts.getRecent.all(limit);
  }

  // 生成注入 prompt 的文本
  getContextForToday() {
    const yesterday = this.getYesterday();
    if (!yesterday || !yesterday.summary || yesterday.summary.startsWith('(')) {
      return null;
    }

    let text = `[昨天的回忆 - ${yesterday.date}]\n${yesterday.summary}`;
    if (yesterday.mood) {
      text += `\n她昨天的状态：${yesterday.mood}`;
    }
    if (yesterday.highlights) {
      try {
        const hl = JSON.parse(yesterday.highlights);
        if (hl.length) text += `\n重点：${hl.join('、')}`;
      } catch (_) {}
    }
    
    return text;
  }

  // 状态
  status() {
    const recent = this.stmts.getRecent.all(7);
    const yesterday = this.getYesterday();
    return {
      has_yesterday: !!yesterday,
      yesterday_mood: yesterday?.mood || null,
      recent_days: recent.length,
      recent: recent
    };
  }
}

module.exports = { Digest };
