"""Smoke tests for the EchoVisual & QuickTalk AI backend.

Run from the project root with:  python test_smoke.py
Uses FastAPI's TestClient with a mocked Gemini call so no API quota is spent.
"""

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import patch

# Ensure a key is present so routes don't 503 during tests.
os.environ.setdefault("GEMINI_API_KEY", "test-key-for-smoke-tests")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)

VALID_DIAGRAM_JSON = json.dumps({
    "diagram_code": "flowchart TD\nA[Photosynthesis] --> B[Sunlight]",
    "summary_bullets": ["Plants use sunlight", "CO2 becomes sugar"],
    "key_terms": ["Photosynthesis", "Chlorophyll"],
})

VALID_NOTES_JSON = json.dumps({
    "short_notes": ["Chloroplasts absorb photons", "Calvin cycle converts CO2"]
})

VALID_QUIZ_JSON = json.dumps({
    "quiz": [
        {
            "question": "What gas do plants absorb during photosynthesis?",
            "options": ["A. Oxygen", "B. Carbon Dioxide", "C. Nitrogen", "D. Helium"],
            "answer": "B. Carbon Dioxide",
            "explanation": "Plants take in carbon dioxide and release oxygen."
        }
    ]
})

VALID_FLASHCARDS_JSON = json.dumps({
    "flashcards": [
        {
            "front": "Chlorophyll",
            "back": "The green pigment in plants that absorbs light energy."
        }
    ]
})


async def fake_call_gemini(prompt, system, response_mime):
    if response_mime == "application/json":
        if "flashcard" in prompt.lower() or "flashcard" in system.lower():
            return VALID_FLASHCARDS_JSON
        if "quiz" in prompt.lower() or "quiz" in system.lower():
            return VALID_QUIZ_JSON
        if "notes" in prompt.lower() or "notes" in system.lower():
            return VALID_NOTES_JSON
        return VALID_DIAGRAM_JSON
    if "EchoVisual AI" in system:
        return "Photosynthesis is the process by which plants turn sunlight into energy."
    if "translator" in system.lower():
        return "پودے سورج کی روشنی استعمال کر کے خوراک بناتے ہیں۔"
    return "Could you please repeat the last point?"


async def fake_edge_tts_stream(text, voice="en-US-JennyNeural"):
    yield b"\xff\xfb\x90\x00\x00fake-mp3-frame"


def reset_rate_limiter():
    main._request_timestamps.clear()


class TestHealth(unittest.TestCase):
    def test_health_endpoint(self):
        res = client.get("/health")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["api_key_configured"])
        self.assertEqual(body["model"], main.MODEL_NAME)


