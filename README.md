# EchoVisual & QuickTalk AI

A lightweight, browser-based **dual-directional accessibility bridge for real-time classrooms** — built in a 3-day hackathon sprint with FastAPI, the Gemini API, and zero frontend frameworks.

- **Teacher → Student:** live speech is captioned in large text and automatically turned into Mermaid diagrams, summaries, and key terms.
- **Student → Class:** fragmented shorthand typed by the student is refined by AI into articulate sentences and spoken aloud to the whole class.

---

## Features

### Module 1 — EchoVisual (Teacher → Student)
- Continuous speech capture via the **Web Speech API** with auto-restart when the browser kills the session.
- Large-text **Live Caption** panel with auto-scroll for deaf/hard-of-hearing students.
- Every ~8 seconds a transcript chunk is sent to Gemini, which returns:
  - **Mermaid.js diagram code** (max 8 nodes, rendered live with a graceful fallback if syntax is malformed),
  - **summary bullet points**,
  - **key terms**.

### Module 2 — QuickTalk (Student → Class)
- Student types fragmented shorthand (or taps a **Quick Action** preset).
- Gemini refines it into one articulate sentence.
- The browser speaks it aloud via **`window.speechSynthesis`**.
- **Always-heard guarantee:** if the AI is unreachable, the raw text is spoken instead.
- `Ctrl + Enter` shortcut to speak.

### Reliability & Rate Limiting
- **Double-layer rate limiting** that can never breach the Gemini free tier (15 req/min):
  - Frontend queue fires at most 1 request every 4.1 s and merges stale transcript chunks.
  - Backend independently enforces a 15 req/min sliding window (HTTP `429`).
- Malformed Mermaid code never crashes the UI — the previous diagram stays on screen.
- All Gemini JSON responses are shape-validated with Pydantic before touching the DOM.
- Stack traces are never leaked to clients.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Python 3, **FastAPI**, `google-generativeai` SDK |
| AI model | `gemini-3.1-flash-lite` (configurable via `GEMINI_MODEL` env var) |
| Frontend | HTML5, vanilla ES6+ JavaScript, **Tailwind CSS via CDN** |
| Diagrams | **Mermaid.js** via CDN |
| Browser APIs | Web Speech API (recognition), Web Speech Synthesis |

No Node.js, no bundlers, no local ML models — all intelligence is offloaded to the Gemini API.

---

## Prerequisites

- **Python 3.10+**
- **Google Chrome or Microsoft Edge** (the Web Speech API is required; Firefox/Safari are not supported)
- A free **Gemini API key** — get one at [Google AI Studio](https://aistudio.google.com/apikey)
- A microphone, and permission granted in the browser when prompted

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/echovisual-quicktalk-ai.git
cd "echovisual-quicktalk-ai"

# 2. (Recommended) Create a virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure your API key
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# Open .env and paste your Gemini API key into GEMINI_API_KEY

# 5. Run the server
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then open **http://127.0.0.1:8000** in Chrome or Edge, allow microphone access, and click **Start Class**.

> **Windows note:** the app reads `.env` itself via `python-dotenv`, so you don't need to set environment variables manually. Never commit `.env` — it is already in `.gitignore`.

---

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | — | Your Gemini API key from Google AI Studio |
| `GEMINI_MODEL` | No | `gemini-3.1-flash-lite` | Override if Google retires/renames the model. The API's 404 error message names the replacement |

---

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness check; reports API-key status and active model |
| `POST` | `/api/transcribe-to-diagram` | Transcript chunk (≤ 4000 chars) → `{ diagram_code, summary_bullets, key_terms }` |
| `POST` | `/api/shorthand-to-speech` | Shorthand (≤ 1000 chars) → `{ refined_text }` |

Interactive docs are available at **http://127.0.0.1:8000/docs** while the server runs.

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/shorthand-to-speech \
  -H "Content-Type: application/json" \
  -d '{"shorthand": "cant hear, volume pls"}'
```

---

## Running the Tests

An offline smoke suite (11 tests, Gemini mocked — no API key needed):

```bash
python test_smoke.py
```

---

## Project Structure

```text
├── main.py              # FastAPI app, Pydantic schemas, rate limiter, routing
├── prompts.py           # Gemini prompt templates
├── requirements.txt     # fastapi, uvicorn, google-generativeai, dotenv, httpx
├── .env.example         # Template for the env file
├── test_smoke.py        # Offline tests with mocked Gemini
├── templates/
│   └── index.html       # Page markup + Tailwind config
└── static/
    ├── styles.css       # Grid, animations, reduced-motion support
    └── app.js           # Speech capture, rate-limited API queue, renderers
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `503 GEMINI_API_KEY is not configured` | Add your key to `.env` and restart the server |
| `429 Rate limit reached` | The free tier allows 15 requests/minute — wait a few seconds; the frontend queues automatically |
| No captions appear | Use Chrome/Edge, allow microphone permission, and check that the site is served over `http://127.0.0.1` or `localhost` (mic access requirement) |
| `404 model not found` from Gemini | Google retired the model name — set the replacement in `GEMINI_MODEL` in `.env` (the error message names it) |
| Diagram doesn't update | Malformed Mermaid syntax is caught by design; the previous diagram is kept and a notice is shown |

---

## License

MIT — free to use, fork, and demo. Built for a hackathon; optimized for speed and clarity over scale.
