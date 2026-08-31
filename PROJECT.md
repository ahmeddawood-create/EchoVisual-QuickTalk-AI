# EchoVisual & QuickTalk AI — Technical Execution Context

## 1. Project Overview & Architecture
EchoVisual & QuickTalk AI is a lightweight, browser-based, dual-directional accessibility bridge for real-time classrooms. It must be built within a tight 3-day hackathon sprint. 

**Core Directives for the AI Coding Agent:**
*   **Zero Infrastructure Cost:** Rely entirely on the Gemini free tier (currently `gemini-3.5-flash-lite`, configurable via `GEMINI_MODEL` in `.env` because Google retires model names frequently).
*   **Hardware Constraints:** The local development environment runs on an Intel Core i5 (2nd Gen) with 8GB RAM and no dedicated GPU. **Do not** suggest or implement any local AI models or heavy processing libraries. All ML processing must be offloaded to the Gemini API.
*   **Frontend Simplicity:** Keep the frontend in a single `index.html` with Tailwind CSS via CDN and vanilla JavaScript. Once it exceeds 500 lines, extract CSS and JS into `static/` (see §4). Do not introduce React, Vue, or build steps (e.g., Webpack/Vite).

### 1.1 The Two Core Modules (as built)
*   **Module 1 (Teacher → Student):** Live audio captured via Web Speech API renders immediately into a large-text **Live Caption** side box, and is chunked to the backend every 8 seconds → Gemini generates Mermaid.js diagram code, summaries, and key terms → rendered dynamically in the browser.
*   **Module 2 (Student → Class):** Fragmented shorthand typed by the student (or a Quick Action preset) → sent to backend → Gemini refines it into articulate text → the browser speaks it aloud using `window.speechSynthesis`. If the AI is unreachable, the raw text is spoken so the student is always heard.

---

## 2. Technology Stack (as built)
*   **Backend:** Python 3, FastAPI, Google GenAI SDK (`google-generativeai`).
*   **Model:** `gemini-3.5-flash-lite`, read from the `GEMINI_MODEL` env var with a sane default. Never hardcode a model name: Gemini retires them and the API error message names the replacement.
*   **Frontend:** HTML5, Vanilla JS, Tailwind CSS (CDN), Outfit + IBM Plex Mono fonts, single electric-cobalt accent (DESIGN_TASTE.md rules).
*   **Visual Rendering:** Mermaid.js (CDN).
*   **Browser APIs:** Web Speech API (SpeechRecognition), Web Speech Synthesis API.
*   **Resilience:** Mermaid failures keep the previous diagram and show a notice; JSON responses are shape-validated before any DOM update; speech falls back to raw text; a global exception handler hides stack traces from clients.
*   **Rate limiting (double layer):** the frontend queue fires at most 1 request per 4.1 seconds (max 14/min), and the backend independently enforces a 15 requests/min sliding window with HTTP 429.

---

## 3. Implementation Status (as built)
All three sprint days are complete. Each section below describes how the work was actually delivered, including deviations from the original plan.

### Backend Foundation & AI Pipelines (Day 1) ✅
*   **FastAPI + CORS:** `main.py` with CORS locked to localhost origins only (8000 and 5500).
*   **Endpoint 1: `POST /api/transcribe-to-diagram`:** Transcript chunk in → strict JSON out (`diagram_code`, `summary_bullets`, `key_terms`). Prompt enforces max 8 diagram nodes and 600 output tokens for speed. Pydantic validates both the input (max 4000 chars) and the Gemini output shape. A regex fallback recovers JSON even when Gemini wraps it in prose.
*   **Endpoint 2: `POST /api/shorthand-to-speech`:** Shorthand in (max 1000 chars) → one refined sentence out.
*   **Additions beyond the original plan:**
    *   `GET /health` liveness endpoint reporting API key status and active model.
    *   Prompts extracted to `prompts.py` for routing cleanliness.
    *   Global exception handler so stack traces never reach the client.

### Interface & Browser API Integration (Day 2) ✅
*   **Layout (deviation from the 60/40 plan):** accessibility-first three-panel layout. A tall **Live Caption** side box (large text, auto-scroll, pulsing live dot) occupies the left third so the deaf student can comfortably read everything said in class. The right two-thirds stack the Teacher Visual Stream (diagram, summary, key terms) above the Student Expression Board (wide two-column input + Quick Actions + spoken log).
*   **Web Speech API:** "Start Class" captures continuously, auto-restarts when Chrome kills the session, buffers finals, and posts a chunk every 8 seconds.
*   **Mermaid rendering:** dynamic re-render with no page reload; `max_output_tokens` keeps responses fast.
*   **Speak button + presets:** refined text plays via `window.speechSynthesis`; four Quick Action presets; Ctrl+Enter shortcut; raw-text fallback when the AI is unreachable.

### Rate Limiting & Edge Case Polish (Day 3) ✅
*   **Double-layer rate limiting:** frontend request queue waits a minimum of 4.1 seconds between calls (max 14/min) and merges stale transcript chunks so only the freshest one consumes quota; the backend independently enforces 15 requests/min with HTTP 429.
*   **Quick Actions:** 4 preset buttons (original plan said 3).
*   **Mermaid fallback:** broken `diagram_code` is caught, logged, announced via a visible notice, and the previous diagram stays on screen.
*   **Extra polish:** error banner for API failures, "generating…" instant feedback, per-response timestamps, `prefers-reduced-motion` support, and a 36-test offline smoke suite (`test_smoke.py`) with mocked Gemini.

---

## 4. File Structure (as built)
Flat and legible. The frontend grew past the 500-line single-file threshold, so its CSS and JS live in `static/` and are mounted at `/static` by FastAPI:

```text
/EchoVisual & QuickTalk AI
│
├── main.py              # FastAPI app, Pydantic schemas, rate limiter, routing
├── prompts.py           # Gemini prompt templates (kept out of main.py)
├── requirements.txt     # fastapi, uvicorn, google-generativeai, dotenv, httpx
├── .env                 # GEMINI_API_KEY and optional GEMINI_MODEL (git-ignored)
├── .env.example         # Template for the env file
├── .gitignore           # Keeps .env and caches out of version control
├── test_smoke.py        # 36 offline tests with mocked Gemini (python test_smoke.py)
├── templates/
│   └── index.html       # Page markup + Tailwind config (under the 500-line cap)
└── static/
    ├── styles.css       # App styles: grid, animations, reduced-motion support
    └── app.js           # Speech capture, rate-limited API queue, renderers
```

**Run it:** `pip install -r requirements.txt`, add your key to `.env`, then `python -m uvicorn main:app --host 127.0.0.1 --port 8000` and open http://127.0.0.1:8000 in Chrome or Edge.