// Enso 模块 - 从错误中学习的自我进化系统
// 灵感来自 https://github.com/amazinglvxw/enso-os

const Database = require('better-sqlite3');
const path = require('path');
const fetch = require('node-fetch');

class Enso {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey || '';
    this.model = options.model || 'anthropic/claude-sonnet-4';
    this.maxLessons = options.maxLessons || 50;
    this.staleThresholdDays = options.staleThresholdDays || 37;
    
    this.initTables();
    this.prepareStatements();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enso_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        error_message TEXT NOT NULL,
        args TEXT,
        context TEXT,
        created_at INTEGER NOT NULL,
        distilled INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_enso_errors_created ON enso_errors(created_at);
      CREATE INDEX IF NOT EXISTS idx_enso_errors_distilled ON enso_errors(distilled);

      CREATE TABLE IF NOT EXISTS enso_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_pattern TEXT NOT NULL,
        lesson TEXT NOT NULL,
        source_error_id INTEGER,
        hits INTEGER DEFAULT 0,
        last_hit INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_error_id) REFERENCES enso_errors(id)
      );
      CREATE INDEX IF NOT EXISTS idx_enso_lessons_trigger ON enso_lessons(trigger_pattern);
      CREATE INDEX IF NOT EXISTS idx_enso_lessons_hits ON enso_lessons(hits);
    `);
  }

  prepareStatements() {
    this.stmts = {
      insertError: this.db.prepare(`
        INSERT INTO enso_errors (tool_name, error_message, args, context, created_at, distilled)
        VALUES (?, ?, ?, ?, ?, 0)
      `),
      getUndistilled: this.db.prepare(`
        SELECT * FROM enso_errors WHERE distilled = 0 ORDER BY created_at ASC LIMIT 10
      `),
      markDistilled: this.db.prepare(`UPDATE enso_errors SET distilled = 1 WHERE id = ?`),
      
      insertLesson: this.db.prepare(`
        INSERT INTO enso_lessons (trigger_pattern, lesson, source_error_id, hits, last_hit, created_at)
        VALUES (?, ?, ?, 0, NULL, ?)
      `),
      getLessonsForTool: this.db.prepare(`
        SELECT * FROM enso_lessons WHERE trigger_pattern LIKE ? ORDER BY hits DESC LIMIT 5
      `),
      getAllLessons: this.db.prepare(`
        SELECT * FROM enso_lessons ORDER BY hits DESC, created_at DESC LIMIT ?
      `),
      incrementHit: this.db.prepare(`
        UPDATE enso_lessons SET hits = hits + 1, last_hit = ? WHERE id = ?
      `),
      
      // 主动遗忘
      deleteStale: this.db.prepare(`
        DELETE FROM enso_lessons WHERE last_hit IS NOT NULL AND last_hit < ?
      `),
      deleteLRU: this.db.prepare(`
        DELETE FROM enso_lessons WHERE id IN (
          SELECT id FROM enso_lessons ORDER BY hits ASC, created_at ASC LIMIT ?
        )
      `),
      countLessons: this.db.prepare(`SELECT COUNT(*) as c FROM enso_lessons`),
      
      // 健康检查
      getOrphans: this.db.prepare(`
        SELECT * FROM enso_lessons WHERE hits = 0 AND created_at < ?
      `),
      getDuplicates: this.db.prepare(`
        SELECT l1.id, l1.lesson, l2.id as dup_id, l2.lesson as dup_lesson
        FROM enso_lessons l1, enso_lessons l2
        WHERE l1.id < l2.id AND l1.trigger_pattern = l2.trigger_pattern
      `)
    };
  }

  // ===== 错误捕获 =====
  captureError(toolName, errorMessage, args = {}, context = '') {
    try {
      this.stmts.insertError.run(
        toolName,
        errorMessage,
        JSON.stringify(args),
        context,
        Date.now()
      );
      console.log(`[enso] 捕获错误: ${toolName} - ${errorMessage.slice(0, 100)}`);
    } catch (e) {
      console.error('[enso] 记录错误失败:', e.message);
    }
  }

  // ===== 教训提取 (Distillation) =====
  async distillLessons() {
    if (!this.openrouterKey) {
      console.log('[enso] 无OpenRouter key，跳过distill');
      return [];
    }
    
    const errors = this.stmts.getUndistilled.all();
    if (!errors.length) return [];
    
    const lessons = [];
    for (const err of errors) {
      try {
        const prompt = `[Error Log]
Tool: ${err.tool_name}
Error: ${err.error_message}
Args: ${err.args || '{}'}
Context: ${err.context || '(none)'}

