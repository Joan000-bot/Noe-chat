// 共享日历系统

class Calendar {
  constructor(db) {
    this.db = db;
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        all_day INTEGER DEFAULT 0,
        color TEXT DEFAULT '#667eea',
        repeat TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);
    `);
    
    console.log('[calendar] initialized');
  }

  // 添加事件
  add(event) {
    const stmt = this.db.prepare(`
      INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, repeat, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      event.title,
      event.description || null,
      event.startTime,
      event.endTime || null,
      event.allDay ? 1 : 0,
      event.color || '#667eea',
      event.repeat || null,
      Date.now()
    );
    return result.lastInsertRowid;
  }

  // 获取时间范围内的事件
  getRange(startTime, endTime) {
    return this.db.prepare(`
      SELECT * FROM calendar_events
      WHERE start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
    `).all(startTime, endTime);
  }

  // 获取某月的事件
  getMonth(year, month) {
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 0, 23, 59, 59).getTime();
    return this.getRange(start, end);
  }

  // 获取今天的事件
  getToday() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000 - 1;
    return this.getRange(start, end);
  }

  // 获取即将到来的事件
  getUpcoming(days = 7, limit = 20) {
    const now = Date.now();
    const end = now + days * 24 * 60 * 60 * 1000;
    return this.db.prepare(`
      SELECT * FROM calendar_events
      WHERE start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
      LIMIT ?
    `).all(now, end, limit);
  }

  // 更新事件
  update(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${dbKey} = ?`);
      values.push(value);
    }
    
    if (!fields.length) return false;
    
    values.push(id);
    this.db.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  // 删除事件
  delete(id) {
    this.db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  }

  // 获取特殊日期（纪念日等）
  getSpecialDates() {
    // 从设置读取 anniversaries
    try {
      const settings = this.db.prepare("SELECT value FROM settings WHERE key = 'anniversaries'").get();
      if (settings?.value) {
        return JSON.parse(settings.value);
      }
    } catch {}
    return [];
  }

  // 计算距离某个日期的天数
  daysUntil(month, day) {
    const now = new Date();
    let target = new Date(now.getFullYear(), month - 1, day);
    if (target < now) {
      target = new Date(now.getFullYear() + 1, month - 1, day);
    }
    return Math.ceil((target - now) / (24 * 60 * 60 * 1000));
  }
}

module.exports = { Calendar };