class TestTranscribeToDiagram(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_transcript_returns_structured_output(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/transcribe-to-diagram",
                json={"transcript": "Today we study photosynthesis."},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("diagram_code", body)
        self.assertIsInstance(body["summary_bullets"], list)
        self.assertIsInstance(body["key_terms"], list)
        self.assertEqual(len(body["summary_bullets"]), 2)
        self.assertEqual(len(body["key_terms"]), 2)

    def test_gemini_json_wrapped_in_prose_is_recovered(self):
        async def messy_gemini(prompt, system, mime):
            return f"Here you go: {VALID_DIAGRAM_JSON} hope it helps"

        with patch.object(main, "_call_gemini", messy_gemini):
            res = client.post(
                "/api/transcribe-to-diagram",
                json={"transcript": "Water cycle explanation"},
            )
        self.assertEqual(res.status_code, 200)

    def test_empty_transcript_rejected(self):
        res = client.post("/api/transcribe-to-diagram", json={"transcript": ""})
        self.assertEqual(res.status_code, 422)

    def test_oversized_transcript_rejected(self):
        res = client.post(
            "/api/transcribe-to-diagram",
            json={"transcript": "x" * (main.MAX_TRANSCRIPT_CHARS + 1)},
        )
        self.assertEqual(res.status_code, 422)

    def test_malformed_gemini_response_returns_502(self):
        async def broken_gemini(prompt, system, mime):
            return "this is definitely not json"

        with patch.object(main, "_call_gemini", broken_gemini):
            res = client.post(
                "/api/transcribe-to-diagram",
                json={"transcript": "some transcript"},
            )
        self.assertEqual(res.status_code, 502)


class TestGenerateNotes(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_transcript_returns_notes(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/generate-notes",
                json={"transcript": "Today we study chloroplasts and the Calvin cycle."},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("short_notes", body)
        self.assertIsInstance(body["short_notes"], list)
        self.assertEqual(len(body["short_notes"]), 2)

    def test_empty_transcript_rejected(self):
        res = client.post("/api/generate-notes", json={"transcript": ""})
        self.assertEqual(res.status_code, 422)


class TestGenerateQuiz(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_transcript_returns_quiz(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/generate-quiz",
                json={"transcript": "Today we study photosynthesis in plants."},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("quiz", body)
        self.assertIsInstance(body["quiz"], list)
        self.assertEqual(len(body["quiz"]), 1)
        self.assertEqual(body["quiz"][0]["answer"], "B. Carbon Dioxide")

    def test_empty_transcript_rejected(self):
        res = client.post("/api/generate-quiz", json={"transcript": ""})
        self.assertEqual(res.status_code, 422)


class TestGenerateFlashcards(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_transcript_returns_flashcards(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/generate-flashcards",
                json={"transcript": "Chlorophyll is the green pigment in plants."},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("flashcards", body)
        self.assertIsInstance(body["flashcards"], list)
        self.assertEqual(len(body["flashcards"]), 1)
        self.assertEqual(body["flashcards"][0]["front"], "Chlorophyll")

    def test_empty_transcript_rejected(self):
        res = client.post("/api/generate-flashcards", json={"transcript": ""})
        self.assertEqual(res.status_code, 422)


class TestShorthandToSpeech(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_shorthand_returns_refined_text(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/shorthand-to-speech",
                json={"shorthand": "repeat last pt pls"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json()["refined_text"], "Could you please repeat the last point?"
        )

    def test_shorthand_with_custom_tone(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/shorthand-to-speech",
                json={"shorthand": "repeat last pt pls", "tone": "polite academic clarification"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json()["refined_text"], "Could you please repeat the last point?"
        )

    def test_empty_shorthand_rejected(self):
        res = client.post("/api/shorthand-to-speech", json={"shorthand": ""})
        self.assertEqual(res.status_code, 422)


class TestChatAssistant(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_chat_query_returns_reply(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/chat",
                json={
                    "message": "What is photosynthesis?",
                    "context": "Teacher discussed sunlight and plants.",
                    "history": [{"role": "user", "content": "Hello"}],
                },
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("Photosynthesis", res.json()["reply"])

    def test_empty_chat_message_rejected(self):
        res = client.post("/api/chat", json={"message": ""})
        self.assertEqual(res.status_code, 422)


class TestTranslation(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_translation_returns_text(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/translate",
                json={
                    "text": "Plants use sunlight to make food.",
                    "target_language": "Urdu",
                },
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("پودے", body["translated_text"])
        self.assertEqual(body["target_language"], "Urdu")

    def test_empty_translation_text_rejected(self):
        res = client.post("/api/translate", json={"text": "", "target_language": "Urdu"})
        self.assertEqual(res.status_code, 422)


class TestRateLimiter(unittest.TestCase):
    def test_request_over_limit_within_window_is_blocked(self):
        reset_rate_limiter()
        with patch.object(main, "_call_gemini", fake_call_gemini):
            for i in range(main.RATE_LIMIT_MAX_REQUESTS):
                res = client.post(
                    "/api/shorthand-to-speech", json={"shorthand": f"msg {i}"}
                )
                self.assertEqual(res.status_code, 200, f"request {i} should pass")
            blocked = client.post(
                "/api/shorthand-to-speech", json={"shorthand": "one too many"}
            )
        self.assertEqual(blocked.status_code, 429)


class TestFrontendServing(unittest.TestCase):
    def test_index_served_at_root(self):
        res = client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("EchoVisual", res.text)

    def test_static_assets_served(self):
        css = client.get("/static/styles.css")
        js = client.get("/static/app.js")
        self.assertEqual(css.status_code, 200)
        self.assertEqual(js.status_code, 200)
        self.assertIn("rise-in", css.text)
        self.assertIn("initLiveWebSocket", js.text)


class TestGraphState(unittest.TestCase):
    def setUp(self):
        self.graph = main.GraphState()

    def test_add_node_and_to_mermaid(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Photosynthesis"})
        self.assertIn("A", self.graph.nodes)
        self.assertEqual(self.graph.nodes["A"]["label"], "Photosynthesis")
        mermaid = self.graph.to_mermaid()
        self.assertIn('A["Photosynthesis"]', mermaid)

    def test_update_node(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Initial"})
        self.graph.apply_delta("UPDATE_NODE", {"id": "A", "label": "Updated Label"})
        self.assertEqual(self.graph.nodes["A"]["label"], "Updated Label")

    def test_connect_nodes(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Light"})
        self.graph.apply_delta("ADD_NODE", {"id": "B", "label": "Chlorophyll"})
        self.graph.apply_delta("CONNECT", {"from": "A", "to": "B", "relation": "absorbed by"})
        self.assertEqual(len(self.graph.edges), 1)
        mermaid = self.graph.to_mermaid()
        self.assertIn("A -->|absorbed by| B", mermaid)

    def test_remove_node(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "A"})
        self.graph.apply_delta("ADD_NODE", {"id": "B", "label": "B"})
        self.graph.apply_delta("CONNECT", {"from": "A", "to": "B", "relation": "rel"})
        self.graph.apply_delta("REMOVE", {"id": "A"})
        self.assertNotIn("A", self.graph.nodes)
        self.assertEqual(len(self.graph.edges), 0)

    def test_reset_graph(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "A"})
        self.graph.reset()
        self.assertEqual(len(self.graph.nodes), 0)
        self.assertIn("Waiting for lecture speech", self.graph.to_mermaid())


class TestWebSocketLiveSession(unittest.TestCase):
    def test_websocket_handshake(self):
        with client.websocket_connect("/ws/live-session") as ws:
            data = ws.receive_json()
            self.assertEqual(data["type"], "ready")
            self.assertIn("WebSocket streaming pipeline connected", data["message"])
            self.assertIn("mermaid_code", data)

    def test_websocket_ping_pong(self):
        with client.websocket_connect("/ws/live-session") as ws:
            ws.receive_json()  # Handshake
            ws.send_json({"type": "ping"})
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "pong")
            self.assertIn("timestamp", resp)

    def test_websocket_transcript_caption(self):
        with client.websocket_connect("/ws/live-session") as ws:
            ws.receive_json()  # Handshake
            ws.send_json({
                "type": "transcript_chunk",
                "text": "Photosynthesis produces oxygen",
                "is_final": True,
                "speaker_pause": True,
            })
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "caption")
            self.assertEqual(resp["text"], "Photosynthesis produces oxygen")
            self.assertTrue(resp["is_final"])

    def test_websocket_reset_session(self):
        with client.websocket_connect("/ws/live-session") as ws:
            ws.receive_json()  # Handshake
            ws.send_json({"type": "reset_session"})
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "session_reset")
            self.assertEqual(resp["status"], "ok")

    def test_websocket_shorthand_speak_event(self):
        with patch.object(main, "_call_gemini", fake_call_gemini), \
             patch.object(main, "generate_edge_tts_stream", fake_edge_tts_stream):
            with client.websocket_connect("/ws/live-session") as ws:
                ws.receive_json()  # Handshake
                ws.send_json({
                    "type": "shorthand_speak",
                    "shorthand": "repeat last point pls",
                    "tone": "polite",
                })
                resp = ws.receive_json()
                self.assertEqual(resp["type"], "tts_start")
                self.assertIn("refined_text", resp)
                self.assertIn("voice", resp)

                # May receive binary audio frames if edge_tts is active, followed by tts_end
                last_msg = None
                while True:
                    msg = ws.receive()
                    if "text" in msg:
                        parsed = json.loads(msg["text"])
                        if parsed.get("type") == "tts_end":
                            last_msg = parsed
                            break
                    elif "bytes" in msg:
                        continue
                self.assertIsNotNone(last_msg)
                self.assertEqual(last_msg["type"], "tts_end")


if __name__ == "__main__":
    unittest.main(verbosity=2)