[Task] Extract ONE actionable lesson from this error that would help avoid it in the future.
Format: "When [trigger condition], [what to do instead/check first]"
Be specific and concise (1-2 sentences max). Output ONLY the lesson, no explanation.
If this error is random/transient (network timeout, rate limit), output: SKIP`;

        const body = {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200
        };
        
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.openrouterKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        
        if (!r.ok) {
          console.error(`[enso] OpenRouter ${r.status}`);
          continue;
        }
        
        const j = await r.json();
        const reply = j.choices?.[0]?.message?.content?.trim() || '';
        
        if (reply && !reply.toUpperCase().startsWith('SKIP')) {
          // 提取trigger pattern（工具名 + 错误类型关键词）
          const trigger = `${err.tool_name}:${this.extractErrorType(err.error_message)}`;
          
          this.stmts.insertLesson.run(trigger, reply, err.id, Date.now());
          lessons.push({ trigger, lesson: reply });
          console.log(`[enso] 新教训: ${trigger} → ${reply.slice(0, 60)}...`);
        }
        
        this.stmts.markDistilled.run(err.id);
        
      } catch (e) {
        console.error('[enso] distill失败:', e.message);
      }
    }
    
    return lessons;
  }

  extractErrorType(errorMessage) {
    // 提取错误类型关键词
    const msg = errorMessage.toLowerCase();
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('not found') || msg.includes('404')) return 'not_found';
    if (msg.includes('unauthorized') || msg.includes('401')) return 'auth';
    if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
    if (msg.includes('invalid') || msg.includes('malformed')) return 'invalid_input';
    if (msg.includes('permission') || msg.includes('403')) return 'permission';
    if (msg.includes('connection')) return 'connection';
    return 'general';
  }

  // ===== 教训注入 =====
  getLessonsForPrompt(toolNames = []) {
    const lessons = [];
    const seen = new Set();
    
    // 根据即将使用的工具获取相关教训
    for (const tool of toolNames) {
      const related = this.stmts.getLessonsForTool.all(`${tool}%`);
      for (const l of related) {
        if (!seen.has(l.id)) {
          seen.add(l.id);
          lessons.push(l);
          this.stmts.incrementHit.run(Date.now(), l.id);
        }
      }
    }
    
    // 如果没有特定工具，获取最常用的教训
    if (!lessons.length) {
      const top = this.stmts.getAllLessons.all(5);
      for (const l of top) {
        if (!seen.has(l.id)) {
          seen.add(l.id);
          lessons.push(l);
        }
      }
    }
    
    if (!lessons.length) return '';
    
    const text = lessons.map(l => `• ${l.lesson}`).join('\n');
    return `\n[Learned Lessons]\n${text}\n`;
  }

  // ===== 主动遗忘 =====
  forget() {
    const now = Date.now();
    const staleThreshold = now - (this.staleThresholdDays * 24 * 60 * 60 * 1000);
    
    // 删除过期教训
    const staleResult = this.stmts.deleteStale.run(staleThreshold);
    if (staleResult.changes) {
      console.log(`[enso] 遗忘: ${staleResult.changes} 条过期教训 (>${this.staleThresholdDays}天未使用)`);
    }
    
    // LRU: 超过maxLessons时删除最少使用的
    const count = this.stmts.countLessons.get().c;
    if (count > this.maxLessons) {
      const excess = count - this.maxLessons;
      const lruResult = this.stmts.deleteLRU.run(excess);
      console.log(`[enso] LRU: 删除 ${lruResult.changes} 条最少使用的教训`);
    }
  }

  // ===== 健康检查 =====
  lint() {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    const orphans = this.stmts.getOrphans.all(weekAgo);
    const duplicates = this.stmts.getDuplicates.all();
    const count = this.stmts.countLessons.get().c;
    
    const report = {
      total_lessons: count,
      orphans: orphans.length,
      duplicates: duplicates.length,
      capacity: `${count}/${this.maxLessons}`,
      details: {
        orphan_ids: orphans.map(o => o.id),
        duplicate_pairs: duplicates.map(d => [d.id, d.dup_id])
      }
    };
    
    console.log(`[enso-lint] 教训: ${count}, 孤儿: ${orphans.length}, 重复: ${duplicates.length}`);
    return report;
  }

  // ===== 状态 =====
  status() {
    const count = this.stmts.countLessons.get().c;
    const errors = this.db.prepare('SELECT COUNT(*) as c FROM enso_errors WHERE distilled = 0').get().c;
    return {
      lessons: count,
      pending_errors: errors,
      capacity: `${count}/${this.maxLessons}`
    };
  }
}

module.exports = { Enso };
