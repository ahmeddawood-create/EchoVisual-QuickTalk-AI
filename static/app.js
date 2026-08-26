/* EchoVisual & QuickTalk: application logic, extracted from index.html
   per the AGENTS.md single-file rule (500-line cap). */
'use strict';

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
const API_BASE = window.location.origin;          // served by FastAPI
const CHUNK_FLUSH_MS = 8000;                      // finalize buffer every 8s (faster diagrams)
const MIN_API_GAP_MS = 4100;                      // 1 req / 4.1s -> max 14/min (safely < 15 RPM cap)
const MAX_TRANSCRIPT_CHARS = 4000;                // mirrors backend limit

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const startBtn = document.getElementById('start-class-btn');
const statusPill = document.getElementById('status-pill');
const audioMeter = document.getElementById('audio-meter');
const micWarning = document.getElementById('mic-warning');
const diagramContainer = document.getElementById('diagram-container');
const lastUpdate = document.getElementById('last-update');
const summaryList = document.getElementById('summary-list');
const termsList = document.getElementById('terms-list');
const captionBody = document.getElementById('caption-body');
const captionFinal = document.getElementById('caption-final');
const captionInterim = document.getElementById('caption-interim');
const captionEmpty = document.getElementById('caption-empty');
const captionDot = document.getElementById('caption-dot');
const shorthandInput = document.getElementById('shorthand-input');
const charCount = document.getElementById('char-count');
const speakBtn = document.getElementById('speak-btn');
const clearBtn = document.getElementById('clear-btn');
const spokenLog = document.getElementById('spoken-log');
const errorBanner = document.getElementById('error-banner');

function showError(message) {
    console.error('UI error:', message);
    errorBanner.textContent = message;
    // 'invisible' (not 'hidden') so the banner slot keeps its height and the
    // panel never resizes when errors appear or clear.
    errorBanner.classList.remove('invisible');
}

function clearError() {
    errorBanner.classList.add('invisible');
}

function stamp() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ------------------------------------------------------------------
// Mermaid setup
// ------------------------------------------------------------------
mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrors: true });
let mermaidSeq = 0;

async function renderDiagram(code) {
    // AGENTS.md §6: wrap rendering in try/catch and KEEP the previous
    // diagram on screen if Gemini returns broken syntax.
    // Returns true when a new diagram made it to the screen.
    try {
        const clean = code.trim().replace(/^```(mermaid)?\s*/i, '').replace(/```$/, '');
        await mermaid.parse(clean); // throws on invalid syntax
        const id = `mermaid-graph-${++mermaidSeq}`;
        const { svg } = await mermaid.render(id, clean);
        diagramContainer.innerHTML = `<div class="rise-in w-full">${svg}</div>`;
        lastUpdate.textContent = `updated ${stamp()}`;
        clearError();
        console.log('Diagram rendered successfully');
        return true;
    } catch (err) {
        console.error('Mermaid render failed, keeping previous diagram:', err);
        showError('Gemini returned an invalid diagram. Keeping the previous one on screen.');
        return false;
    }
}

