# EchoVisual & QuickTalk AI — Technical Execution Context

## 1. Project Overview & Architecture
EchoVisual & QuickTalk AI is a lightweight, browser-based, dual-directional accessibility bridge for real-time classrooms.

**Core Directives for the AI Coding Agent:**
*   **Zero Infrastructure Cost:** Rely entirely on the Gemini free tier (default `gemini-3.1-flash-lite`, configurable via `GEMINI_MODEL` in `.env` because Google retires model names frequently) and Microsoft Edge Neural TTS.
*   **Hardware Constraints:** The local development environment runs on an Intel Core i5 (2nd Gen) with 8GB RAM and no dedicated GPU. **Do not** suggest or implement any local AI models or heavy processing libraries. All ML processing is offloaded to the Gemini API and Edge-TTS.
*   **Frontend Simplicity:** Modern vanilla JavaScript and Tailwind CSS via CDN. No React, Vue, or build steps (e.g., Webpack/Vite). The frontend is cleanly organized into `templates/index.html`, `static/styles.css`, and `static/app.js`.

### 1.1 The Core Functional Modules (as built)
*   **Module 1 (EchoVisual — Teacher → Student):** Live audio captured via Web Speech API (English `en-US` and Urdu `ur-PK`) renders continuously into a large-text **Live Caption** side box with 11-language translation, and streams via WebSockets/REST → Gemini generates dynamic Mermaid.js knowledge graphs, incremental graph deltas (`GraphState`), summaries, and key terms with timeline history navigation.
*   **Module 2 (QuickTalk AI — Student → Class):** Fragmented shorthand or Roman Urdu typed by the student (with 5 persona tone presets) → Gemini refines it into articulate speech → streamed aloud using Microsoft Edge Neural TTS (`ur-PK-UzmaNeural` / `en-US-JennyNeural`) or native `window.speechSynthesis`. If the AI is unreachable, the raw text is spoken immediately so the student is always heard.
*   **Module 3 (Study Hub & Active Recall Arena):** Automatically compiles high-yield study notes, interactive comprehension MCQs with real-time scoring, and 3D flip flashcards from lecture transcripts.
*   **Module 4 (EchoBot AI Classroom Tutor):** Full-screen contextual conversational tutor grounded in live lecture transcripts, diagrams, notes, and terms (fluent in English, Roman Urdu, and Urdu script).
*   **Module 5 (Multiplayer Online Classrooms & WebRTC):** Collaborative virtual rooms with 6-character room codes and peer-to-peer WebRTC mesh video/audio streaming with a draggable video deck.
*   **Module 6 (Session Storage & Export Center):** Automatic LocalStorage session backups with 1-click restore and multi-format exports (Markdown Study Guide `.md` and standalone Interactive HTML Report `.html`).

---

## 2. Technology Stack (as built)
*   **Backend:** Python 3.10+, FastAPI, Uvicorn, Google GenAI SDK (`google-generativeai`), `edge-tts`, `websockets`, `pydantic` v2, `python-dotenv`, `httpx`.
*   **Model:** `gemini-3.1-flash-lite` (benchmarked at ~1.3s response time; configurable via `GEMINI_MODEL` env var).
*   **Frontend:** HTML5, Vanilla ES6+ JS, Tailwind CSS (CDN), Outfit + IBM Plex Mono + Noto Nastaliq Urdu fonts.
*   **Visual Rendering:** Mermaid.js (v10.9.1 CDN) with vector SVG and PNG raster export engines.
*   **Browser & Streaming APIs:** Web Speech API (SpeechRecognition), Web Speech Synthesis API, Web Audio API (`AudioContext` for streaming binary MP3 playback), WebRTC (`RTCPeerConnection`).
*   **Resilience:** Mermaid rendering failures keep the previous diagram intact; JSON responses are shape-validated with Pydantic; speech falls back to raw text; a global exception handler hides stack traces from clients.
*   **Rate Limiting (double layer):** The frontend queue fires at most 1 request per 4.1 seconds (max 14/min) with stale chunk merging, and the backend independently enforces a 15 requests/min sliding window with HTTP 429.

---

## 3. Implementation Status (as built)

