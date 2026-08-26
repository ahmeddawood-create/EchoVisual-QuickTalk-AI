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


async def fake_call_gemini(prompt, system, response_mime):
    if response_mime == "application/json":
        return VALID_DIAGRAM_JSON
    return "Could you please repeat the last point?"


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

    def test_empty_shorthand_rejected(self):
        res = client.post("/api/shorthand-to-speech", json={"shorthand": ""})
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
        self.assertIn("enqueueApiTask", js.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
