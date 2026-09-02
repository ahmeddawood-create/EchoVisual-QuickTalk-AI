# EchoVisual & QuickTalk AI

A lightweight, browser-based **dual-directional accessibility bridge for real-time classrooms** — built with FastAPI, Google Gemini, Microsoft Edge Neural TTS, and zero frontend frameworks.

* **Teacher → Student (EchoVisual):** Live classroom speech is transcribed into large-text captions, translated across 11 languages, and dynamically mapped into real-time Mermaid.js knowledge graphs, structured study notes, quizzes, and 3D flashcards.
* **Student → Class (QuickTalk AI):** Fragmented shorthand or Roman Urdu typed by non-verbal or anxious students is polished by Gemini into articulate sentences and streamed aloud using high-fidelity Neural TTS.

---

## Key Features

### 🎙️ Module 1 — EchoVisual (Teacher → Student Visual Stream)
* **Continuous Live Speech Capture:** Uses the browser's Web Speech API with an automatic reconnect watchdog; supports both English (`en-US`) and Urdu (`ur-PK`) mic input.
* **Live Caption Sidebar:** High-contrast, auto-scrolling captions with real-time interim/final token distinction, 1-click copy, download as `.txt`, and speech synthesis read-aloud.
* **11-Language Live Translation:** Translates live lecture speech into Urdu (`اردو` in Noto Nastaliq calligraphy), Roman Urdu, Sindhi (`سنڌي`), Pashto (`پښتو`), Punjabi (`پنجابی`), Arabic (`العربية`), French, Spanish, German, Chinese, and Hindi.
* **Dynamic Visual Concept Board:**
  - Converts lecture speech into live Mermaid.js flowcharts (`flowchart TD` / `graph LR`).
  - **Incremental Delta Graph Engine:** Server-side `GraphState` applies delta mutations (`ADD_NODE`, `UPDATE_NODE`, `CONNECT`, `REMOVE`) without layout jitter.
  - **Timeline History Slider:** Step backward through past diagram snapshots or toggle "Live Follow".
  - **Vector & Raster Exports:** 1-click SVG vector download, PNG raster download, and raw Mermaid syntax copy.
  - **Interactive Controls:** Zoom in/out, fit-to-canvas, whiteboard focus mode, and fullscreen modal.

### 🗣️ Module 2 — QuickTalk AI (Student → Class Expression Studio)
* **Intelligent Shorthand Expansion:** Converts shorthand, fragments, and Roman Urdu (e.g., *"sir q abt gravity?? fast smjhaen"*) into polished spoken sentences.
* **5 Persona Tone Badges:** *Polite Question*, *Clarification*, *Urgent Doubt*, *Roman Urdu*, and *Gratitude*.
* **Streaming Neural Voice:** Streams low-latency Microsoft Edge Neural TTS (`ur-PK-UzmaNeural` / `en-US-JennyNeural`) decoded in real-time via the Web Audio API.
* **Always-Heard Guarantee:** If AI services or networks fail, raw student text is immediately spoken via native `window.speechSynthesis`.
* **Interactive Soundboard & Presets:** 1-click common classroom phrases (Urdu Class, Questions, Feedback) + custom phrase creator saved to LocalStorage.
* **Spoken Questions History:** Chronological log with 1-click replay.

### 📚 Module 3 — Study Hub & Active Recall Arena
* **Structured Notes & Summary:** Automatically aggregates high-yield bullet notes and a comprehensive key terminology tag cloud.
* **Interactive Quiz Arena:** Generates 2 to 3 contextual MCQs with instant visual feedback, answer explanations, and real-time score tracking.
* **3D Concept Flashcards Deck:** Interactive 3D flippable flashcards (`perspective: 1000px`) for active recall revision.
* **1-Click Copy Study Pack:** Formats summary points, notes, quizzes, and flashcards into clean Markdown on your clipboard.

