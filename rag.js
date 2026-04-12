// RAG 记忆系统 + 分层注入
// L0: 核心记忆（永久，手动标记）
// L1: 重要记忆（自动提取，高频访问）
// L2: 相关记忆（按需检索）

class RAG {
  constructor(db, options = {}) {
    this.db = db;
    this.openrouterKey = options.openrouterKey;
    this.model = options.model || 'anthropic/claude-sonnet-4';
    
    // 创建表
    db.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        chunk_index INTEGER DEFAULT 0,
        content TEXT NOT NULL,
        layer INTEGER DEFAULT 2,
        tokens TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rag_layer ON rag_documents(layer);
      CREATE INDEX IF NOT EXISTS idx_rag_source ON rag_documents(source);
      
      CREATE TABLE IF NOT EXISTS rag_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layer INTEGER NOT NULL,
        wing TEXT,
        summary TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    
    console.log('[rag] initialized');
  }

  // === 分词（中英文混合）===
  tokenize(text) {
    const lower = text.toLowerCase();
    const english = lower.match(/[a-z]{2,}/g) || [];
    const chinese = lower.match(/[\u4e00-\u9fff]/g) || [];
    const bigrams = [];
    for (let i = 0; i < chinese.length - 1; i++) {
      bigrams.push(chinese[i] + chinese[i + 1]);
    }
    return [...english, ...chinese, ...bigrams];
  }

