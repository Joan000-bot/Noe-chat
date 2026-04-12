// 共享播放列表

class Playlist {
  constructor(db) {
    this.db = db;
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS playlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        artist TEXT,
        url TEXT,
        platform TEXT,
        added_by TEXT DEFAULT 'virael',
        note TEXT,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS playlist_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER,
        played_at INTEGER NOT NULL
      );
    `);
    
    console.log('[playlist] initialized');
  }

  // 添加歌曲
  add(song) {
    const stmt = this.db.prepare(`
      INSERT INTO playlist (title, artist, url, platform, added_by, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    // 检测平台
    let platform = song.platform || 'unknown';
    if (song.url) {
      if (song.url.includes('spotify')) platform = 'spotify';
      else if (song.url.includes('music.apple')) platform = 'apple';
      else if (song.url.includes('youtube') || song.url.includes('youtu.be')) platform = 'youtube';
      else if (song.url.includes('163') || song.url.includes('netease')) platform = 'netease';
      else if (song.url.includes('qq')) platform = 'qqmusic';
    }
    
    const result = stmt.run(
      song.title,
      song.artist || null,
      song.url || null,
      platform,
      song.addedBy || 'virael',
      song.note || null,
      Date.now()
    );
    
    return result.lastInsertRowid;
  }

  // 获取所有歌曲
  getAll(limit = 100) {
    return this.db.prepare(`
      SELECT * FROM playlist ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  // 搜索歌曲
  search(query) {
    return this.db.prepare(`
      SELECT * FROM playlist 
      WHERE title LIKE ? OR artist LIKE ?
      ORDER BY created_at DESC
    `).all(`%${query}%`, `%${query}%`);
  }

  // 随机获取一首
  getRandom() {
    return this.db.prepare('SELECT * FROM playlist ORDER BY RANDOM() LIMIT 1').get();
  }

  // 按添加者筛选
  getByAdder(addedBy) {
    return this.db.prepare(`
      SELECT * FROM playlist WHERE added_by = ? ORDER BY created_at DESC
    `).all(addedBy);
  }

  // 删除歌曲
  delete(id) {
    this.db.prepare('DELETE FROM playlist WHERE id = ?').run(id);
  }

  // 记录播放
  recordPlay(songId) {
    this.db.prepare(`
      INSERT INTO playlist_history (song_id, played_at) VALUES (?, ?)
    `).run(songId, Date.now());
  }

  // 获取播放统计
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM playlist').get()?.count || 0;
    const byVirael = this.db.prepare("SELECT COUNT(*) as count FROM playlist WHERE added_by = 'virael'").get()?.count || 0;
    const byNoe = this.db.prepare("SELECT COUNT(*) as count FROM playlist WHERE added_by = 'noe'").get()?.count || 0;
    const byPlatform = this.db.prepare(`
      SELECT platform, COUNT(*) as count FROM playlist GROUP BY platform
    `).all();
    
    return { total, byVirael, byNoe, byPlatform };
  }

  // 更新歌曲
  update(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    
    if (!fields.length) return false;
    
    values.push(id);
    this.db.prepare(`UPDATE playlist SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }
}

module.exports = { Playlist };
