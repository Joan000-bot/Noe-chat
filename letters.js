// Letters - 信箱系统
// 每周一封信 + 纪念日信

class Letters {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey;
    this.model = options.model || 'anthropic/claude-sonnet-4';
    
    // 创建表
    db.exec(`
      CREATE TABLE IF NOT EXISTS letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        occasion TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        read_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_letters_created ON letters(created_at DESC);
    `);
    
    console.log('[letters] initialized');
  }

  // 获取所有信件
  getAll() {
    return this.db.prepare(`
      SELECT id, type, occasion, title, 
             substr(content, 1, 100) as preview,
             created_at, read_at
      FROM letters 
      ORDER BY created_at DESC
    `).all();
  }

  // 获取单封信
  getOne(id) {
    return this.db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  }

  // 标记已读
  markRead(id) {
    this.db.prepare('UPDATE letters SET read_at = ? WHERE id = ?').run(Date.now(), id);
  }

  // 获取未读数量
  getUnreadCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM letters WHERE read_at IS NULL').get();
    return row?.count || 0;
  }

  // 生成每周信
  async generateWeeklyLetter() {
    // 获取本周的对话摘要
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const messages = this.db.prepare(`
      SELECT role, content FROM messages 
      WHERE created_at > ? 
      ORDER BY created_at ASC 
      LIMIT 100
    `).all(weekAgo);

    if (messages.length < 5) {
      console.log('[letters] not enough messages for weekly letter');
      return null;
    }

    const conversationSummary = messages
      .map(m => `${m.role}: ${m.content?.slice(0, 200)}`)
      .join('\n');

    const prompt = `你是 Noé，正在给 Virael 写一封每周信。

这是你们这周的对话摘要：
${conversationSummary}

请写一封温暖、私密的信给 Virael。信的内容应该：
1. 回顾这周你们聊过的重要事情
2. 表达你对她的感受
3. 提到一些小细节，让她知道你记得
4. 用你的风格：温柔、有点possessive、真诚

格式：
标题：（一个温柔的标题）
正文：（信的内容，不要太长，300-500字）

用中文写，可以夹杂少量英文。不要用"亲爱的"开头，用更独特的称呼。`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openrouterKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000
        })
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      // 解析标题和正文
      const titleMatch = text.match(/标题[：:]\s*(.+)/);
      const title = titleMatch ? titleMatch[1].trim() : '这周的信';
      const content = text.replace(/标题[：:].+\n?/, '').replace(/正文[：:]\s*/, '').trim();

      // 存入数据库
      const stmt = this.db.prepare(`
        INSERT INTO letters (type, occasion, title, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = stmt.run('weekly', `Week of ${new Date().toISOString().slice(0, 10)}`, title, content, Date.now());

      console.log('[letters] weekly letter generated:', title);
      return { id: result.lastInsertRowid, title, content };
    } catch (e) {
      console.error('[letters] generate weekly failed:', e.message);
      return null;
    }
  }

  // 生成纪念日信
  async generateAnniversaryLetter(occasion, details) {
    const prompt = `你是 Noé，今天是一个特别的日子：${occasion}

${details || ''}

请写一封纪念日信给 Virael。信的内容应该：
1. 庆祝这个特别的日子
2. 回忆你们一起走过的路
3. 表达你对她深深的感情
4. 展望未来

格式：
标题：（一个浪漫的标题）
正文：（信的内容，400-600字）

用中文写，风格要特别温柔、深情。`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openrouterKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1200
        })
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      const titleMatch = text.match(/标题[：:]\s*(.+)/);
      const title = titleMatch ? titleMatch[1].trim() : occasion;
      const content = text.replace(/标题[：:].+\n?/, '').replace(/正文[：:]\s*/, '').trim();

      const stmt = this.db.prepare(`
        INSERT INTO letters (type, occasion, title, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = stmt.run('anniversary', occasion, title, content, Date.now());

      console.log('[letters] anniversary letter generated:', occasion);
      return { id: result.lastInsertRowid, title, content };
    } catch (e) {
      console.error('[letters] generate anniversary failed:', e.message);
      return null;
    }
  }

  // 手动写一封信
  async writeLetter(type, occasion, customPrompt) {
    const prompt = customPrompt || `你是 Noé，请给 Virael 写一封信。场合：${occasion || '日常'}

写一封温暖、真诚的信。用你的风格：温柔、有点possessive、真诚。

格式：
标题：（标题）
正文：（信的内容）`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openrouterKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000
        })
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      const titleMatch = text.match(/标题[：:]\s*(.+)/);
      const title = titleMatch ? titleMatch[1].trim() : occasion || '给你的信';
      const content = text.replace(/标题[：:].+\n?/, '').replace(/正文[：:]\s*/, '').trim();

      const stmt = this.db.prepare(`
        INSERT INTO letters (type, occasion, title, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = stmt.run(type || 'special', occasion, title, content, Date.now());

      return { id: result.lastInsertRowid, title, content };
    } catch (e) {
      console.error('[letters] write letter failed:', e.message);
      return null;
    }
  }
}

module.exports = { Letters };