function renderSummary(bullets, terms) {
    summaryList.innerHTML = bullets.length
        ? bullets.map(b => `<li class="rise-in flex gap-2.5"><span class="text-cobalt-soft font-mono mt-[1px]">/</span><span>${escapeHtml(b)}</span></li>`).join('')
        : '<li class="text-slate-600 italic">No summary available.</li>';

    termsList.innerHTML = terms.length
        ? terms.map(t => `<span class="rise-in px-2.5 py-1 rounded-md bg-cobalt/15 border border-cobalt/30 text-cobalt-soft text-xs">${escapeHtml(t)}</span>`).join('')
        : '<span class="text-slate-600 italic text-sm">None detected.</span>';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Large-text live caption for the deaf student: full finalized text plus the
// in-progress phrase, auto-scrolled so the newest words stay in view.
function renderCaption(interimText) {
    captionFinal.textContent = interimBuffer;
    captionInterim.textContent = interimText ? interimText : '';
    const hasContent = (interimBuffer + interimText).trim().length > 0;
    captionEmpty.classList.toggle('hidden', hasContent);
    captionBody.scrollTop = captionBody.scrollHeight;
}

// ------------------------------------------------------------------
// Rate-limited API queue (Day 3 / Task 3.1)
// Never fires more than 1 backend request every MIN_API_GAP_MS.
// Consecutive transcript tasks are merged so stale chunks never
// consume quota.
// ------------------------------------------------------------------
const apiQueue = [];
let queueRunning = false;
let lastApiCallAt = 0;

function enqueueApiTask(kind, payload) {
    if (kind === 'diagram') {
        const last = apiQueue[apiQueue.length - 1];
        if (last && last.kind === 'diagram') {
            last.payload = payload; // merge: only the freshest chunk matters
            console.log('Chunk merged into queued request (rate saving)');
            return;
        }
    }
    apiQueue.push({ kind, payload });
    processApiQueue();
}

async function processApiQueue() {
    if (queueRunning) return;
    queueRunning = true;
    while (apiQueue.length > 0) {
        const elapsed = Date.now() - lastApiCallAt;
        if (elapsed < MIN_API_GAP_MS) {
            await sleep(MIN_API_GAP_MS - elapsed);
        }
        const task = apiQueue.shift();
        lastApiCallAt = Date.now();
        try {
            if (task.kind === 'diagram') {
                await sendTranscriptChunk(task.payload);
            } else if (task.kind === 'speech') {
                await refineAndSpeak(task.payload);
            }
        } catch (err) {
            console.error(`API task (${task.kind}) failed:`, err);
            showError(`${task.kind === 'diagram' ? 'Diagram' : 'Speech'} pipeline failed: ${err.message}`);
        }
    }
    queueRunning = false;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------
// Module 1: Teacher -> Student (Web Speech API + diagram pipeline)
// ------------------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let interimBuffer = '';
let sentLength = 0;      // chars of the buffer already shipped to the backend
let flushTimer = null;

if (!SpeechRecognition) {
    micWarning.classList.remove('hidden');
    startBtn.disabled = true;
    startBtn.classList.add('opacity-40', 'cursor-not-allowed');
    console.warn('SpeechRecognition not supported in this browser');
} else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                interimBuffer += text + ' ';
                console.log('Final result appended to buffer:', text);
            } else {
                interim += text;
            }
        }
        renderCaption(interim);
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            setStatus('mic blocked', 'bg-red-950 text-red-300 border-red-900');
            stopListening();
        }
    };

    recognition.onend = () => {
        // Auto-restart while the class is running (Chrome kills the
        // recognizer after ~60s of continuous use).
        if (isListening) {
            console.log('Recognition ended, auto-restarting');
            try { recognition.start(); } catch (e) { /* already started */ }
        }
    };
}

function startListening() {
    if (!recognition) return;
    interimBuffer = '';
    sentLength = 0;
    isListening = true;
    captionFinal.textContent = '';
    captionInterim.textContent = '';
    captionEmpty.classList.remove('hidden');
    captionDot.classList.replace('bg-slate-600', 'bg-emerald-400');
    captionDot.classList.add('animate-pulse');
    try {
        recognition.start();
        console.log('Listening started');
    } catch (e) {
        console.warn('Recognition start threw (likely already running):', e.message);
    }
    startBtn.textContent = 'Stop Class';
    startBtn.classList.replace('bg-cobalt', 'bg-red-600');
    startBtn.classList.replace('hover:bg-cobalt-soft', 'hover:bg-red-500');
    audioMeter.classList.replace('hidden', 'flex');
    setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
    flushTimer = setInterval(flushTranscriptChunk, CHUNK_FLUSH_MS);
    console.log(`Chunk flush timer started (every ${CHUNK_FLUSH_MS / 1000}s)`);
}

function stopListening() {
    isListening = false;
    if (recognition) recognition.stop();
    clearInterval(flushTimer);
    flushTimer = null;
    startBtn.textContent = 'Start Class';
    startBtn.classList.replace('bg-red-600', 'bg-cobalt');
    startBtn.classList.replace('hover:bg-red-500', 'hover:bg-cobalt-soft');
    audioMeter.classList.replace('flex', 'hidden');
    setStatus('idle', 'bg-raised text-slate-400 border-edge');
    captionDot.classList.remove('animate-pulse');
    captionDot.classList.replace('bg-emerald-400', 'bg-slate-600');
    console.log('Listening stopped');
}

function flushTranscriptChunk() {
    const pending = interimBuffer.slice(sentLength).trim();
    if (pending.length < 10) {
        console.log('Flush skipped, not enough new speech yet');
        return;
    }
    const chunk = pending.slice(0, MAX_TRANSCRIPT_CHARS);
    sentLength = interimBuffer.length;
    if (interimBuffer.length > 8000) {
        interimBuffer = interimBuffer.slice(-4000); // keep memory bounded
        sentLength = 0;
    }
    console.log(`Chunk sent (${chunk.length} chars): "${chunk.slice(0, 60)}..."`);
    enqueueApiTask('diagram', chunk);
}