### 🤖 Module 4 — EchoBot AI Classroom Tutor
* **Context-Aware Conversational Tutor:** Grounded in the live classroom state (transcripts, Mermaid diagrams, notes, and key terms).
* **Bilingual Support:** Fluent in English, Roman Urdu, and Urdu script.
* **Prompt Quick-Chips:** 1-click queries (*"Explain diagram"*, *"Roman Urdu me samjhaen"*, *"Lecture Summary"*, *"Quick Quiz in Roman Urdu"*).

### 👥 Module 5 — Multiplayer Online Classrooms & WebRTC (`#rooms`)
* **Shared Virtual Classrooms:** Join or host classes using 6-character room codes (`BIO101`, `MATH01`, `CS2024` or unique codes).
* **Peer-to-Peer WebRTC Mesh:** Bidirectional video and audio streaming with a floating, draggable video deck.
* **Real-time State Synchronization:** Shared rolling captions and synchronized diagram updates across all connected students.

### 💾 Module 6 — Storage & Multi-Format Export Center (`#storage`)
* **Session Analytics:** Live counters for diagrams generated, captions captured (chars), and key terms recorded.
* **Multi-Format Export Engine:**
  - **Study Guide (`.md`):** Comprehensive Markdown with lecture history, Mermaid diagrams, notes, and quizzes.
  - **Interactive HTML Report (`.html`):** Standalone offline viewer with styled diagrams and notes.
* **Session Archive & 1-Click Restore:** Automatically backs up session state to LocalStorage with instant recovery.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Python 3.10+, **FastAPI**, Uvicorn, Pydantic v2, `httpx`, `python-dotenv` |
| **AI Model** | Google Gemini (`gemini-3.1-flash-lite` via `google-generativeai` SDK) |
| **Speech & Audio** | Microsoft Edge Neural TTS (`edge-tts`), Web Speech API, Web Audio API (`AudioContext`) |
| **Real-time & Video**| WebSockets (`/ws/live-session`), WebRTC (`RTCPeerConnection` mesh) |
| **Frontend** | HTML5, Vanilla ES6+ JavaScript, **Tailwind CSS via CDN** |
| **Visual Rendering**| **Mermaid.js (v10.9.1 CDN)** |
| **Design System** | Outfit, IBM Plex Mono, and Noto Nastaliq Urdu fonts; 5 curated themes + Dark/Light modes |

*No Node.js, no bundlers, zero local GPU required — 100% zero-infrastructure cost within free tiers.*

---

## Prerequisites

