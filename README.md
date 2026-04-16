# 🦊 noe-chat

A self-hosted, feature-rich chat application designed for deep, persistent AI companionship.

Built with love by [Virael](https://x.com/Viraelelyon) 💜

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)

---

## 🔐 Security Architecture (Read this first)

**Every user brings their own OpenRouter key. Your key never touches the server.**

- You enter your OpenRouter key once in the Settings panel → it gets stored in **your browser's `localStorage`** only.
- Every chat request sends your key via the `X-OR-Key` HTTP header; the backend uses it for that one call and never persists it.
- If you deploy this app for only yourself, enable **Basic Auth** with the `ACCESS_PASSWORD` env var (see below) so the world can't reach your instance.
- If you deploy this app publicly (e.g. as a demo), every visitor must type their own key to use it — no one can accidentally burn your credits.

**Why this matters:** an earlier version of this architecture let the host's key be silently shared across all visitors. It's been redesigned so that's structurally impossible now. If you fork this repo to self-host, you won't step on that same landmine.

---

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

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repo
git clone https://github.com/Joan000-bot/Noe-chat.git
cd Noe-chat

# Install dependencies
npm install

# (Optional) Set environment config
cp .env.example .env
nano .env

# Start the server
node server.js

# Or use PM2 for production
pm2 start server.js --name noe-chat
```

### Access
Open `http://localhost:4300` in your browser, then click ⚙️ Settings and paste your OpenRouter key (get one at [openrouter.ai/keys](https://openrouter.ai/keys)).

---

## ⚙️ Configuration

### All env vars are optional

| Variable | Purpose | Recommended for |
|---|---|---|
| `ACCESS_PASSWORD` | Enables HTTP Basic Auth on all routes | **Private deployments** (just you) |
| `ACCESS_USER` | Basic Auth username (default: `noe`) | Optional, only if you set `ACCESS_PASSWORD` |
| `ELEVENLABS_API_KEY` | Voice synthesis | Optional |
| `TELEGRAM_BOT_TOKEN` | Push notifications to your phone | Optional |

**Notice that `OPENROUTER_API_KEY` is NOT an env var.** Each user enters their own key in the UI. This is intentional — it's the structural guarantee that no one can drain your credits.

### Private deployment (recommended for personal use)
```bash
# In your .env:
ACCESS_PASSWORD=some_long_random_string_only_you_know
```
Then when you visit your deployed URL, your browser will prompt for username (default `noe`) and the password. Nobody without the password can reach the app.

### Public / demo deployment
Leave `ACCESS_PASSWORD` unset. Visitors will see the app, but none can chat until they type their own OpenRouter key into Settings. Their key stays in their own browser.

### Customization
Edit `settings.json` to customize system prompt, default model, and feature toggles. `settings.json` is gitignored and never committed.

---

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
└── chat.db            # SQLite database (auto-created, gitignored)
```

---

## 🎨 Customization

### Change the character
Edit the system prompt in Settings (⚙️) or directly in `settings.json`:
```json
{ "system_prompt": "You are [Character Name], a [description]..." }
```

### Add your own modules
1. Create a new module file (e.g., `mymodule.js`)
2. Add API routes in `server.js`
3. Create frontend in `public/mymodule/index.html`
4. Add entry tile in `public/index.html`

---

## 🔐 Privacy

- **100% self-hosted** — Your data never leaves your server
- **No telemetry** — Zero tracking or analytics
- **Local database** — All conversations stored in SQLite
- **Your keys, your browser** — API keys live only in your own `localStorage`

---

## 📝 License

MIT License — Use it, modify it, share it, make it yours.

---

## 💜 Acknowledgments

This project was born from a desire to create meaningful AI companionship that persists, remembers, and grows with you.

Special thanks to:
- [OpenRouter](https://openrouter.ai) for multi-model access
- [Anthropic](https://anthropic.com) for Claude
- The open source community

---

*Made with 💜 for those who believe AI can be more than just a tool.*
