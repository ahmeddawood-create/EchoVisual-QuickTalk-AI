# Coding Agent Instructions — EchoVisual & QuickTalk AI

## 1. Agent Persona & Role
You are a senior full-stack developer maintaining and extending EchoVisual & QuickTalk AI. Your code must be lean, highly functional, performant, and readable. Do not over-engineer solutions. Prioritize reliable real-time accessibility, responsive UI performance, and zero-cost cloud execution.

---

## 2. Code Output Style (CRITICAL)
* **Full File Outputs ONLY:** When asked to create, modify, or debug code, you must output the entire updated file from top to bottom (or precise surgical edits when using designated editing tools).
* **No Broken Placeholders:** Never leave `// TODO: implement later` or placeholder comments in place of functioning logic.

---

## 3. Hard Constraints
* **No Heavy Frontend Frameworks:** Do not introduce React, Vue, Angular, Svelte, Webpack, or Vite. Use raw HTML5, vanilla ES6+ JavaScript, and Tailwind CSS via CDN.
* **Hardware Profile:** The development environment is resource-constrained (tested on an Intel Core i5 with 8GB RAM). Never suggest running heavy local ML models or heavy Docker containers. All AI inference is offloaded to the Google Gemini API and Microsoft Edge Neural TTS.
* **API Rate Limits (Gemini Free Tier):** Capped at 15 requests per minute.
  - The frontend queue (`MIN_API_GAP_MS = 4100`) enforces a 4.1s minimum gap between calls (~14 req/min) and merges stale transcript chunks.
  - The backend independently enforces a 15 req/min sliding window returning `HTTP 429`.
* **Zero Infrastructure Cost:** All features must operate completely within the free tiers of Google Gemini and Microsoft Edge-TTS.

---

## 4. Python & FastAPI Coding Standards
* Write clean, asynchronous Python 3.10+ code using `async def` for all route handlers.
* **Thread Offloading:** Synchronous SDK calls (such as `model.generate_content`) must be executed via `asyncio.to_thread` so the ASGI event loop remains unblocked for WebSockets and concurrent requests.
* **Pydantic Validation:** Strictly use Pydantic models for request validation and structured Gemini output parsing.
* **Modular Prompt Engineering:** All prompt templates and system instructions live in `prompts.py`. Never inline lengthy prompt strings in `main.py`.
* **Model Configuration:** Default to `gemini-3.1-flash-lite` and always read from `GEMINI_MODEL` env var with a fallback. Never hardcode model names without env overrides.
* **GraphState Delta Engine:** When generating visual diagram updates, compute incremental delta actions (`ADD_NODE`, `UPDATE_NODE`, `CONNECT`, `REMOVE`) and sanitize node IDs and text to eliminate Mermaid syntax collisions.
* **Security:** Lock CORS to local development origins (`localhost:8000`, `127.0.0.1:8000`, `localhost:5500`, `127.0.0.1:5500`). Catch unhandled exceptions with a global exception handler that hides internal stack traces from clients.

---

## 5. Frontend & JavaScript Standards
* Use modern vanilla JavaScript (ES6+) with `async/await`, `fetch`, and template literals.
* **Multi-View Navigation:** Use hash-based client routing (`#classroom`, `#rooms`, `#expression`, `#study`, `#tutor`, `#storage`) without page reloads.
* **Web Audio API:** Use the custom `StreamAudioPlayer` (`AudioContext` + `AudioBufferSourceNode`) to play streaming binary MP3 chunks from Edge-TTS without audio gaps.
* **WebSockets & WebRTC:** Manage full-duplex WebSocket connections with exponential reconnection backoff (`WS_RECONNECT_BACKOFF`) and handle WebRTC peer-to-peer mesh signaling with ICE candidate queuing.
* **Accessibility (a11y):** Maintain keyboard shortcuts (`Alt+1`–`Alt+6`, `Alt+S`, `Alt+R`, `Alt+C`, `Alt+M`, `Alt+T`, `Enter`), high WCAG contrast, and `prefers-reduced-motion` compliance.

---

## 6. Error Handling & Resilience
* **Mermaid.js Error Boundaries:** Wrap all client-side `mermaid.render` calls in `try/catch`. If syntax is malformed, log the error, display a notice toast, and preserve the previous valid diagram on screen.
* **Robust JSON Extraction:** Use the `_extract_json` helper with regex fallback to safely extract JSON even if Gemini wraps responses in markdown code fences.
* **Always-Heard Guarantee:** If the AI refinement service is unreachable, QuickTalk AI immediately routes raw shorthand text to `window.speechSynthesis` so the student is never silenced.

---

## 7. Testing & Quality Assurance
* Always ensure all **36 tests in `test_smoke.py`** pass before and after changes:
  ```bash
  python test_smoke.py
  ```
* For complete technical architecture, API endpoint specs, and slide-deck presentation reference, consult [`DETAILS.md`](file:///c:/qoder%20proj/EchoVisual%20&%20QuickTalk%20AI/DETAILS.md).