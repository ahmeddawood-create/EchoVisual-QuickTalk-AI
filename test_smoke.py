"""Smoke tests for the EchoVisual & QuickTalk AI backend.

Run from the project root with:  python test_smoke.py
Uses FastAPI's TestClient with a mocked Gemini call so no API quota is spent.
"""

import json
import os
import unittest
from unittest.mock import patch

# Ensure a key is present so routes don't 503 during tests.
os.environ.setdefault("GEMINI_API_KEY", "test-key-for-smoke-tests")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)

VALID_DIAGRAM_JSON = json.dumps({
    "nodes": [
        {"id": "Photosynthesis", "label": "Photosynthesis", "shape": "box"},
        {"id": "Sunlight", "label": "Sunlight", "shape": "box"},
    ],
    "edges": [
        {"from": "Photosynthesis", "to": "Sunlight", "label": "requires", "arrows": "to"},
    ],
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

VALID_MINDMAP_JSON = json.dumps({
    "title": "Photosynthesis Fundamentals",
    "summary": "Covers light-dependent reactions, Calvin cycle, and chloroplast structure.",
    "root": {
        "id": "root",
        "label": "Photosynthesis",
        "notes": "Process converting light into biochemical energy.",
        "children": [
            {
                "id": "light_reactions",
                "label": "Light Reactions",
                "notes": "Occurs in thylakoids, produces ATP and NADPH.",
                "children": []
            }
        ]
    },
    "nodes": [
        {"id": "root", "label": "Photosynthesis", "level": 0, "category": "Core", "notes": "Process converting light into biochemical energy."},
        {"id": "light_reactions", "label": "Light Reactions", "level": 1, "category": "Reactions", "notes": "Occurs in thylakoids, produces ATP and NADPH."}
    ],
    "edges": [
        {"from": "root", "to": "light_reactions", "label": "consists of"}
    ]
})

async def fake_call_gemini(prompt, system, response_mime, max_output_tokens=600):
    if response_mime == "application/json":
        if "mindmap" in prompt.lower() or "mindmap" in system.lower():
            return VALID_MINDMAP_JSON
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
    if "photosynthesis" in prompt.lower():
        return "Could you please re-explain the light-dependent reactions in photosynthesis?"
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
        self.assertIn("nodes", body)
        self.assertIn("edges", body)
        self.assertIn("diagram_code", body)
        self.assertIsInstance(body["diagram_code"], str)
        self.assertIsInstance(body["summary_bullets"], list)
        self.assertIsInstance(body["key_terms"], list)
        self.assertEqual(len(body["summary_bullets"]), 2)
        self.assertEqual(len(body["key_terms"]), 2)

    def test_gemini_json_wrapped_in_prose_is_recovered(self):
        async def messy_gemini(prompt, system, mime, max_output_tokens=600):
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

    def test_legacy_mermaid_response_is_converted_to_nodes_and_edges(self):
        async def mermaid_gemini(prompt, system, mime, max_output_tokens=600):
            return json.dumps({
                "diagram_code": 'flowchart TD\n    A["Photosynthesis"] -->|requires| B["Sunlight"]',
                "summary_bullets": ["Plants use sunlight"],
                "key_terms": ["Photosynthesis"],
            })

        with patch.object(main, "_call_gemini", mermaid_gemini):
            res = client.post(
                "/api/transcribe-to-diagram",
                json={"transcript": "Photosynthesis requires sunlight"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("nodes", body)
        self.assertIn("edges", body)
        self.assertIn("diagram_code", body)
        self.assertTrue(len(body["nodes"]) >= 2)
        self.assertEqual(len(body["edges"]), 1)
        self.assertEqual(body["edges"][0]["from"], "A")
        self.assertEqual(body["edges"][0]["to"], "B")

    def test_malformed_gemini_response_returns_502(self):
        async def broken_gemini(prompt, system, mime, max_output_tokens=600):
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


class TestGenerateMindmap(unittest.TestCase):
    def setUp(self):
        reset_rate_limiter()

    def test_valid_transcript_and_context_returns_mindmap(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/generate-mindmap",
                json={
                    "transcript": "Photosynthesis consists of light reactions in the thylakoid.",
                    "context": "Current Concepts: Chloroplast, ATP, NADPH",
                },
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("title", body)
        self.assertIn("nodes", body)
        self.assertIn("edges", body)
        self.assertIn("root", body)
        self.assertEqual(body["title"], "Photosynthesis Fundamentals")
        self.assertEqual(len(body["nodes"]), 2)
        self.assertEqual(len(body["edges"]), 1)
        self.assertEqual(body["nodes"][0]["id"], "root")

    def test_empty_transcript_rejected(self):
        res = client.post("/api/generate-mindmap", json={"transcript": ""})
        self.assertEqual(res.status_code, 422)

    def test_oversized_transcript_rejected(self):
        res = client.post(
            "/api/generate-mindmap",
            json={"transcript": "x" * (main.MAX_TRANSCRIPT_CHARS + 1)},
        )
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

    def test_shorthand_with_lecture_context(self):
        with patch.object(main, "_call_gemini", fake_call_gemini):
            res = client.post(
                "/api/shorthand-to-speech",
                json={
                    "shorthand": "repeat light reaction pls",
                    "tone": "polite academic clarification",
                    "context": "Active Topic: Photosynthesis and Chloroplast structure",
                },
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json()["refined_text"],
            "Could you please re-explain the light-dependent reactions in photosynthesis?",
        )


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
        logo = client.get("/static/my-logo.png")
        favicon_png = client.get("/static/favicon.png")
        favicon_ico = client.get("/favicon.ico")
        self.assertEqual(css.status_code, 200)
        self.assertEqual(js.status_code, 200)
        self.assertEqual(logo.status_code, 200)
        self.assertEqual(favicon_png.status_code, 200)
        self.assertEqual(favicon_ico.status_code, 200)
        self.assertIn("rise-in", css.text)
        self.assertIn("initLiveWebSocket", js.text)
        self.assertEqual(logo.headers.get("content-type"), "image/png")


class TestGraphState(unittest.TestCase):
    def setUp(self):
        self.graph = main.GraphState()

    def test_add_node_and_to_visjs(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Photosynthesis"})
        self.assertIn("A", self.graph.nodes)
        self.assertEqual(self.graph.nodes["A"]["label"], "Photosynthesis")
        graph_dict = self.graph.to_dict()
        self.assertTrue(any(n["id"] == "A" and n["label"] == "Photosynthesis" for n in graph_dict["nodes"]))

    def test_update_node(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Initial"})
        self.graph.apply_delta("UPDATE_NODE", {"id": "A", "label": "Updated Label"})
        self.assertEqual(self.graph.nodes["A"]["label"], "Updated Label")

    def test_connect_nodes(self):
        self.graph.apply_delta("ADD_NODE", {"id": "A", "label": "Light"})
        self.graph.apply_delta("ADD_NODE", {"id": "B", "label": "Chlorophyll"})
        self.graph.apply_delta("CONNECT", {"from": "A", "to": "B", "relation": "absorbed by"})
        self.assertEqual(len(self.graph.edges), 1)
        graph_dict = self.graph.to_dict()
        self.assertTrue(any(e["from"] == "A" and e["to"] == "B" and e.get("label") == "absorbed by" for e in graph_dict["edges"]))

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
        self.assertEqual(len(self.graph.to_dict()["nodes"]), 0)


class TestWebSocketLiveSession(unittest.TestCase):
    def setUp(self):
        resp = client.post("/api/rooms/create")
        self.room_id = resp.json()["room_id"]
        self.ws_url = f"/ws/live-session/{self.room_id}/testclient"

    def test_websocket_handshake(self):
        with client.websocket_connect(self.ws_url) as ws:
            data = ws.receive_json()
            self.assertEqual(data["type"], "ready")
            self.assertIn("WebSocket streaming pipeline connected", data["message"])
            self.assertIn("graph_state", data)

    def test_websocket_ping_pong(self):
        with client.websocket_connect(self.ws_url) as ws:
            ws.receive_json()  # Handshake
            ws.send_json({"type": "ping"})
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "pong")
            self.assertIn("timestamp", resp)

    def test_websocket_transcript_caption(self):
        with client.websocket_connect(self.ws_url) as ws:
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
        with client.websocket_connect(self.ws_url) as ws:
            ws.receive_json()  # Handshake
            ws.send_json({"type": "reset_session"})
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "session_reset")
            self.assertEqual(resp["status"], "ok")

    def test_websocket_shorthand_speak_event(self):
        with patch.object(main, "_call_gemini", fake_call_gemini), \
             patch.object(main, "generate_edge_tts_stream", fake_edge_tts_stream):
            with client.websocket_connect(self.ws_url) as ws:
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

    def test_websocket_shorthand_speak_event_with_context(self):
        with patch.object(main, "_call_gemini", fake_call_gemini), \
             patch.object(main, "generate_edge_tts_stream", fake_edge_tts_stream):
            with client.websocket_connect(self.ws_url) as ws:
                ws.receive_json()  # Handshake
                ws.send_json({
                    "type": "shorthand_speak",
                    "shorthand": "repeat light reaction part",
                    "tone": "polite",
                    "context": "Photosynthesis and light reaction concepts",
                })
                resp = ws.receive_json()
                self.assertEqual(resp["type"], "tts_start")
                self.assertIn("photosynthesis", resp["refined_text"].lower())


class TestTextToSpeechEndpoint(unittest.TestCase):
    """POST /api/tts — Edge-TTS synthesis for the REST fallback speech path."""

    def test_english_text_streams_audio(self):
        with patch.object(main, "HAS_EDGE_TTS", True), \
             patch.object(main, "generate_edge_tts_stream", fake_edge_tts_stream):
            res = client.post("/api/tts", json={"text": "Hello class, welcome back."})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("audio/mpeg"))
        self.assertEqual(res.content, b"\xff\xfb\x90\x00\x00fake-mp3-frame")

    def test_urdu_text_picks_urdu_voice(self):
        captured = {}

        async def recording_stream(text, voice=None):
            captured["voice"] = voice
            yield b"\xff\xfb\x90\x00\x00fake-mp3-frame"

        with patch.object(main, "HAS_EDGE_TTS", True), \
             patch.object(main, "generate_edge_tts_stream", recording_stream):
            res = client.post("/api/tts", json={"text": "یہ ایک اردو جملہ ہے۔"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(captured["voice"], main.EDGE_TTS_VOICE_UR)

    def test_explicit_voice_overrides_autodetection(self):
        captured = {}

        async def recording_stream(text, voice=None):
            captured["voice"] = voice
            yield b"\xff\xfb\x90\x00\x00fake-mp3-frame"

        with patch.object(main, "HAS_EDGE_TTS", True), \
             patch.object(main, "generate_edge_tts_stream", recording_stream):
            res = client.post(
                "/api/tts",
                json={"text": "Hello class", "voice": "en-US-GuyNeural"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(captured["voice"], "en-US-GuyNeural")

    def test_empty_text_rejected(self):
        res = client.post("/api/tts", json={"text": ""})
        self.assertEqual(res.status_code, 422)

    def test_oversized_text_rejected(self):
        res = client.post("/api/tts", json={"text": "x" * (main.MAX_TRANSCRIPT_CHARS + 1)})
        self.assertEqual(res.status_code, 422)


class TestRoomManagement(unittest.TestCase):
    def test_create_room_returns_valid_id(self):
        resp = client.post("/api/rooms/create")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("room_id", data)
        self.assertEqual(len(data["room_id"]), 6)

    def test_validate_existing_room(self):
        resp_create = client.post("/api/rooms/create")
        room_id = resp_create.json()["room_id"]
        resp_val = client.get(f"/api/rooms/{room_id}/validate")
        self.assertEqual(resp_val.status_code, 200)
        self.assertTrue(resp_val.json()["valid"])

    def test_validate_nonexistent_room(self):
        resp_val = client.get("/api/rooms/NONEXISTENT/validate")
        self.assertEqual(resp_val.status_code, 200)
        self.assertFalse(resp_val.json()["valid"])

    def test_webrtc_signaling_relay(self):
        resp = client.post("/api/rooms/create")
        room_id = resp.json()["room_id"]

        with client.websocket_connect(f"/ws/live-session/{room_id}/peerA") as ws_a:
            ready_a = ws_a.receive_json()
            self.assertEqual(ready_a["type"], "ready")

            with client.websocket_connect(f"/ws/live-session/{room_id}/peerB") as ws_b:
                ready_b = ws_b.receive_json()
                self.assertEqual(ready_b["type"], "ready")
                self.assertIn("peerA", ready_b["peers"])

                # peerA should receive peer_joined
                joined_msg = ws_a.receive_json()
                self.assertEqual(joined_msg["type"], "peer_joined")
                self.assertEqual(joined_msg["peer_id"], "peerB")

                # peerA sends offer to peerB
                ws_a.send_json({
                    "type": "webrtc_offer",
                    "target_peer": "peerB",
                    "offer": {"type": "offer", "sdp": "fake_sdp"}
                })

                offer_msg = ws_b.receive_json()
                self.assertEqual(offer_msg["type"], "webrtc_offer")
                self.assertEqual(offer_msg["source_peer"], "peerA")

                # peerB sends answer to peerA
                ws_b.send_json({
                    "type": "webrtc_answer",
                    "target_peer": "peerA",
                    "answer": {"type": "answer", "sdp": "fake_answer"}
                })

                answer_msg = ws_a.receive_json()
                self.assertEqual(answer_msg["type"], "webrtc_answer")
                self.assertEqual(answer_msg["source_peer"], "peerB")

    def test_audio_role_and_state_signaling(self):
        resp = client.post("/api/rooms/create")
        room_id = resp.json()["room_id"]

        with client.websocket_connect(f"/ws/live-session/{room_id}/teacher1") as ws_host:
            ready_host = ws_host.receive_json()
            self.assertEqual(ready_host["type"], "ready")

            # Host announces role
            ws_host.send_json({
                "type": "role_announce",
                "role": "host",
                "name": "Prof. Ali"
            })

            with client.websocket_connect(f"/ws/live-session/{room_id}/student1") as ws_student:
                ready_student = ws_student.receive_json()
                self.assertEqual(ready_student["type"], "ready")
                self.assertEqual(ready_student.get("host_id"), "teacher1")

                # teacher receives peer_joined
                joined_msg = ws_host.receive_json()
                self.assertEqual(joined_msg["type"], "peer_joined")
                self.assertEqual(joined_msg["peer_id"], "student1")

                # Host sends audio state (e.g. muted/unmuted)
                ws_host.send_json({
                    "type": "audio_state",
                    "is_muted": True
                })

                # Student receives audio state
                audio_msg = ws_student.receive_json()
                self.assertEqual(audio_msg["type"], "audio_state")
                self.assertTrue(audio_msg["is_muted"])
                self.assertEqual(audio_msg["peer_id"], "teacher1")


if __name__ == "__main__":
    unittest.main(verbosity=2)

