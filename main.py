"""EchoVisual & QuickTalk AI — FastAPI backend.

Day 1 of the sprint: backend foundation & AI pipelines.
- POST /api/transcribe-to-diagram : transcript chunk -> Mermaid diagram + summary (JSON)
- POST /api/shorthand-to-speech   : fragmented shorthand -> refined spoken sentence
- GET  /health                    : liveness + API-key status check

Security/stability notes:
- API key is read from environment (.env), never hardcoded.
- CORS is locked to local origins only.
- Input lengths are capped by Pydantic.
- A backend rate limiter mirrors the Gemini free-tier cap (15 req/min)
  so a runaway frontend can never blow the quota.
"""

import asyncio
import json
import os
import re
import time
from collections import deque
from pathlib import Path

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import prompts

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
# NOTE: gemini-1.5-flash and gemini-2.0-flash have been retired from the API.
# Benchmarked on 2026-08-26: gemini-3.1-flash-lite 1.3s vs 3.5-flash-lite 1.6s;
# gemini-flash-lite-latest is unusable (45s, internal thinking).
# Override in .env with GEMINI_MODEL if Google rotates the model again.
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite").strip()
RATE_LIMIT_MAX_REQUESTS = 15      # Gemini free tier allows 15 req/min
RATE_LIMIT_WINDOW_SECONDS = 60
MAX_TRANSCRIPT_CHARS = 4000
MAX_SHORTHAND_CHARS = 1000
MAX_CHAT_MESSAGE_CHARS = 2000
MAX_CHAT_CONTEXT_CHARS = 4000

# Configure the SDK once at startup. Tests may run without a key; that is
# handled gracefully per request instead of crashing at import time.
if API_KEY:
    genai.configure(api_key=API_KEY)

app = FastAPI(
    title="EchoVisual & QuickTalk AI",
    description="Dual-directional accessibility bridge for real-time classrooms.",
    version="1.0.0",
)

# Lock CORS down to local development origins only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",   # VS Code Live Server
        "http://127.0.0.1:5500",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic models (input validation + Gemini structured output schema)
# ---------------------------------------------------------------------------


class TranscriptInput(BaseModel):
    transcript: str = Field(..., min_length=1, max_length=MAX_TRANSCRIPT_CHARS)


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)
    answer: str = ""
    explanation: str = ""


class Flashcard(BaseModel):
    front: str
    back: str


class NotesOutput(BaseModel):
    short_notes: list[str] = Field(default_factory=list)


class QuizOutput(BaseModel):
    quiz: list[QuizQuestion] = Field(default_factory=list)


class FlashcardsOutput(BaseModel):
    flashcards: list[Flashcard] = Field(default_factory=list)


class DiagramOutput(BaseModel):
    """Strict schema for what Gemini must return for the diagram pipeline."""

    diagram_code: str
    summary_bullets: list[str] = Field(default_factory=list)
    key_terms: list[str] = Field(default_factory=list)
    short_notes: list[str] = Field(default_factory=list)
    quiz: list[QuizQuestion] = Field(default_factory=list)
    flashcards: list[Flashcard] = Field(default_factory=list)


class ShorthandInput(BaseModel):
    shorthand: str = Field(..., min_length=1, max_length=MAX_SHORTHAND_CHARS)
    tone: str = Field(default="polite", max_length=50)


class SpeechOutput(BaseModel):
    refined_text: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatInput(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS)
    context: str = Field(default="", max_length=MAX_CHAT_CONTEXT_CHARS)
    history: list[ChatMessage] = Field(default_factory=list)


class ChatOutput(BaseModel):
    reply: str


class TranslateInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TRANSCRIPT_CHARS)
    target_language: str = Field(default="Urdu", min_length=1, max_length=50)


class TranslateOutput(BaseModel):
    translated_text: str
    target_language: str


class HealthResponse(BaseModel):
    status: str
    api_key_configured: bool
    model: str


# ---------------------------------------------------------------------------
# Backend rate limiter (sliding window, in-memory — fine for a hackathon demo)
# ---------------------------------------------------------------------------
_request_timestamps: deque[float] = deque()


def _check_rate_limit() -> None:
    """Raise 429 if more than RATE_LIMIT_MAX_REQUESTS hit in the last window."""
    now = time.monotonic()
    while _request_timestamps and now - _request_timestamps[0] > RATE_LIMIT_WINDOW_SECONDS:
        _request_timestamps.popleft()
    if len(_request_timestamps) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(
            status_code=429,
            detail="Rate limit reached (15 requests/minute, Gemini free tier). "
            "Please wait a few seconds and try again.",
        )
    _request_timestamps.append(now)


def _require_api_key() -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured. Add it to the .env file "
            "and restart the server.",
        )


# ---------------------------------------------------------------------------
# Gemini helpers
# ---------------------------------------------------------------------------
def _build_model(system: str, response_mime_type: str) -> genai.GenerativeModel:
    return genai.GenerativeModel(
        MODEL_NAME,
        system_instruction=system,
        generation_config={
            "temperature": 0.4,
            "response_mime_type": response_mime_type,
            # Hard cap on generation length: diagrams are small by design,
            # and a runaway response is the biggest latency risk.
            "max_output_tokens": 600,
        },
    )


