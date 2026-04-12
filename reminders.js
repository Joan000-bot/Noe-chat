// 定时提醒系统
const cron = require('node-cron');

class Reminders {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey;
    this.onReminder = options.onReminder || (() => {}); // callback when reminder fires
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        remind_at INTEGER NOT NULL,
        repeat TEXT,
        fired INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remind_at ON reminders(remind_at);
    `);
    
    // 每分钟检查提醒
    cron.schedule('* * * * *', () => this.checkReminders());
    
    console.log('[reminders] initialized');
  }

  // 添加提醒
  add(content, remindAt, repeat = null) {
    const stmt = this.db.prepare(`
      INSERT INTO reminders (content, remind_at, repeat, created_at)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(content, remindAt, repeat, Date.now());
    console.log(`[reminders] added: "${content}" at ${new Date(remindAt).toLocaleString()}`);
    return result.lastInsertRowid;
  }

  // 解析自然语言时间
  parseTime(text) {
    const now = new Date();
    
    // "5分钟后" / "5 minutes later"
    const minMatch = text.match(/(\d+)\s*(分钟|分|min|minutes?)\s*(后|later)?/i);
    if (minMatch) {
      return now.getTime() + parseInt(minMatch[1]) * 60 * 1000;
    }
    
    // "1小时后" / "1 hour later"
    const hourMatch = text.match(/(\d+)\s*(小时|时|hour|hours?)\s*(后|later)?/i);
    if (hourMatch) {
      return now.getTime() + parseInt(hourMatch[1]) * 60 * 60 * 1000;
    }
    
    // "明天早上8点" / "tomorrow 8am"
    const tomorrowMatch = text.match(/明天|tomorrow/i);
    if (tomorrowMatch) {
      const timeMatch = text.match(/(\d{1,2})\s*[点:时]?\s*(am|pm|早|晚|下午)?/i);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        if (timeMatch[2] && /pm|下午|晚/.test(timeMatch[2]) && hour < 12) hour += 12;
        tomorrow.setHours(hour, 0, 0, 0);
      } else {
        tomorrow.setHours(9, 0, 0, 0); // 默认早上9点
      }
      return tomorrow.getTime();
    }
    
    // "今天下午3点" / "today 3pm"
    const todayMatch = text.match(/今天|today/i);
    if (todayMatch) {
      const timeMatch = text.match(/(\d{1,2})\s*[点:时]?\s*(am|pm|早|晚|下午)?/i);
      const today = new Date(now);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        if (timeMatch[2] && /pm|下午|晚/.test(timeMatch[2]) && hour < 12) hour += 12;
        today.setHours(hour, 0, 0, 0);
      }
      return today.getTime();
    }
    
    // "周一" / "Monday"
    const dayNames = { '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6, '周日': 0,
                       'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0 };
    for (const [name, day] of Object.entries(dayNames)) {
      if (text.toLowerCase().includes(name)) {
        const target = new Date(now);
        const diff = (day - now.getDay() + 7) % 7 || 7;
        target.setDate(target.getDate() + diff);
        target.setHours(9, 0, 0, 0);
        return target.getTime();
      }
    }
    
    // 具体时间 "2024-12-25 14:30"
    const dateMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2})?:?(\d{1,2})?/);
    if (dateMatch) {
      const [, y, m, d, h, min] = dateMatch;
      return new Date(y, m - 1, d, h || 9, min || 0).getTime();
    }
    
    return null;
  }

  // 检查并触发提醒
  async checkReminders() {
    const now = Date.now();
    const due = this.db.prepare(`
      SELECT * FROM reminders 
      WHERE remind_at <= ? AND fired = 0
    `).all(now);
    
    for (const r of due) {
      console.log(`[reminders] firing: "${r.content}"`);
      
      // 标记为已触发
      this.db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(r.id);
      
      // 如果是重复提醒，创建下一个
      if (r.repeat) {
        const nextTime = this.calculateNextRepeat(r.remind_at, r.repeat);
        if (nextTime) {
          this.add(r.content, nextTime, r.repeat);
        }
      }
      
      // 触发回调
      this.onReminder(r);
    }
  }

  // 计算下次重复时间
  calculateNextRepeat(lastTime, repeat) {
    const d = new Date(lastTime);
    switch (repeat) {
      case 'daily': d.setDate(d.getDate() + 1); break;
      case 'weekly': d.setDate(d.getDate() + 7); break;
      case 'monthly': d.setMonth(d.getMonth() + 1); break;
      default: return null;
    }
    return d.getTime();
  }

  // 获取所有未触发的提醒
  getUpcoming(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM reminders 
      WHERE fired = 0 
      ORDER BY remind_at ASC
      LIMIT ?
    `).all(limit);
  }

  // 删除提醒
  delete(id) {
    this.db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
  }

  // 获取提醒数量
  getCount() {
    return this.db.prepare('SELECT COUNT(*) as count FROM reminders WHERE fired = 0').get()?.count || 0;
  }
}

module.exports = { Reminders };