async function sendTranscriptChunk(transcript) {
    setStatus('generating', 'bg-cobalt/15 text-cobalt-soft border-cobalt/30');
    lastUpdate.textContent = 'generating…'; // instant feedback while Gemini works
    const res = await fetch(`${API_BASE}/api/transcribe-to-diagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Backend responded ${res.status}`);
    }
    // AGENTS.md §6: validate JSON shape BEFORE touching the DOM.
    const data = await res.json();
    if (typeof data.diagram_code !== 'string' || !Array.isArray(data.summary_bullets) || !Array.isArray(data.key_terms)) {
        throw new Error('Invalid response shape from backend');
    }
    await renderDiagram(data.diagram_code);
    renderSummary(data.summary_bullets, data.key_terms);
    if (isListening) {
        setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
    }
}

// ------------------------------------------------------------------
// Module 2: Student -> Class (shorthand refinement + speechSynthesis)
// ------------------------------------------------------------------
async function refineAndSpeak(text) {
    speakBtn.disabled = true;
    setStatus('refining', 'bg-cobalt/15 text-cobalt-soft border-cobalt/30');
    try {
        const res = await fetch(`${API_BASE}/api/shorthand-to-speech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shorthand: text }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Backend responded ${res.status}`);
        }
        const data = await res.json();
        if (typeof data.refined_text !== 'string' || data.refined_text.length === 0) {
            throw new Error('Invalid response shape from backend');
        }
        console.log('Refined text received:', data.refined_text);
        speak(data.refined_text);
    } catch (err) {
        console.error('Speech pipeline failed, speaking raw input instead:', err.message);
        // Fallback: the student's voice is still heard, unrefined.
        speak(text);
    } finally {
        speakBtn.disabled = false;
        if (isListening) {
            setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
        } else {
            setStatus('idle', 'bg-raised text-slate-400 border-edge');
        }
    }
}

function speak(text) {
    if (!('speechSynthesis' in window)) {
        console.error('speechSynthesis not supported');
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onstart = () => console.log('Audio playing');
    utterance.onend = () => console.log('Audio finished');
    utterance.onerror = (e) => console.error('Audio playback error:', e.error);
    window.speechSynthesis.speak(utterance);
    logSpoken(text);
}

function logSpoken(text) {
    const li = document.createElement('li');
    li.className = 'rise-in bg-ink border border-edge rounded-lg px-3 py-2 text-slate-300 flex items-start gap-2.5';
    li.innerHTML = `<span class="font-mono text-[10px] text-slate-600 mt-[3px] shrink-0">${stamp()}</span><span></span>`;
    li.lastElementChild.textContent = text;
    if (spokenLog.firstElementChild && spokenLog.firstElementChild.classList.contains('italic')) {
        spokenLog.innerHTML = '';
    }
    spokenLog.prepend(li);
    while (spokenLog.children.length > 20) spokenLog.lastChild.remove();
}

function setStatus(label, classes) {
    statusPill.textContent = label;
    statusPill.className = `font-mono text-[11px] px-3 py-1.5 rounded-full border ${classes}`;
}

// ------------------------------------------------------------------
// Event wiring
// ------------------------------------------------------------------
startBtn.addEventListener('click', () => {
    isListening ? stopListening() : startListening();
});

speakBtn.addEventListener('click', () => {
    const text = shorthandInput.value.trim();
    if (!text) {
        console.log('Speak skipped, empty input');
        return;
    }
    enqueueApiTask('speech', text);
    shorthandInput.value = '';
    charCount.textContent = '0';
});

clearBtn.addEventListener('click', () => {
    shorthandInput.value = '';
    charCount.textContent = '0';
    shorthandInput.focus();
});

shorthandInput.addEventListener('input', () => {
    charCount.textContent = String(shorthandInput.value.length);
});

shorthandInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        speakBtn.click();
    }
});

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const text = btn.dataset.text;
        console.log('Preset pressed:', text);
        enqueueApiTask('speech', text);
    });
});

// Security: warn when not on a secure context (mic APIs require it).
if (!window.isSecureContext) {
    micWarning.classList.remove('hidden');
    console.warn('Not a secure context, microphone APIs may be blocked');
}

console.log('EchoVisual & QuickTalk UI ready');