### Backend Foundation & AI Pipelines ✅
*   **FastAPI + CORS:** `main.py` with CORS locked to localhost development origins.
*   **Endpoints:**
    *   `POST /api/transcribe-to-diagram`: Transcript chunk in → strict JSON out (`diagram_code`, `summary_bullets`, `key_terms`).
    *   `POST /api/generate-notes`: Transcript chunk in → structured study notes out (`short_notes`).
    *   `POST /api/generate-quiz`: Transcript chunk in → interactive MCQs with answers & rationales (`quiz`).
    *   `POST /api/generate-flashcards`: Transcript chunk in → front/back concept cards (`flashcards`).
    *   `POST /api/shorthand-to-speech`: Shorthand in with tone selection → one refined spoken sentence out.
    *   `POST /api/chat`: Context-aware conversational tutor supporting English and Roman Urdu.
    *   `POST /api/translate`: Multi-language translation into 11 target languages.
    *   `GET /health`: Liveness endpoint reporting API key status and active model.
    *   `POST /api/rooms/create` & `GET /api/rooms/{id}/validate`: Multi-room management.
*   **WebSocket Streaming Pipeline (`/ws/live-session/{room_id}/{client_id}`):**
    *   Full-duplex caption broadcasting (< 100ms).
    *   Incremental `GraphState` delta calculation (`ADD_NODE`, `UPDATE_NODE`, `CONNECT`, `REMOVE`) preventing diagram redraw jitter.
    *   Binary MP3 streaming from Microsoft Edge Neural TTS.
    *   WebRTC mesh signaling relay (`webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate`).

### Interface & Multi-Page View Integration ✅
*   **Accessibility-First Multi-View Layout:**
    *   `#classroom`: 12-column rigid grid with Live Captions & Translation sidebar on the left and Visual Concept Board on the right.
    *   `#rooms`: Online multiplayer classroom hub with join/host workflows and draggable WebRTC video deck.
    *   `#expression`: Student Voice Studio with live refinement preview, persona tone badges, soundboard presets, and spoken question history.
    *   `#study`: Three sub-panes for Notes & Summary, Interactive Quiz Arena with scoring, and 3D Flippable Flashcards Deck.
    *   `#tutor`: Full conversational AI assistant with contextual prompt chips.
    *   `#storage`: Session analytics dashboard, LocalStorage session archive, and `.md` / `.html` export center.
*   **Design & Theme Engine:** 5 curated color themes (Indigo Glow, Cobalt Tech, Aurora Emerald, Cyber Violet, Neon Cyan), Dark/Light mode toggle, and `prefers-reduced-motion` compliance.

### Rate Limiting & Offline Validation ✅
*   **Double-Layer Rate Limiting:** Frontend queue ensures minimum 4.1s between calls; backend sliding-window rejects excess calls with HTTP 429.
*   **Mermaid Fallback:** Syntax errors are caught gracefully, preserving the existing diagram without breaking the DOM.
*   **36-Test Smoke Suite (`test_smoke.py`):** Comprehensive offline test coverage with mocked Gemini & TTS, spending zero API quota.

---

## 4. File Structure (as built)

```text
/EchoVisual & QuickTalk AI
│
├── main.py              # FastAPI app, Pydantic schemas, WebSocket streaming, rate limiter, routing
├── prompts.py           # Gemini prompt templates with bilingual / Roman Urdu support
├── requirements.txt     # fastapi, uvicorn, google-generativeai, python-dotenv, httpx, edge-tts, websockets
├── .env                 # GEMINI_API_KEY and optional GEMINI_MODEL (git-ignored)
├── .env.example         # Template for the env file
├── .gitignore           # Keeps .env and caches out of version control
├── test_smoke.py        # 36 offline unit & integration tests with mocked Gemini & TTS
├── test_runner.html     # Browser-based test helper
├── templates/
│   └── index.html       # Multi-page markup, 12-column grid & Tailwind configuration
└── static/
    ├── styles.css       # App styles: 5 themes, 3D flashcards, animations, reduced-motion
    └── app.js           # Speech capture, WebSockets, Web Audio player, WebRTC, API queue, renderers
```

**Run it:** `pip install -r requirements.txt`, add your key to `.env`, then `python -m uvicorn main:app --host 127.0.0.1 --port 8000` and open http://127.0.0.1:8000 in Chrome or Edge.