  // === 分块 ===
  chunkText(text, source, chunkSize = 500) {
    const overlap = 100;
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const c = text.slice(i, i + chunkSize).trim();
      if (c.length > 20) {
        chunks.push({ text: c, source, index: chunks.length });
      }
    }
    return chunks;
  }

  // === 添加文档 ===
  addDocument(text, source, layer = 2) {
    const chunks = this.chunkText(text, source);
    const stmt = this.db.prepare(`
      INSERT INTO rag_documents (source, chunk_index, content, layer, tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const now = Date.now();
    for (const chunk of chunks) {
      const tokens = JSON.stringify(this.tokenize(chunk.text));
      stmt.run(source, chunk.index, chunk.text, layer, tokens, now);
    }
    
    console.log(`[rag] added ${chunks.length} chunks from "${source}" (L${layer})`);
    return chunks.length;
  }

  // === 设置层级 ===
  setLayer(id, layer) {
    this.db.prepare('UPDATE rag_documents SET layer = ? WHERE id = ?').run(layer, id);
  }

  // === 标记为核心记忆 ===
  markAsCore(id) {
    this.setLayer(id, 0);
  }

  // === TF-IDF 搜索 ===
  search(query, topK = 5, maxLayer = 2) {
    const queryTokens = this.tokenize(query);
    if (!queryTokens.length) return [];

    const docs = this.db.prepare(`
      SELECT id, source, content, layer, tokens, access_count 
      FROM rag_documents 
      WHERE layer <= ?
    `).all(maxLayer);

    if (!docs.length) return [];

    // 计算 DF
    const N = docs.length;
    const df = {};
    for (const doc of docs) {
      const seen = new Set(JSON.parse(doc.tokens || '[]'));
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }

    // 计算 TF-IDF 分数
    const scored = docs.map(doc => {
      const tokens = JSON.parse(doc.tokens || '[]');
      const tf = {};
      for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
      
      let score = 0;
      for (const qt of queryTokens) {
        if (tf[qt]) {
          score += (tf[qt] / tokens.length) * Math.log((N + 1) / (df[qt] || 1));
        }
      }
      
      // 层级加权：L0 x3, L1 x2, L2 x1
      const layerBoost = doc.layer === 0 ? 3 : doc.layer === 1 ? 2 : 1;
      
      return {
        id: doc.id,
        source: doc.source,
        content: doc.content,
        layer: doc.layer,
        score: score * layerBoost
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK).filter(s => s.score > 0);

    // 更新访问计数
    const now = Date.now();
    for (const r of results) {
      this.db.prepare(`
        UPDATE rag_documents 
        SET access_count = access_count + 1, last_accessed = ?
        WHERE id = ?
      `).run(now, r.id);
    }

    return results;
  }

  // === 获取分层上下文（用于注入 system prompt）===
  getLayeredContext(query = null) {
    const context = { L0: [], L1: [], L2: [] };

    // L0: 所有核心记忆
    const l0Docs = this.db.prepare(`
      SELECT content, source FROM rag_documents WHERE layer = 0
    `).all();
    context.L0 = l0Docs.map(d => d.content);

    // L1: 重要记忆（高频访问）
    const l1Docs = this.db.prepare(`
      SELECT content, source FROM rag_documents 
      WHERE layer = 1 OR access_count >= 5
      ORDER BY access_count DESC
      LIMIT 10
    `).all();
    context.L1 = l1Docs.map(d => d.content);

    // L2: 如果有查询，检索相关记忆
    if (query) {
      const results = this.search(query, 5, 2);
      context.L2 = results.map(r => r.content);
    }

    return context;
  }

  // === 生成注入文本 ===
  formatContextForPrompt(context) {
    const parts = [];

    if (context.L0.length) {
      parts.push(`<core_memories>\n${context.L0.join('\n\n')}\n</core_memories>`);
    }

    if (context.L1.length) {
      parts.push(`<important_memories>\n${context.L1.join('\n\n')}\n</important_memories>`);
    }

    if (context.L2.length) {
      parts.push(`<related_memories>\n${context.L2.join('\n\n')}\n</related_memories>`);
    }

    return parts.join('\n\n');
  }

  // === 自动提升高频记忆到 L1 ===
  promoteHighFrequency(threshold = 10) {
    const result = this.db.prepare(`
      UPDATE rag_documents 
      SET layer = 1 
      WHERE layer = 2 AND access_count >= ?
    `).run(threshold);
    
    if (result.changes > 0) {
      console.log(`[rag] promoted ${result.changes} docs to L1`);
    }
    return result.changes;
  }

  // === 从对话历史提取记忆 ===
  async extractFromConversation(messages) {
    if (!this.openrouterKey) return null;

    const conversation = messages
      .slice(-20)
      .map(m => `${m.role}: ${m.content?.slice(0, 500)}`)
      .join('\n');

    const prompt = `分析这段对话，提取值得记住的信息（事实、偏好、重要事件）。

对话：
${conversation}

请用简洁的要点列出需要记住的内容，每条一行，不要编号。只输出要点，不要解释。`;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openrouterKey}`
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-3-5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        })
      });

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      
      if (text.trim()) {
        this.addDocument(text, `conversation_${Date.now()}`, 2);
        return text;
      }
    } catch (e) {
      console.error('[rag] extract failed:', e.message);
    }
    return null;
  }

  // === 获取统计 ===
  getStats() {
    const stats = this.db.prepare(`
      SELECT layer, COUNT(*) as count 
      FROM rag_documents 
      GROUP BY layer
    `).all();
    
    const total = this.db.prepare('SELECT COUNT(*) as total FROM rag_documents').get();
    
    return {
      total: total?.total || 0,
      byLayer: stats.reduce((acc, s) => { acc[`L${s.layer}`] = s.count; return acc; }, {})
    };
  }

  // === 列出所有来源 ===
  listSources() {
    return this.db.prepare(`
      SELECT source, layer, COUNT(*) as chunks, SUM(access_count) as total_access
      FROM rag_documents
      GROUP BY source, layer
      ORDER BY layer, total_access DESC
    `).all();
  }

  // === 删除来源 ===
  deleteSource(source) {
    const result = this.db.prepare('DELETE FROM rag_documents WHERE source = ?').run(source);
    console.log(`[rag] deleted ${result.changes} chunks from "${source}"`);
    return result.changes;
  }
}

module.exports = { RAG };
