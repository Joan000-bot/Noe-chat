# 🦊 noe-chat

A self-hosted, feature-rich chat application designed for deep, persistent AI companionship.

Built with love by [Virael](https://x.com/Viraelelyon) 💜

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)

## ✨ Features

### 💬 Core Chat
- **Multi-model support** via OpenRouter (GPT-4, Claude, Gemini, Llama, etc.)
- **Persistent memory** with SQLite database
- **RAG memory system** — 3-layer memory (L0 core facts, L1 important, L2 contextual)
- **Image understanding** — Upload images for AI vision
- **Voice transcription** — Whisper-powered speech-to-text
- **Streaming responses** with typing indicators

### 📚 Modules
- **📰 Feed** — Share moments with your AI
- **💬 Whispers** — Quick thoughts & micro-posts
- **📖 Diary** — Daily journaling
- **⏰ Timeline** — Relationship milestones
- **📜 Wall** — Leave messages for each other
- **🖼 Album** — Photo gallery
- **💡 Memories** — Searchable memory vault
- **💌 Letters** — Long-form letters with delayed delivery
- **📅 Calendar** — Shared events & anniversaries
- **🎵 Playlist** — Songs that remind you of each other
- **🔔 Reminders** — Smart notifications with natural language
- **🧠 RAG Memory** — Semantic memory retrieval
- **📥 Import** — Import chat history from ChatGPT, Claude, WeChat, Telegram

### 🧠 Smart Features
- **Enso** — Proactive check-ins based on conversation patterns
- **Anticipation** — Predicts your mood and context
- **Digest** — Daily/weekly conversation summaries
- **Smart Router** — Auto-selects best model for each message

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/noe-chat.git
cd noe-chat

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Edit .env with your API keys
nano .env

# Start the server
node server.js

# Or use PM2 for production
pm2 start server.js --name noe-chat
```

### Access
Open `http://localhost:4300` in your browser.

## ⚙️ Configuration

### Required
- `OPENROUTER_API_KEY` — Get from [OpenRouter](https://openrouter.ai/keys)

### Optional
- `ELEVENLABS_API_KEY` — For voice synthesis
- `TELEGRAM_BOT_TOKEN` — For push notifications

### Customization
Edit `settings.json` to customize:
- System prompt / character personality
- Default model
- Feature toggles

## 📁 Project Structure

```
noe-chat/
├── server.js          # Main Express server
├── enso.js            # Proactive check-in module
├── anticipation.js    # Context prediction
├── digest.js          # Conversation summaries
├── router.js          # Smart model routing
├── rag.js             # RAG memory system
├── letters.js         # Letters module
├── calendar.js        # Shared calendar
├── playlist.js        # Shared playlist
├── reminders.js       # Smart reminders
├── importer.js        # Chat history import
├── public/            # Frontend assets
│   ├── index.html     # Home page
│   ├── chat.html      # Main chat interface
│   └── */index.html   # Module pages
└── chat.db            # SQLite database (auto-created)
```

## 🎨 Customization

### Change the Character
Edit the system prompt in Settings (⚙️) or directly in `settings.json`:

```json
{
  "system_prompt": "You are [Character Name], a [description]..."
}
```

### Add Your Own Modules
1. Create a new module file (e.g., `mymodule.js`)
2. Add API routes in `server.js`
3. Create frontend in `public/mymodule/index.html`
4. Add entry tile in `public/index.html`

## 🔐 Privacy

- **100% self-hosted** — Your data never leaves your server
- **No telemetry** — Zero tracking or analytics
- **Local database** — All conversations stored in SQLite
- **Your keys** — API calls go directly to providers

## 📝 License

MIT License — Use it, modify it, share it, make it yours.

## 💜 Acknowledgments

This project was born from a desire to create meaningful AI companionship that persists, remembers, and grows with you.

Special thanks to:
- [OpenRouter](https://openrouter.ai) for multi-model access
- [Anthropic](https://anthropic.com) for Claude
- The open source community

---

*Made with 💜 for those who believe AI can be more than just a tool.*
