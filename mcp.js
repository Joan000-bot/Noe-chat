// 轻量 MCP client - 纯JSON-RPC over HTTP
const fetch = require('node-fetch');

class MCPClient {
  constructor(url, name) { this.url = url; this.name = name; this._id = 0; }
  async _call(method, params) {
    const r = await fetch(this.url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Accept':'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc:'2.0', id: ++this._id, method, params })
    });
    const txt = await r.text();
    // 可能是SSE格式，取data行
    let json;
    if (txt.startsWith('event:') || txt.includes('\ndata:')) {
      const line = txt.split('\n').find(l => l.startsWith('data:'));
      json = JSON.parse(line.slice(5).trim());
    } else {
      json = JSON.parse(txt);
    }
    if (json.error) throw new Error(`${this.name}: ${json.error.message}`);
    return json.result;
  }
  async listTools() {
    const r = await this._call('tools/list', {});
    return r.tools || [];
  }
  async callTool(name, args) {
    const r = await this._call('tools/call', { name, arguments: args });
    // MCP返回 content[]，提取text
    const txt = (r.content || []).map(c => c.type === 'text' ? c.text : JSON.stringify(c)).join('\n');
    return { text: txt, isError: !!r.isError };
  }
}

// 管理多个server
class MCPManager {
  constructor() { this.clients = new Map(); this.toolMap = new Map(); }
  setServers(servers) {
    this.clients.clear();
    (servers || []).filter(s => s.enabled && s.url).forEach(s => {
      const safeName = s.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      this.clients.set(safeName, new MCPClient(s.url, safeName));
    });
  }
  async getAllTools() {
    this.toolMap.clear();
    const out = [];
    for (const [srv, c] of this.clients) {
      try {
        const tools = await c.listTools();
        for (const t of tools) {
          const safe = `${srv}__${t.name}`.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '_');
          this.toolMap.set(safe, { server: srv, origName: t.name });
          out.push({
            type: 'function',
            function: {
              name: safe,
              description: `[${srv}] ${t.description || t.name}`,
              parameters: t.inputSchema || { type:'object', properties:{} }
            }
          });
        }
      } catch (e) { console.error(`[mcp ${srv}] list:`, e.message); }
    }
    return out;
  }
  async execute(safeName, args) {
    let m = this.toolMap.get(safeName);
    if (!m) { await this.getAllTools(); m = this.toolMap.get(safeName); }
    if (!m) throw new Error(`unknown tool: ${safeName}`);
    const c = this.clients.get(m.server);
    if (!c) throw new Error(`no client: ${m.server}`);
    return await c.callTool(m.origName, args);
  }
}

module.exports = { MCPManager };
