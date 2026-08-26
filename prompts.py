"""Gemini prompt templates for EchoVisual & QuickTalk AI.

Kept separate from main.py so routing stays clean (AGENTS.md §4).
"""

DIAGRAM_SYSTEM_INSTRUCTIONS = (
    "You are an expert classroom accessibility assistant. You convert live teacher "
    "transcripts into clear visual learning aids for deaf/hard-of-hearing students."
)

DIAGRAM_PROMPT_TEMPLATE = """Turn this classroom transcript into a visual study aid.

TRANSCRIPT:
\"\"\"{transcript}\"\"\"

Return ONLY a JSON object with these keys:
1. "diagram_code": a valid Mermaid.js diagram of the concept or flow. Raw syntax only
   (start with "flowchart TD" or "graph LR"), no markdown fences, no explanation.
   Maximum 8 nodes with short labels.
2. "summary_bullets": 2 to 3 short plain-language strings summarizing the key points.
3. "key_terms": 2 to 4 important terms mentioned or implied.

If the transcript is too short or unclear, return:
{{"diagram_code": "flowchart TD\\nA[Waiting for more context]", "summary_bullets": [], "key_terms": []}}
"""

SHORTHAND_SYSTEM_INSTRUCTIONS = (
    "You are a speech-refinement assistant for students who communicate in shorthand. "
    "You expand fragmented notes into confident, natural spoken sentences."
)

SHORTHAND_PROMPT_TEMPLATE = """Rewrite this student shorthand as ONE clear, grammatically correct sentence
suitable for speaking aloud to the class. Preserve the exact meaning and intent.
Output only the sentence, nothing else.

SHORTHAND:
\"\"\"{shorthand}\"\"\"
"""