* **Python 3.10+**
* **Google Chrome or Microsoft Edge** (Web Speech API is required; served over `http://127.0.0.1` or `localhost`)
* A free **Gemini API key** — get one at [Google AI Studio](https://aistudio.google.com/apikey)
* A microphone (and camera for online room video)

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/echovisual-quicktalk-ai.git
cd "echovisual-quicktalk-ai"

# 2. Create and activate a virtual environment
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure your API key
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# Open .env and set GEMINI_API_KEY="your-api-key"

# 5. Run the server
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** in Chrome or Edge, grant microphone permission, and click **Start Class**.

---

## Configuration

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | **Yes** | — | Your Gemini API key from Google AI Studio. |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-lite` | Override Gemini model if Google rotates model names. |

---

## API & Streaming Endpoints

| Protocol | Method | Path | Description |
| :---: | :---: | :--- | :--- |
| `WS` | — | `/ws/live-session/{room_id}/{client_id}` | Full-duplex WebSocket: captions, delta graph sync, binary Edge-TTS, WebRTC signaling. |
| `HTTP` | `GET` | `/health` | Liveness check, API key status, active model. |
| `HTTP` | `POST` | `/api/rooms/create` | Generates a new 6-character classroom room code. |
| `HTTP` | `GET` | `/api/rooms/{room_id}/validate` | Validates if a classroom room code exists. |
| `HTTP` | `POST` | `/api/transcribe-to-diagram` | Transcript chunk → `{ diagram_code, summary_bullets, key_terms }`. |
| `HTTP` | `POST` | `/api/generate-notes` | Transcript chunk → `{ short_notes }` high-yield study notes. |
| `HTTP` | `POST` | `/api/generate-quiz` | Transcript chunk → `{ quiz }` interactive MCQs with rationales. |
| `HTTP` | `POST` | `/api/generate-flashcards` | Transcript chunk → `{ flashcards }` 3D concept revision cards. |
| `HTTP` | `POST` | `/api/shorthand-to-speech` | Shorthand + tone → `{ refined_text }` spoken sentence. |
| `HTTP` | `POST` | `/api/chat` | Bilingual conversational tutor query → `{ reply }`. |
| `HTTP` | `POST` | `/api/translate` | Multi-language translation → `{ translated_text, target_language }`. |

Interactive documentation is available at **http://127.0.0.1:8000/docs** while the server is running.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + 1` | Switch to **Classroom** view |
| `Alt + 2` | Switch to **Online Class** rooms view |
| `Alt + 3` | Switch to **Expression Board** view |
| `Alt + 4` | Switch to **Study Hub** view |
| `Alt + 5` | Switch to **AI Tutor** view |
| `Alt + 6` | Switch to **Storage & Downloads** view |
| `Alt + S` | **Start / Stop Class** speech capture |
| `Alt + R` | **Read Captions Aloud** |
| `Alt + C` | **Copy Live Captions** |
| `Alt + M` | Toggle **Dark / Light Mode** |
| `Alt + T` | Cycle **Color Themes** |
| `Enter` | Refine and speak shorthand (in Voice Composer) |
| `Shift + Enter` | Insert newline (in Voice Composer) |

---

## Running the Tests

Execute the comprehensive offline test suite (36 unit and integration tests with mocked Gemini and TTS):

```bash
python test_smoke.py
```

---

## Project Structure

```text
/EchoVisual & QuickTalk AI
│
├── DETAILS.md           # Complete technical specification & slide-deck presentation guide
├── main.py              # FastAPI app, Pydantic schemas, WebSocket streaming, rate limiter, routing
├── prompts.py           # Bilingual Gemini prompt templates (English, Roman Urdu, Urdu)
├── requirements.txt     # fastapi, uvicorn, google-generativeai, dotenv, httpx, edge-tts, websockets
├── .env                 # GEMINI_API_KEY and optional GEMINI_MODEL (git-ignored)
├── .env.example         # Template for the env file
├── .gitignore           # Keeps .env and temporary caches out of version control
├── test_smoke.py        # 36 offline unit & integration tests with mocked Gemini & TTS
├── test_runner.html     # Browser test assistant
├── templates/
│   └── index.html       # Multi-page markup, 12-col rigid grid & Tailwind configuration
└── static/
    ├── styles.css       # App styles: 5 themes, 3D flashcards, animations, reduced-motion
    └── app.js           # Speech capture, WebSockets, Web Audio player, WebRTC, API queue, renderers
```

---

## Reliability & Rate Limiting

* **Double-Layer Rate Limiter:** Protects the Gemini Free Tier (15 req/min).
  - Frontend queue enforces a minimum 4.1s interval between calls and merges stale transcript chunks.
  - Backend independently enforces a 15 req/min sliding window with `HTTP 429`.
* **Mermaid Resilience:** Malformed diagram syntax is caught cleanly; the previous diagram stays on screen and a notice toast appears.
* **Stack Trace Protection:** Global exception handler ensures stack traces are never exposed to clients.

---

## Presentation & Technical Deep Dive

For an exhaustive technical breakdown, architectural flowcharts, and a slide-by-slide blueprint for presentations, refer to [**`DETAILS.md`**](file:///c:/qoder%20proj/EchoVisual%20&%20QuickTalk%20AI/DETAILS.md).

---

## License

MIT — free to use, fork, and demo. Built with passion for inclusive, accessible education.