_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(raw: str) -> dict:
    """Parse Gemini's text into a dict, tolerating stray prose/fences."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = _JSON_OBJECT_RE.search(raw)
        if match:
            return json.loads(match.group(0))
        raise


async def _call_gemini(prompt: str, system: str, response_mime: str) -> str:
    """Run the (synchronous) SDK call in a worker thread so the event loop
    stays free for other requests."""

    def _sync_call() -> str:
        model = _build_model(system, response_mime)
        response = model.generate_content(prompt)
        return response.text

    return await asyncio.to_thread(_sync_call)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        api_key_configured=bool(API_KEY),
        model=MODEL_NAME,
    )


@app.post("/api/transcribe-to-diagram", response_model=DiagramOutput)
async def transcribe_to_diagram(payload: TranscriptInput) -> DiagramOutput:
    _require_api_key()
    _check_rate_limit()

    prompt = prompts.DIAGRAM_PROMPT_TEMPLATE.format(transcript=payload.transcript)
    try:
        raw = await _call_gemini(
            prompt, prompts.DIAGRAM_SYSTEM_INSTRUCTIONS, "application/json"
        )
        data = _extract_json(raw)
        # Pydantic validates the schema before anything reaches the frontend.
        return DiagramOutput.model_validate(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - report upstream failures cleanly
        raise HTTPException(
            status_code=502,
            detail=f"Gemini diagram pipeline failed: {exc}",
        ) from exc


@app.post("/api/generate-notes", response_model=NotesOutput)
async def generate_notes(payload: TranscriptInput) -> NotesOutput:
    _require_api_key()
    _check_rate_limit()

    prompt = prompts.NOTES_PROMPT_TEMPLATE.format(transcript=payload.transcript)
    try:
        raw = await _call_gemini(
            prompt, prompts.NOTES_SYSTEM_INSTRUCTIONS, "application/json"
        )
        data = _extract_json(raw)
        return NotesOutput.model_validate(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini notes pipeline failed: {exc}",
        ) from exc


@app.post("/api/generate-quiz", response_model=QuizOutput)
async def generate_quiz(payload: TranscriptInput) -> QuizOutput:
    _require_api_key()
    _check_rate_limit()

    prompt = prompts.QUIZ_PROMPT_TEMPLATE.format(transcript=payload.transcript)
    try:
        raw = await _call_gemini(
            prompt, prompts.QUIZ_SYSTEM_INSTRUCTIONS, "application/json"
        )
        data = _extract_json(raw)
        return QuizOutput.model_validate(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini quiz pipeline failed: {exc}",
        ) from exc


@app.post("/api/generate-flashcards", response_model=FlashcardsOutput)
async def generate_flashcards(payload: TranscriptInput) -> FlashcardsOutput:
    _require_api_key()
    _check_rate_limit()

    prompt = prompts.FLASHCARDS_PROMPT_TEMPLATE.format(transcript=payload.transcript)
    try:
        raw = await _call_gemini(
            prompt, prompts.FLASHCARDS_SYSTEM_INSTRUCTIONS, "application/json"
        )
        data = _extract_json(raw)
        return FlashcardsOutput.model_validate(data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini flashcards pipeline failed: {exc}",
        ) from exc


@app.post("/api/shorthand-to-speech", response_model=SpeechOutput)
async def shorthand_to_speech(payload: ShorthandInput) -> SpeechOutput:
    _require_api_key()
    _check_rate_limit()

    tone_desc = payload.tone.strip() if payload.tone else "polite"
    prompt = prompts.SHORTHAND_PROMPT_TEMPLATE.format(
        tone=tone_desc, shorthand=payload.shorthand
    )
    try:
        text = await _call_gemini(
            prompt, prompts.SHORTHAND_SYSTEM_INSTRUCTIONS, "text/plain"
        )
        refined = text.strip().strip('"').strip("'").strip()
        if not refined:
            raise ValueError("Gemini returned an empty refinement.")
        return SpeechOutput(refined_text=refined)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini speech pipeline failed: {exc}",
        ) from exc


@app.post("/api/chat", response_model=ChatOutput)
async def chat_assistant(payload: ChatInput) -> ChatOutput:
    _require_api_key()
    _check_rate_limit()

    formatted_history = "\n".join(
        f"{msg.role.capitalize()}: {msg.content}" for msg in payload.history[-6:]
    ) or "None"
    context = payload.context.strip() or "No recent classroom transcript or diagram available."

    prompt = prompts.CHAT_PROMPT_TEMPLATE.format(
        context=context,
        history=formatted_history,
        message=payload.message,
    )
    try:
        reply = await _call_gemini(
            prompt, prompts.CHAT_SYSTEM_INSTRUCTIONS, "text/plain"
        )
        cleaned = reply.strip()
        if not cleaned:
            raise ValueError("Gemini returned an empty reply.")
        return ChatOutput(reply=cleaned)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini chat pipeline failed: {exc}",
        ) from exc


@app.post("/api/translate", response_model=TranslateOutput)
async def translate_text(payload: TranslateInput) -> TranslateOutput:
    _require_api_key()
    _check_rate_limit()

    prompt = prompts.TRANSLATE_PROMPT_TEMPLATE.format(
        target_language=payload.target_language,
        text=payload.text,
    )
    try:
        translated = await _call_gemini(
            prompt, prompts.TRANSLATE_SYSTEM_INSTRUCTIONS, "text/plain"
        )
        cleaned = translated.strip().strip('"').strip("'").strip()
        if not cleaned:
            raise ValueError("Gemini returned an empty translation.")
        return TranslateOutput(
            translated_text=cleaned,
            target_language=payload.target_language,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"Gemini translation pipeline failed: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# Frontend serving
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never leak stack traces to the client."""
    print(f"[ERROR] Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check server logs."},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
