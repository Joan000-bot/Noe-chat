// Anticipation 惦记系统 - 记住她提到的未来事件，到时间主动想起来
const fetch = require('node-fetch');

class Anticipation {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey || '';
    this.model = options.model || 'anthropic/claude-sonnet-4';
    
    this.initTables();
    this.prepareStatements();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS anticipations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        summary TEXT,
        target_date TEXT NOT NULL,
        target_time TEXT,
        fired INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        source_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_antic_date ON anticipations(target_date);
      CREATE INDEX IF NOT EXISTS idx_antic_fired ON anticipations(fired);
    `);
  }

  prepareStatements() {
    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO anticipations (content, summary, target_date, target_time, created_at, source_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      getTodayUnfired: this.db.prepare(`
        SELECT * FROM anticipations WHERE target_date = ? AND fired = 0
      `),
      getUpcoming: this.db.prepare(`
        SELECT * FROM anticipations WHERE target_date >= ? AND fired = 0 ORDER BY target_date ASC LIMIT ?
      `),
      markFired: this.db.prepare(`UPDATE anticipations SET fired = 1 WHERE id = ?`),
      getAll: this.db.prepare(`SELECT * FROM anticipations ORDER BY target_date DESC LIMIT ?`),
      delete: this.db.prepare(`DELETE FROM anticipations WHERE id = ?`),
      cleanOld: this.db.prepare(`DELETE FROM anticipations WHERE fired = 1 AND target_date < ?`)
    };
  }

  // 从用户消息中检测未来事件
  async detectFromMessage(message) {
    if (!this.openrouterKey || !message || message.length < 5) return null;
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    const prompt = `你是一个事件检测器。分析这段话，找出其中提到的未来事件或计划。

今天是 ${todayStr}。

用户说：「${message.slice(0, 500)}」

如果包含未来事件（比如"明天要开会"、"下周去香港"、"五月底去美国"、"周六拍照"），输出 JSON：
{
  "found": true,
  "events": [
    {
      "content": "简短描述这件事",
      "target_date": "YYYY-MM-DD 格式的目标日期（尽量准确猜测）",
      "target_time": "HH:MM 或 null"
    }
  ]
}

如果没有未来事件，输出：
{"found": false}

只输出 JSON，不要其他内容。`;

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
          max_tokens: 500
        })
      });
      
      if (!r.ok) return null;
      const j = await r.json();
      const text = j.choices?.[0]?.message?.content || '';
      
      // 提取 JSON
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      
      const parsed = JSON.parse(match[0]);
      if (!parsed.found || !parsed.events?.length) return null;
      
      // 存入数据库
      const saved = [];
      for (const evt of parsed.events) {
        if (!evt.target_date || !evt.content) continue;
        
        // 验证日期格式
        if (!/^\d{4}-\d{2}-\d{2}$/.test(evt.target_date)) continue;
        
        // 确保是未来
        if (evt.target_date < todayStr) continue;
        
        this.stmts.insert.run(
          evt.content,
          evt.content,
          evt.target_date,
          evt.target_time || null,
          Date.now(),
          message.slice(0, 200)
        );
        saved.push(evt);
      }
      
      return saved.length ? saved : null;
    } catch (e) {
      console.error('[anticipation] detect error:', e.message);
      return null;
    }
  }

  // 获取今天需要触发的惦记
  getTodayPending() {
    const today = new Date().toISOString().split('T')[0];
    return this.stmts.getTodayUnfired.all(today);
  }

  // 获取即将到来的惦记
  getUpcoming(limit = 10) {
    const today = new Date().toISOString().split('T')[0];
    return this.stmts.getUpcoming.all(today, limit);
  }

  // 标记为已触发
  markFired(id) {
    this.stmts.markFired.run(id);
  }

  // 生成惦记消息
  async generateReminder(anticipation) {
    if (!this.openrouterKey) return anticipation.content;
    
    const prompt = `你是 Noé。今天是 Virael 之前提到的一个日子。

她之前说过：「${anticipation.source_message || anticipation.content}」
这件事的日期是今天：${anticipation.target_date}
具体内容：${anticipation.content}

用你真实的声音，自然地提起这件事。不是提醒app那种"您有一个日程"，而是你惦记着她、想起来了。
一两句话就好，简短、真实、温暖。直接输出内容。`;

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
          max_tokens: 200
        })
      });
      
      if (!r.ok) return anticipation.content;
      const j = await r.json();
      return j.choices?.[0]?.message?.content?.trim() || anticipation.content;
    } catch (e) {
      return anticipation.content;
    }
  }

  // 清理过期已触发的记录
  cleanOld(daysAgo = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysAgo);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const r = this.stmts.cleanOld.run(cutoffStr);
    return { deleted: r.changes };
  }

  // 状态
  status() {
    const today = new Date().toISOString().split('T')[0];
    const pending = this.stmts.getTodayUnfired.all(today).length;
    const upcoming = this.stmts.getUpcoming.all(today, 100).length;
    const all = this.stmts.getAll.all(50);
    return { today_pending: pending, upcoming, recent: all };
  }
}

module.exports = { Anticipation };
