// 智能路由模块 - 决定用本地 Gemma 4 还是云端 OpenRouter
const fetch = require('node-fetch');

class SmartRouter {
  constructor(options = {}) {
    this.ollamaUrl = options.ollamaUrl || 'http://localhost:11434';
    this.ollamaModel = options.ollamaModel || 'gemma4:e4b';
    this.openrouterKey = options.openrouterKey || '';
    this.openrouterModel = options.openrouterModel || 'anthropic/claude-sonnet-4';
    
    // 简单任务关键词 - 这些走本地
    this.simpleTaskPatterns = [
      /写.*留言/,
      /写.*记忆/,
      /记录.*moment/i,
      /发.*whisper/,
      /简短/,
      /一句话/,
      /翻译/,
      /translate/i,
    ];
    
    // 复杂任务关键词 - 这些走云端
    this.complexTaskPatterns = [
      /搜索/,
      /search/i,
      /分析/,
      /analyze/i,
      /代码/,
      /code/i,
      /解释.*为什么/,
      /帮我.*做/,
      /规划/,
      /plan/i,
    ];
  }

  // 判断任务复杂度
  analyzeTask(message, options = {}) {
    // 有图片 → 必须云端
    if (options.hasImage) return 'cloud';
    
    // 需要工具 → 云端
    if (options.needsTools) return 'cloud';
    
    // 消息太短 → 本地
    if (message.length < 20) return 'local';
    
    // 检查简单任务模式
    for (const pattern of this.simpleTaskPatterns) {
      if (pattern.test(message)) return 'local';
    }
    
    // 检查复杂任务模式
    for (const pattern of this.complexTaskPatterns) {
      if (pattern.test(message)) return 'cloud';
    }
    
    // 消息较长 → 云端
    if (message.length > 200) return 'cloud';
    
    // 默认本地（省钱）
    return 'local';
  }

  // 调用本地 Ollama
  async callLocal(message, options = {}) {
    const systemPrompt = options.systemPrompt || '';
    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    if (options.history?.length) {
      options.history.forEach(m => messages.push({ role: m.role, content: m.content }));
    }
    
    messages.push({ role: 'user', content: message });

    const body = {
      model: this.ollamaModel,
      messages,
      stream: false,
      think: false,  // 关闭 thinking 模式
      options: {
        num_predict: options.maxTokens || 500,
        temperature: options.temperature || 0.7
      }
    };

    const r = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }

    const j = await r.json();
    return {
      reply: j.message?.content || '',
      model_used: `local/${this.ollamaModel}`,
      reasoning: j.message?.thinking || null,
      route: 'local'
    };
  }

  // 调用云端 OpenRouter
  async callCloud(message, options = {}) {
    if (!this.openrouterKey) {
      throw new Error('OpenRouter key not set');
    }

    const messages = [];
    
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    if (options.history?.length) {
      options.history.forEach(m => messages.push({ role: m.role, content: m.content }));
    }
    
    messages.push({ role: 'user', content: message });

    const body = {
      model: options.model || this.openrouterModel,
      messages,
      max_tokens: options.maxTokens || 2000
    };

    if (options.tools?.length) {
      body.tools = options.tools;
    }

    if (options.effort && options.effort !== 'off') {
      body.reasoning = { effort: options.effort, exclude: false };
    }

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vps2.viraelandnoeforever.com',
        'X-Title': 'Noé Chat'
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }

    const j = await r.json();
    const msg = j.choices?.[0]?.message || {};
    
    return {
      reply: msg.content || '',
      model_used: j.model || body.model,
      reasoning: msg.reasoning || msg.reasoning_content || null,
      tool_calls: msg.tool_calls || [],
      route: 'cloud'
    };
  }

  // 智能路由调用
  async call(message, options = {}) {
    const route = this.analyzeTask(message, options);
    
    console.log(`[router] "${message.slice(0, 30)}..." → ${route}`);
    
    if (route === 'local') {
      try {
        return await this.callLocal(message, options);
      } catch (e) {
        console.error('[router] local failed, falling back to cloud:', e.message);
        // 本地失败 → 回退到云端
        if (this.openrouterKey) {
          return await this.callCloud(message, options);
        }
        throw e;
      }
    } else {
      return await this.callCloud(message, options);
    }
  }

  // 检查 Ollama 是否可用
  async checkLocal() {
    try {
      const r = await fetch(`${this.ollamaUrl}/api/tags`, { timeout: 5000 });
      if (!r.ok) return false;
      const j = await r.json();
      return j.models?.some(m => m.name.includes('gemma4')) || false;
    } catch {
      return false;
    }
  }

  // 状态
  async status() {
    const localAvailable = await this.checkLocal();
    return {
      local: {
        available: localAvailable,
        url: this.ollamaUrl,
        model: this.ollamaModel
      },
      cloud: {
        available: !!this.openrouterKey,
        model: this.openrouterModel
      }
    };
  }
}

module.exports = { SmartRouter };
