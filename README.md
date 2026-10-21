# EchoVisual & QuickTalk AI

A browser-based accessibility bridge for real-time classrooms that combines live captioning, multilingual translation, AI-generated study materials, and student voice support in one local-first web app.

Built with FastAPI, Google Gemini, Microsoft Edge Neural TTS, and a lightweight front end using HTML, Tailwind CSS, and vanilla JavaScript.

## What this project does

- Teacher-to-student classroom stream:
  - live speech capture
  - large-text captioning
  - multilingual lecture translation
  - Mermaid-based concept graph generation
  - study summaries, notes, quizzes, and flashcards

- Student-to-classroom communication:
  - shorthand and Roman Urdu refinement
  - tone-aware spoken output
  - AI voice playback with Edge TTS
  - fallback speech synthesis when AI paths fail

- Collaborative classroom experience:
  - room codes for shared class sessions
  - WebSocket streaming and WebRTC media support
  - shared classroom state updates

---

## Core features

### EchoVisual
- Continuous classroom speech capture from the browser microphone
- Large caption panel with interim/final transcript handling
- Live translation across multiple languages, including Urdu and Roman Urdu
- Dynamic knowledge graph rendering with Mermaid diagrams
- Snapshot timeline navigation and diagram history
- Export capabilities for Mermaid, SVG, PNG, and Markdown study packs

### QuickTalk AI
- Converts shorthand or fragmented student text into polished spoken language
- Supports tone presets such as polite, clarification, urgent doubt, Roman Urdu, and gratitude
- Streams generated speech through Microsoft Edge Neural TTS
- Falls back to native browser speech synthesis for reliability
- Provides a reusable soundboard and spoken-question history

### Study Hub
- Generates short, structured notes from lecture content
- Builds contextual multiple-choice quizzes with answer explanations
- Creates flashcards for concept recall and revision
- Exports study summaries and classroom outputs to Markdown or HTML

### AI tutor and room system
- Context-aware tutor interactions grounded in lecture transcript and graph state
- Shared room-based classroom participation with 6-character codes
- WebSocket relay for caption and state synchronization
- Browser WebRTC support for peer audio/video rooms

---

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Backend | Python 3.10+, FastAPI, Uvicorn, Pydantic v2, httpx, python-dotenv |
| AI generation | Google Gemini via `google-generativeai` |
| Speech synthesis | Microsoft Edge Neural TTS (`edge-tts`) |
| Speech-to-text | Groq Whisper (`whisper-large-v3-turbo`) |
| Real-time communication | WebSockets and WebRTC |
| Frontend | HTML5, vanilla JavaScript, Tailwind CSS via CDN |
| Visual rendering | Mermaid.js |
| Design | Outfit, IBM Plex Mono, Noto Nastaliq Urdu fonts |

---

## Prerequisites

- Python 3.10+
- Google Chrome or Microsoft Edge for browser speech APIs
- A microphone
- Optional camera for room video sessions
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- Optional Groq API key for Whisper-based speech-to-text

---
 
## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/EchoVisual-QuickTalk-AI.git
cd "EchoVisual-QuickTalk-AI"

# 2. Create and activate a virtual environment
python -m venv .venv
# Windows PowerShell
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create your local environment file
copy .env.example .env
# or: cp .env.example .env
# then edit .env and set GEMINI_API_KEY and any optional overrides

# 5. Run the app
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 in Chrome or Edge, grant microphone permission, and start the classroom flow.

---

## Configuration

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | Yes | — | API key for Gemini-generated responses |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-lite` | Overrides the default Gemini model |
| `EDGE_TTS_VOICE_EN` | No | `en-US-JennyNeural` | English voice used for spoken output |
| `EDGE_TTS_VOICE_UR` | No | `ur-PK-UzmaNeural` | Urdu voice used for spoken output |
| `GROQ_API_KEY` | No | — | Enables Whisper-based speech-to-text support |
| `GROQ_STT_MODEL` | No | `whisper-large-v3-turbo` | Groq speech-to-text model override |

---

## API endpoints

The backend exposes the following REST and WebSocket routes:

| Protocol | Method | Path | Description |
| :---: | :---: | :--- | :--- |
| WS | — | `/ws/live-session/{room_id}/{client_id}` | Live classroom stream with captions, graph updates, and realtime state sync |
| HTTP | GET | `/health` | Liveness check and API configuration status |
| HTTP | POST | `/api/rooms/create` | Creates a new classroom room |
| HTTP | GET | `/api/rooms/{room_id}/validate` | Validates whether a room exists |
| HTTP | POST | `/api/transcribe-to-diagram` | Converts a transcript chunk into a diagram, notes, and key terms |
| HTTP | POST | `/api/generate-notes` | Generates a short note summary |
| HTTP | POST | `/api/generate-quiz` | Generates MCQs with answers and explanations |
| HTTP | POST | `/api/generate-flashcards` | Generates concept flashcards |
| HTTP | POST | `/api/shorthand-to-speech` | Refines shorthand or Roman Urdu into a spoken sentence |
| HTTP | POST | `/api/chat` | Context-aware tutor response |
| HTTP | POST | `/api/translate` | Translates text into a target language |
| HTTP | POST | `/api/tts` | Generates speech audio from text using Edge TTS |
| HTTP | POST | `/api/speech-to-text` | Converts audio to text using Groq Whisper |

Interactive docs are available at `http://127.0.0.1:8000/docs` when the app is running.

---

## Project structure

```text
EchoVisual & QuickTalk AI/
├── .env.example          # Sample environment configuration
├── .gitignore            # Ignore local env and generated data
├── README.md             # Project overview and setup guide
├── main.py               # FastAPI backend, routes, validation, and model setup
├── prompts.py            # Gemini prompt templates for bilingual and classroom tasks
├── requirements.txt      # Python dependencies
├── test_smoke.py         # Offline smoke tests for key flows
├── test_runner.html      # Browser-side helper/test runner
├── agentfiles/
│   ├── AGENTS.md
│   ├── DESIGN_TASTE.md
│   └── PROJECT.md
├── static/
│   ├── app.js            # Frontend logic, speech, WebSocket, and UI behavior
│   ├── styles.css        # App styling and layout
│   ├── favicon.ico
│   ├── favicon.png
│   ├── favicon-transparent.png
│   └── my-logo.png
├── templates/
│   └── index.html        # Main UI page
└── .venv/                # Local virtual environment (not committed)
```

---

## Running tests

Use the included smoke suite to validate the key backend and AI integration paths without making live API calls:

```bash
python test_smoke.py
```

---

## Reliability and rate limiting

- Gemini requests are guarded by a backend sliding-window limiter to avoid quota exhaustion.
- The interface also throttles repeated generation requests to reduce unnecessary API load.
- Mermaid rendering errors are handled gracefully so the previous diagram remains visible.
- Sensitive stack traces are kept out of client responses.

---

## License

MIT — free to use, fork, and demo for educational or accessibility-focused projects.
