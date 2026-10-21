/* ==========================================================================
   EchoVisual & QuickTalk AI - Multi-Page Application Logic
   5 Dedicated Views with Continuous Live Background Recording:
   1. 🎙️ Classroom View (#classroom): Live Speech + Urdu/Eng + Multi-Lang Translation + Visual Stream
   2. 🗣️ Student Expression Board (#expression): Full-page voice composer, Pakistani soundboards & spoken history
   3. 📚 Study Hub & Quiz Arena (#study): Structured study notes, interactive MCQs & 3D flashcards
   4. 🤖 AI Classroom Tutor (#tutor): Full-screen contextual conversational tutor (Roman Urdu & English)
   5. 💾 Session Storage & Downloads (#storage): Session archives, 1-click restore & multi-format export center
   ========================================================================== */

'use strict';

// ------------------------------------------------------------------
// Global DOM Reference Utilities
// ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
window.$ = $;
window.$$ = $$;

// ------------------------------------------------------------------
// Configuration & Constants
// ------------------------------------------------------------------
const API_BASE = window.location.origin;
// Keep the queue safely under the backend's 15 req/min sliding window (~14/min).
// A 3.5s gap allowed ~17 req/min and triggered avoidable 429s.
const MIN_API_GAP_MS = 4100;
const MAX_TRANSCRIPT_CHARS = 4000;
const LAST_SESSION_KEY = 'echovisual_last_session';
const SAVED_SESSIONS_KEY = 'echovisual_saved_sessions';
const THEME_STORAGE_KEY = 'echovisual_theme';
const COLOR_MODE_KEY = 'echovisual_color_mode';
const CUSTOM_PRESETS_KEY = 'echovisual_custom_presets';

// ------------------------------------------------------------------
// Application State
// ------------------------------------------------------------------
let sessionDiagrams = [];
let currentDiagramIndex = -1;
let allSessionKeyTerms = new Set();
let spokenHistory = [];
let chatHistory = [];
let sessionStartTime = null;
let currentThemeClass = 'theme-indigo';
let currentColorMode = 'dark';
let zoomLevel = 1.0;
let currentTranslationText = '';
let currentTargetLanguage = 'Urdu (اردو)';
let isReadingAloud = false;
let isGeneratingDiagram = false;
let isGeneratingNotes = false;
let isGeneratingQuiz = false;
let isGeneratingFlashcards = false;
let captionSpeechUtterance = null;
let captionAudioEl = null;
let graphSeq = 0;
// True when the current session has content that is not yet archived.
let hasUnsavedSessionChanges = false;

// Speech Recognition State (Continuous Live Capture)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let interimBuffer = '';

// Groq Whisper STT State (Accurate Urdu transcription via free API)
// Groq free tier: 20 RPM, 2 000 RPD, 7 200 audio-sec/hr, 28 800 audio-sec/day.
// We record 6-sec chunks every 5 sec → ~12 RPM, safely under 20 RPM.
let groqRecorder = null;
let groqMicStream = null;
let groqTimerId = null;
let groqCumulativeText = '';
let groqIsActive = false;
const GROQ_CHUNK_INTERVAL_MS = 5000;

// Auto-Diagram Periodic & Debounce State
let autoDiagramInterval = null;
let autoDiagramTimer = null;
let lastAutoDiagramTranscript = '';
let lastAutoDiagramAt = 0;
const AUTO_DIAGRAM_INTERVAL_MS = 8000;
const AUTO_DIAGRAM_DEBOUNCE_MS = 3000;
const AUTO_DIAGRAM_MIN_NEW_CHARS = 20;

// Rate-limited API Queue State
const apiQueue = [];
let queueRunning = false;
let lastApiCallAt = 0;

// ------------------------------------------------------------------
// Web Audio API Streaming Player (Low-Latency Neural TTS)
// ------------------------------------------------------------------
class StreamAudioPlayer {
    constructor() {
        this.audioCtx = null;
        this.queue = [];
        this.isPlaying = false;
        this.nextPlayTime = 0;
    }

    ensureContext() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        return this.audioCtx;
    }

    reset() {
        this.queue = [];
        this.isPlaying = false;
        this.nextPlayTime = 0;
    }

    async enqueueChunk(arrayBuffer) {
        const ctx = this.ensureContext();
        if (!ctx) return;
        try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            this.queue.push(audioBuffer);
            if (!this.isPlaying) {
                this.playNext();
            }
        } catch (e) {
            console.warn('Audio decoding chunk error:', e);
        }
    }

    playNext() {
        const ctx = this.ensureContext();
        if (!ctx || this.queue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const audioBuffer = this.queue.shift();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startTime = Math.max(now, this.nextPlayTime);
        source.start(startTime);
        this.nextPlayTime = startTime + audioBuffer.duration;

        source.onended = () => {
            if (this.queue.length > 0) {
                this.playNext();
            } else {
                this.isPlaying = false;
            }
        };
    }
}
const streamAudioPlayer = new StreamAudioPlayer();

// ------------------------------------------------------------------
// Full-Duplex WebSocket Streaming Pipeline Manager (/ws/live-session)
// ------------------------------------------------------------------
let wsSocket = null;
let wsConnected = false;
let wsReconnectIndex = 0;
const WS_RECONNECT_BACKOFF = [1000, 2000, 5000, 10000];
let wsReconnectTimer = null;
let currentRoomId = null;
let currentClientId = Math.random().toString(36).substring(2, 10);

function initLiveWebSocket(roomId) {
    if (wsSocket) {
        try { wsSocket.close(); } catch (e) {}
        wsSocket = null;
    }

    if (!roomId) roomId = currentRoomId;
    if (!roomId) return;
    currentRoomId = roomId;

    const loc = window.location;
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${loc.host}/ws/live-session/${roomId}/${currentClientId}`;

    try {
        wsSocket = new WebSocket(wsUrl);
        wsSocket.binaryType = 'arraybuffer';

        wsSocket.onopen = () => {
            wsConnected = true;
            wsReconnectIndex = 0;
            console.log(`⚡ Connected to room ${roomId} as ${currentClientId}`);
        };

        wsSocket.onmessage = async (event) => {
            if (event.data instanceof ArrayBuffer) {
                streamAudioPlayer.enqueueChunk(event.data);
                return;
            }

            try {
                const msg = JSON.parse(event.data);
                handleWsEvent(msg);
            } catch (err) {
                console.warn('WS message parse error:', err);
            }
        };

        wsSocket.onerror = (err) => {
            console.warn('WS error:', err);
        };

        wsSocket.onclose = () => {
            wsConnected = false;
            scheduleWsReconnect();
        };
    } catch (e) {
        wsConnected = false;
        scheduleWsReconnect();
    }
}

function scheduleWsReconnect() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    // Keep retrying forever with a capped interval: the live-session backend
    // is real, and students must rejoin automatically after e.g. a server restart.
    const delay = WS_RECONNECT_BACKOFF[wsReconnectIndex] || 5000;
    wsReconnectIndex = Math.min(wsReconnectIndex + 1, WS_RECONNECT_BACKOFF.length - 1);
    wsReconnectTimer = setTimeout(() => {
        initLiveWebSocket();
    }, delay);
}

function sendWsMessage(payload) {
    if (wsSocket && wsSocket.readyState === WebSocket.OPEN) {
        wsSocket.send(JSON.stringify(payload));
        return true;
    }
    return false;
}

function sendWsTranscriptChunk(text, isFinal = false, isPause = false) {
    return sendWsMessage({
        type: 'transcript_chunk',
        text: text,
        is_final: isFinal,
        speaker_pause: isPause,
    });
}

function handleWsEvent(msg) {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'ready':
            console.log('[WS] Ready handshake received:', msg.message);
            if (msg.graph_state) {
                renderDiagramDirect(msg.graph_state, msg.summary_bullets, msg.key_terms);
            }
            if (msg.peers) {
                msg.peers.forEach((peerId) => {
                    createPeerConnection(peerId, false);
                });
            }
            break;

        case 'caption':
            if (msg.rolling_transcript !== undefined) {
                interimBuffer = msg.rolling_transcript;
                renderCaption(msg.is_final ? '' : (msg.text || ''));
            }
            break;

        case 'diagram_delta':
            applyLiveDiagramDelta(msg.deltas, msg.graph_state, msg.summary_bullets, msg.key_terms);
            break;

        case 'tts_start':
            streamAudioPlayer.ensureContext();
            streamAudioPlayer.reset();
            toggleAudioVisualizer(true);
            showToast(`🔊 Streaming ${msg.voice || 'Neural'} voice...`);
            break;

        case 'tts_end':
            if (msg.refined_text) {
                setRefinePreview(msg.refined_text);
                logSpoken(msg.refined_text);
                if (!streamAudioPlayer.audioCtx && 'speechSynthesis' in window) {
                    speak(msg.refined_text);
                }
            }
            toggleAudioVisualizer(false);
            break;

        case 'session_reset':
            console.log('[WS] Session reset');
            interimBuffer = '';
            renderCaption('');
            renderDiagramDirect({ nodes: [], edges: [] }, [], []);
            break;

        case 'peer_joined':
            if (msg.peer_id) {
                console.log(`[WS] Peer joined: ${msg.peer_id}`);
                createPeerConnection(msg.peer_id, true);
                showToast(`👤 Peer joined class`);
            }
            break;

        case 'peer_left':
            if (msg.peer_id) {
                console.log(`[WS] Peer left: ${msg.peer_id}`);
                removeVideoElement(msg.peer_id);
                if (peerConnections[msg.peer_id]) {
                    peerConnections[msg.peer_id].close();
                    delete peerConnections[msg.peer_id];
                }
                delete iceCandidateQueues[msg.peer_id];
                showToast(`👤 Peer left class`);
            }
            break;

        case 'webrtc_offer':
            if (msg.source_peer && msg.offer) {
                console.log(`[WS] Received offer from ${msg.source_peer}`);
                const pc = createPeerConnection(msg.source_peer, false);
                pc.setRemoteDescription(new RTCSessionDescription(msg.offer))
                    .then(() => {
                        handleQueuedIceCandidates(msg.source_peer, pc);
                        return pc.createAnswer();
                    })
                    .then((answer) => pc.setLocalDescription(answer))
                    .then(() => {
                        console.log(`[WS] Sending answer to ${msg.source_peer}`);
                        sendWsMessage({
                            type: 'webrtc_answer',
                            target_peer: msg.source_peer,
                            answer: pc.localDescription,
                        });
                    })
                    .catch((e) => console.warn('[WS] Offer handling error:', e));
            }
            break;

        case 'webrtc_answer':
            if (msg.source_peer && msg.answer && peerConnections[msg.source_peer]) {
                console.log(`[WS] Received answer from ${msg.source_peer}`);
                const pc = peerConnections[msg.source_peer];
                pc.setRemoteDescription(new RTCSessionDescription(msg.answer))
                    .then(() => {
                        handleQueuedIceCandidates(msg.source_peer, pc);
                    })
                    .catch((e) => console.warn('[WS] Answer handling error:', e));
            }
            break;

        case 'webrtc_ice_candidate':
            if (msg.source_peer && msg.candidate) {
                const pc = peerConnections[msg.source_peer];
                if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                    try {
                        pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch((e) => console.warn('[WS] ICE add error:', e));
                    } catch (e) {
                        console.warn('[WS] Invalid ICE candidate:', e);
                    }
                } else {
                    if (!iceCandidateQueues[msg.source_peer]) {
                        iceCandidateQueues[msg.source_peer] = [];
                    }
                    iceCandidateQueues[msg.source_peer].push(msg.candidate);
                }
            }
            break;
    }
}

// NOTE: renderDiagramDirect and applyLiveDiagramDelta are defined further
// down (next to renderDiagram) — these pipelines were previously declared
// twice, with the earlier (stale) copies silently overridden by the later ones.

// ------------------------------------------------------------------
// Toast & Banner Notifications
// ------------------------------------------------------------------
function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast pointer-events-auto px-4 py-2.5 rounded-xl bg-panel border border-edge shadow-2xl text-xs font-mono text-slate-100 flex items-center gap-2 border-accent/40';
    toast.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
        <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function showError(message) {
    console.error('UI error:', message);
    const banner = $('error-banner');
    if (banner) {
        banner.textContent = message;
        banner.classList.remove('invisible');
    }
}

function clearError() {
    const banner = $('error-banner');
    if (banner) banner.classList.add('invisible');
}

function setStatus(label, classes) {
    const pill = $('status-pill');
    if (pill) {
        pill.textContent = label;
        pill.className = `font-mono text-[11px] px-3 py-1.5 rounded-full border hidden sm:inline-block ${classes}`;
    }
}

function stamp() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fileStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    // innerHTML alone does not escape quotes, which would corrupt HTML
    // attributes (data-option, data-text, ...) built from Gemini output.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(successMsg)).catch(() => fallbackCopy(text, successMsg));
    } else {
        fallbackCopy(text, successMsg);
    }
}

function fallbackCopy(text, successMsg) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast(successMsg);
    } catch {
        showToast('Copy failed');
    }
    document.body.removeChild(ta);
}

// ------------------------------------------------------------------
// Multi-Page SPA Router
// ------------------------------------------------------------------
const VALID_PAGES = ['classroom', 'rooms', 'expression', 'study', 'tutor', 'storage'];

function navigateToPage(pageName) {
    if (!VALID_PAGES.includes(pageName)) {
        pageName = 'classroom';
    }

    if (window.location.hash !== `#${pageName}`) {
        window.location.hash = `#${pageName}`;
    }

    // Hide all views & remove active nav classes
    VALID_PAGES.forEach((p) => {
        const viewEl = $(`view-${p}`);
        if (viewEl) {
            viewEl.classList.remove('active');
            viewEl.classList.add('hidden');
        }

        const navLink = $(`nav-${p}`);
        if (navLink) {
            navLink.classList.remove('active');
            navLink.classList.remove('text-white', 'font-semibold');
            navLink.classList.add('text-slate-400');
        }
    });

    $$('.mobile-nav-link').forEach((link) => link.classList.remove('active'));

    // Show active page view
    const activeView = $(`view-${pageName}`);
    if (activeView) {
        activeView.classList.remove('hidden');
        activeView.classList.add('active');
    }

    const activeNav = $(`nav-${pageName}`);
    if (activeNav) {
        activeNav.classList.add('active');
        activeNav.classList.remove('text-slate-400');
        activeNav.classList.add('text-white', 'font-semibold');
    }

    const activeMobileNav = document.querySelector(`.mobile-nav-link[data-page="${pageName}"]`);
    if (activeMobileNav) activeMobileNav.classList.add('active');

    // Page-specific on-enter hooks
    if (pageName === 'rooms') {
        updateHubActiveCard();
    } else if (pageName === 'storage') {
        refreshStorageDashboard();
    } else if (pageName === 'study') {
        if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
            displayDiagramSnapshot(currentDiagramIndex);
        }
    } else if (pageName === 'expression') {
        const input = $('shorthand-input');
        if (input) input.focus();
    } else if (pageName === 'tutor') {
        const input = $('chat-input');
        if (input) input.focus();
    }
}

function initPageRouter() {
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '') || 'classroom';
        navigateToPage(hash);
    });

    const initialPage = window.location.hash.replace('#', '') || 'classroom';
    navigateToPage(initialPage);
}

// ------------------------------------------------------------------
// Theme & Light/Dark Mode Engine
// ------------------------------------------------------------------
function applyThemeAndMode() {
    const html = document.documentElement;
    const allThemes = ['theme-indigo', 'theme-cobalt', 'theme-emerald', 'theme-violet', 'theme-cyan'];
    allThemes.forEach((t) => html.classList.remove(t));
    html.classList.add(currentThemeClass);

    if (currentColorMode === 'light') {
        html.classList.remove('dark');
        html.classList.add('light');
        if ($('mode-icon')) $('mode-icon').textContent = '☀️';
        if ($('mode-text')) $('mode-text').textContent = 'Light';
    } else {
        html.classList.remove('light');
        html.classList.add('dark');
        if ($('mode-icon')) $('mode-icon').textContent = '🌙';
        if ($('mode-text')) $('mode-text').textContent = 'Dark';
    }

    try {
        localStorage.setItem(THEME_STORAGE_KEY, currentThemeClass);
        localStorage.setItem(COLOR_MODE_KEY, currentColorMode);
    } catch (e) {
        console.warn('LocalStorage error:', e);
    }

    if (visNetwork && typeof getVisNetworkOptions === 'function') {
        visNetwork.setOptions(getVisNetworkOptions());
    }
}

function initThemesAndModes() {
    try {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme) currentThemeClass = savedTheme;
        const savedMode = localStorage.getItem(COLOR_MODE_KEY);
        if (savedMode) currentColorMode = savedMode;
    } catch (e) {
        console.warn('LocalStorage error:', e);
    }
    applyThemeAndMode();

    const modeBtn = $('color-mode-toggle-btn');
    if (modeBtn) {
        modeBtn.addEventListener('click', () => {
            currentColorMode = currentColorMode === 'dark' ? 'light' : 'dark';
            applyThemeAndMode();
            showToast(`Switched to ${currentColorMode === 'dark' ? 'Dark 🌙' : 'Light ☀️'} Mode`);
        });
    }

    $$('.theme-select-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            if (theme) {
                currentThemeClass = theme;
                applyThemeAndMode();
                showToast(`Applied theme: ${theme.replace('theme-', '')}`);
            }
        });
    });

    const themeBtn = $('theme-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            // On mobile or touch devices, tapping cycles to the next theme
            if (window.innerWidth < 1024 || 'ontouchstart' in window) {
                e.stopPropagation();
                const allThemes = ['theme-indigo', 'theme-cobalt', 'theme-emerald', 'theme-violet', 'theme-cyan'];
                const idx = allThemes.indexOf(currentThemeClass);
                const nextTheme = allThemes[(idx + 1) % allThemes.length];
                currentThemeClass = nextTheme;
                applyThemeAndMode();
                showToast(`Applied theme: ${nextTheme.replace('theme-', '')}`);
            }
        });
    }
}

// ------------------------------------------------------------------
// Vis.js Network Engine (Interactive Physics-Based Concept Graphs)
// ------------------------------------------------------------------
let visNetwork = null;
let visNodes = null;
let visEdges = null;
let currentLayoutMode = 'network'; // 'network' | 'hierarchical'
let isPhysicsEnabled = true;
let selectedConceptNodeId = null;
let currentGraphRaw = { nodes: [], edges: [] };

function formatConceptNodesAndEdges(rawNodes, rawEdges) {
    const isDark = document.documentElement.classList.contains('dark');
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#6366f1';
    const accentSoft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#818cf8';

    // 1. Calculate degree for each node to identify core concepts
    const degrees = {};
    rawNodes.forEach(n => { degrees[String(n.id)] = 0; });
    rawEdges.forEach(e => {
        const fromId = String(e.from);
        const toId = String(e.to);
        degrees[fromId] = (degrees[fromId] || 0) + 1;
        degrees[toId] = (degrees[toId] || 0) + 1;
    });

    const maxDegree = Math.max(1, ...Object.values(degrees));

    // Curated educational palettes with high readability and contrast
    const palettes = isDark ? [
        { bg: 'rgba(16, 185, 129, 0.16)', border: '#10b981', text: '#ecfdf5', glow: 'rgba(16, 185, 129, 0.25)' }, // Emerald
        { bg: 'rgba(6, 182, 212, 0.16)',  border: '#06b6d4', text: '#f0f9ff', glow: 'rgba(6, 182, 212, 0.25)' },  // Cyan
        { bg: 'rgba(245, 158, 11, 0.16)', border: '#f59e0b', text: '#fffbeb', glow: 'rgba(245, 158, 11, 0.25)' }, // Amber
        { bg: 'rgba(244, 63, 94, 0.16)',  border: '#f43f5e', text: '#fff1f2', glow: 'rgba(244, 63, 94, 0.25)' },  // Rose
    ] : [
        { bg: '#d1fae5', border: '#059669', text: '#064e3b', glow: 'rgba(5, 150, 105, 0.15)' },
        { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e', glow: 'rgba(2, 132, 199, 0.15)' },
        { bg: '#fef3c7', border: '#d97706', text: '#78350f', glow: 'rgba(217, 119, 6, 0.15)' },
        { bg: '#ffe4e6', border: '#e11d48', text: '#881337', glow: 'rgba(225, 29, 72, 0.15)' },
    ];

    const formattedNodes = rawNodes.map((n, idx) => {
        const nid = String(n.id);
        const deg = degrees[nid] || 0;
        const isCore = deg >= Math.max(3, maxDegree) && deg > 1;
        const pal = palettes[idx % palettes.length];

        const nodeBg = isCore
            ? (isDark ? 'rgba(99, 102, 241, 0.25)' : '#e0e7ff')
            : pal.bg;
        const nodeBorder = isCore ? accentColor : pal.border;
        const nodeText = isCore ? (isDark ? '#ffffff' : '#1e1b4b') : pal.text;

        return {
            id: nid,
            label: n.label || nid,
            shape: n.shape || 'box',
            shapeProperties: { borderRadius: 10 },
            margin: { top: 10, bottom: 10, left: 16, right: 16 },
            widthConstraint: { maximum: 165 },
            font: {
                color: nodeText,
                size: isCore ? 14 : 12.5,
                face: 'Outfit, system-ui, sans-serif',
                bold: isCore ? { color: nodeText } : undefined,
            },
            color: {
                background: nodeBg,
                border: nodeBorder,
                highlight: {
                    background: isDark ? '#1e293b' : '#e0e7ff',
                    border: accentSoft,
                },
                hover: {
                    background: isDark ? '#1e2a40' : '#f1f5f9',
                    border: accentSoft,
                },
            },
            borderWidth: isCore ? 2.5 : 2,
            borderWidthSelected: 3.5,
            shadow: {
                enabled: true,
                color: isDark ? (isCore ? 'rgba(99, 102, 241, 0.35)' : 'rgba(0,0,0,0.35)') : 'rgba(0,0,0,0.12)',
                size: isCore ? 12 : 8,
                x: 0,
                y: 3,
            },
            title: `${n.label || nid}\nConnections: ${deg}\n(Click to inspect relationships)`,
            _origColor: { background: nodeBg, border: nodeBorder, text: nodeText },
            _isCore: isCore,
        };
    });

    const formattedEdges = rawEdges.map((e, idx) => {
        const edgeLabel = e.label || e.relation || '';
        return {
            id: e.id || `${e.from}_to_${e.to}_${idx}`,
            from: String(e.from),
            to: String(e.to),
            label: edgeLabel,
            arrows: { to: { enabled: true, scaleFactor: 0.85, type: 'arrow' } },
            color: {
                color: isDark ? '#475569' : '#94a3b8',
                highlight: accentSoft,
                hover: accentColor,
            },
            font: {
                color: isDark ? '#cbd5e1' : '#475569',
                size: 10.5,
                face: 'IBM Plex Mono, monospace',
                strokeWidth: 0,
                background: isDark ? '#0f172a' : '#ffffff',
            },
            width: 1.75,
            smooth: {
                type: 'cubicBezier',
                forceDirection: currentLayoutMode === 'hierarchical' ? 'vertical' : 'none',
                roundness: 0.35,
            },
            _origColor: isDark ? '#475569' : '#94a3b8',
        };
    });

    return { formattedNodes, formattedEdges };
}

function getVisNetworkOptions() {
    const isDark = document.documentElement.classList.contains('dark');
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim() || '#6366f1';
    const accentSoft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#818cf8';
    const isHierarchical = currentLayoutMode === 'hierarchical';

    return {
        nodes: {
            shape: 'box',
            shapeProperties: { borderRadius: 10 },
            margin: { top: 10, bottom: 10, left: 16, right: 16 },
            widthConstraint: { maximum: 165 },
            borderWidth: 2,
            borderWidthSelected: 3.5,
            shadow: {
                enabled: true,
                color: 'rgba(0,0,0,0.3)',
                size: 8,
                x: 0,
                y: 3,
            },
        },
        edges: {
            arrows: { to: { enabled: true, scaleFactor: 0.85 } },
            width: 1.75,
            smooth: {
                type: 'cubicBezier',
                forceDirection: isHierarchical ? 'vertical' : 'none',
                roundness: 0.35,
            },
        },
        layout: isHierarchical ? {
            hierarchical: {
                enabled: true,
                direction: 'UD',
                sortMethod: 'directed',
                levelSeparation: 120,
                nodeSpacing: 180,
                treeSpacing: 200,
                blockShifting: true,
                edgeMinimization: true,
                parentCentralization: true,
            },
        } : {
            hierarchical: { enabled: false },
            improvedLayout: true,
        },
        physics: isHierarchical ? {
            enabled: isPhysicsEnabled,
            solver: 'hierarchicalRepulsion',
            hierarchicalRepulsion: {
                nodeDistance: 160,
                centralGravity: 0.0,
                springLength: 110,
                springConstant: 0.015,
                damping: 0.35,
                avoidOverlap: 0.9,
            },
        } : {
            enabled: isPhysicsEnabled,
            solver: 'forceAtlas2Based',
            forceAtlas2Based: {
                gravitationalConstant: -38,
                centralGravity: 0.008,
                springLength: 125,
                springConstant: 0.06,
                damping: 0.45,
                avoidOverlap: 0.9,
            },
            stabilization: {
                enabled: true,
                iterations: 140,
                updateInterval: 25,
                fit: true,
            },
        },
        interaction: {
            hover: true,
            tooltipDelay: 150,
            zoomView: true,
            dragView: true,
            dragNodes: true,
            navigationButtons: false,
            keyboard: false,
            multiselect: false,
            selectConnectedEdges: true,
        },
    };
}

function highlightNeighborhood(selectedId) {
    if (!visNetwork || !visNodes || !visEdges) return;
    selectedConceptNodeId = selectedId;

    const connectedNodes = new Set(visNetwork.getConnectedNodes(selectedId).map(String));
    connectedNodes.add(String(selectedId));

    const connectedEdges = new Set(visNetwork.getConnectedEdges(selectedId).map(String));

    const isDark = document.documentElement.classList.contains('dark');
    const accentSoft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || '#818cf8';

    visNodes.forEach((node) => {
        const nid = String(node.id);
        if (connectedNodes.has(nid)) {
            visNodes.update({
                id: node.id,
                borderWidth: nid === String(selectedId) ? 4 : 2.5,
                font: { color: node._origColor ? node._origColor.text : (isDark ? '#f8fafc' : '#0f172a') },
                color: {
                    background: node._origColor ? node._origColor.background : (isDark ? '#141c2c' : '#f8fafc'),
                    border: nid === String(selectedId) ? accentSoft : (node._origColor ? node._origColor.border : accentSoft),
                },
            });
        } else {
            visNodes.update({
                id: node.id,
                borderWidth: 1,
                font: { color: isDark ? '#475569' : '#94a3b8' },
                color: {
                    background: isDark ? 'rgba(20, 28, 44, 0.35)' : 'rgba(241, 245, 249, 0.4)',
                    border: isDark ? 'rgba(71, 85, 105, 0.25)' : 'rgba(203, 213, 225, 0.4)',
                },
            });
        }
    });

    visEdges.forEach((edge) => {
        const eid = String(edge.id);
        if (connectedEdges.has(eid)) {
            visEdges.update({
                id: edge.id,
                width: 3,
                color: { color: accentSoft, highlight: accentSoft },
            });
        } else {
            visEdges.update({
                id: edge.id,
                width: 1,
                color: { color: isDark ? 'rgba(71, 85, 105, 0.15)' : 'rgba(203, 213, 225, 0.25)' },
            });
        }
    });

    openConceptInspector(selectedId);
}

function resetNeighborhoodHighlight() {
    selectedConceptNodeId = null;
    closeConceptInspector();

    if (!visNodes || !visEdges) return;
    const isDark = document.documentElement.classList.contains('dark');

    visNodes.forEach((node) => {
        if (node._origColor) {
            visNodes.update({
                id: node.id,
                borderWidth: node._isCore ? 2.5 : 2,
                font: { color: node._origColor.text },
                color: {
                    background: node._origColor.background,
                    border: node._origColor.border,
                },
            });
        }
    });

    visEdges.forEach((edge) => {
        visEdges.update({
            id: edge.id,
            width: 1.75,
            color: { color: edge._origColor || (isDark ? '#475569' : '#94a3b8') },
        });
    });
}

function openConceptInspector(nodeId) {
    const hud = $('concept-inspector-hud');
    if (!hud) return;

    const node = (currentGraphRaw.nodes || []).find(n => String(n.id) === String(nodeId)) || { id: nodeId, label: nodeId };
    const titleEl = $('inspector-node-title');
    if (titleEl) titleEl.textContent = node.label || node.id;

    const relList = $('inspector-relationships-list');
    const relCount = $('inspector-rel-count');
    if (relList) relList.innerHTML = '';

    const edges = currentGraphRaw.edges || [];
    const connectedEdges = edges.filter(e => String(e.from) === String(nodeId) || String(e.to) === String(nodeId));

    if (relCount) relCount.textContent = String(connectedEdges.length);

    const neighborLabels = [];

    connectedEdges.forEach((e) => {
        const isOutgoing = String(e.from) === String(nodeId);
        const otherId = isOutgoing ? String(e.to) : String(e.from);
        const otherNode = (currentGraphRaw.nodes || []).find(n => String(n.id) === otherId) || { id: otherId, label: otherId };
        neighborLabels.push(otherNode.label || otherId);

        const relItem = document.createElement('button');
        relItem.className = 'relationship-chip flex items-center justify-between text-left w-full px-2 py-1 rounded-lg bg-raised/80 hover:bg-edge border border-edge text-[11px] text-slate-300 transition-colors';
        const arrow = isOutgoing ? '──▶' : '◀──';
        const relText = e.label || e.relation || 'relates to';
        relItem.innerHTML = `
            <span class="truncate font-medium text-white">${escapeHtml(otherNode.label || otherId)}</span>
            <span class="text-[10px] font-mono text-accent shrink-0 ml-1.5">${arrow} [${escapeHtml(relText)}]</span>
        `;
        relItem.onclick = () => {
            if (visNetwork) {
                visNetwork.selectNodes([otherId]);
                highlightNeighborhood(otherId);
                visNetwork.focus(otherId, { scale: 1.25, animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
            }
        };
        relList.appendChild(relItem);
    });

    if (connectedEdges.length === 0 && relList) {
        relList.innerHTML = '<span class="text-[11px] text-slate-500 italic">No direct connections</span>';
    }

    const askTutorBtn = $('inspector-ask-tutor-btn');
    if (askTutorBtn) {
        askTutorBtn.onclick = () => {
            const query = neighborLabels.length > 0
                ? `Explain the concept of "${node.label || node.id}" and how it connects to ${neighborLabels.slice(0, 3).join(', ')}.`
                : `Explain the concept of "${node.label || node.id}" clearly in simple terms.`;
            navigateToPage('tutor');
            const chatInput = $('chat-input');
            if (chatInput) {
                chatInput.value = query;
                const sendBtn = $('chat-send-btn');
                if (sendBtn) sendBtn.click();
            }
        };
    }

    const focusBtn = $('inspector-focus-btn');
    if (focusBtn) {
        focusBtn.onclick = () => {
            if (visNetwork) {
                visNetwork.focus(nodeId, { scale: 1.45, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
            }
        };
    }

    const speakBtn = $('inspector-speak-btn');
    if (speakBtn) {
        speakBtn.onclick = () => {
            const speechText = neighborLabels.length > 0
                ? `${node.label || node.id}. Related to: ${neighborLabels.slice(0, 4).join(', ')}.`
                : `${node.label || node.id}.`;
            speakCaption(speechText);
        };
    }

    const closeBtn = $('close-inspector-btn');
    if (closeBtn) {
        closeBtn.onclick = () => resetNeighborhoodHighlight();
    }

    hud.classList.remove('hidden');
}

function closeConceptInspector() {
    const hud = $('concept-inspector-hud');
    if (hud) hud.classList.add('hidden');
}

function initVisBoardControls() {
    const layoutBtn = $('toggle-layout-btn');
    const layoutLabel = $('layout-mode-label');
    if (layoutBtn) {
        layoutBtn.addEventListener('click', () => {
            currentLayoutMode = currentLayoutMode === 'network' ? 'hierarchical' : 'network';
            if (layoutLabel) {
                layoutLabel.textContent = currentLayoutMode === 'hierarchical' ? 'Flowchart' : 'Mind Map';
            }
            if (visNetwork) {
                visNetwork.setOptions(getVisNetworkOptions());
                setTimeout(() => {
                    visNetwork.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
                }, 100);
            }
            showToast(currentLayoutMode === 'hierarchical' ? '🌳 Switched to Flowchart tree view' : '🌐 Switched to Mind Map network view');
        });
    }

    const physicsBtn = $('toggle-physics-btn');
    const physicsLabel = $('physics-btn-label');
    const physicsIcon = $('physics-status-icon');
    if (physicsBtn) {
        physicsBtn.addEventListener('click', () => {
            isPhysicsEnabled = !isPhysicsEnabled;
            physicsBtn.classList.toggle('bg-accent/20', !isPhysicsEnabled);
            physicsBtn.classList.toggle('border-accent/50', !isPhysicsEnabled);
            if (physicsLabel) physicsLabel.textContent = isPhysicsEnabled ? 'Physics' : 'Frozen';
            if (physicsIcon) physicsIcon.textContent = isPhysicsEnabled ? '⚡' : '🔒';
            if (visNetwork) {
                visNetwork.setOptions({ physics: { enabled: isPhysicsEnabled } });
            }
            showToast(isPhysicsEnabled ? '⚡ Automatic physics forces enabled' : '🔒 Layout frozen — arrange nodes freely');
        });
    }

    const realignBtn = $('realign-graph-btn');
    if (realignBtn) {
        realignBtn.addEventListener('click', () => {
            if (visNetwork) {
                visNetwork.stabilize(100);
                visNetwork.fit({ animation: { duration: 450, easingFunction: 'easeInOutQuad' } });
                showToast('🎯 Visual concept board re-aligned & centered');
            }
        });
    }
}

function initVisNetwork() {
    const container = $('vis-network-container');
    if (!container || typeof vis === 'undefined' || !vis.Network) return;

    if (!visNodes) visNodes = new vis.DataSet([]);
    if (!visEdges) visEdges = new vis.DataSet([]);

    if (!visNetwork) {
        visNetwork = new vis.Network(container, { nodes: visNodes, edges: visEdges }, getVisNetworkOptions());

        visNetwork.on('click', function(params) {
            if (params.nodes && params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                highlightNeighborhood(nodeId);
            } else {
                resetNeighborhoodHighlight();
            }
        });

        visNetwork.on('doubleClick', function(params) {
            if (params.nodes && params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                visNetwork.focus(nodeId, { scale: 1.45, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
            }
        });

        visNetwork.on('zoom', function() {
            if (visNetwork) {
                const scale = visNetwork.getScale();
                zoomLevel = scale;
                if ($('zoom-label')) $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
                if ($('mobile-zoom-label')) $('mobile-zoom-label').textContent = `${Math.round(scale * 100)}%`;
            }
        });
    }
}

function parseMermaidSyntax(code) {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    if (!code || typeof code !== 'string') return { nodes, edges };

    const clean = code.replace(/^```(mermaid)?\s*/i, '').replace(/```$/, '');
    const lines = clean.split('\n');
    const edgePattern = /([a-zA-Z0-9_-]+)(?:\s*(?:\(\(|\[|\(|\{\{)(["']?)(.*?)\2(?:\)\)|\]|\)|\}\}))?\s*(?:-->|---|==>)\s*(?:\|([^|]+)\|\s*)?([a-zA-Z0-9_-]+)(?:\s*(?:\(\(|\[|\(|\{\{)(["']?)(.*?)\6(?:\)\)|\]|\)|\}\}))?/;
    const nodePattern = /([a-zA-Z0-9_-]+)\s*(?:\(\(|\[|\(|\{\{)(["']?)(.*?)\2(?:\)\)|\]|\)|\}\})/;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('flowchart') || line.startsWith('graph') || line.startsWith('subgraph') || line === 'end') continue;

        const edgeMatch = line.match(edgePattern);
        if (edgeMatch) {
            const srcId = edgeMatch[1];
            const srcLbl = (edgeMatch[3] || '').trim();
            const rel = (edgeMatch[4] || '').trim();
            const dstId = edgeMatch[5];
            const dstLbl = (edgeMatch[7] || '').trim();

            edges.push({
                id: `${srcId}_to_${dstId}_${edges.length}`,
                from: srcId,
                to: dstId,
                label: rel,
                relation: rel,
                arrows: 'to',
            });

            if (!nodeMap.has(srcId)) {
                nodeMap.set(srcId, { id: srcId, label: srcLbl || srcId, shape: 'box' });
            } else if (srcLbl) {
                nodeMap.get(srcId).label = srcLbl;
            }

            if (!nodeMap.has(dstId)) {
                nodeMap.set(dstId, { id: dstId, label: dstLbl || dstId, shape: 'box' });
            } else if (dstLbl) {
                nodeMap.get(dstId).label = dstLbl;
            }
        } else {
            const nodeMatch = line.match(nodePattern);
            if (nodeMatch) {
                const nid = nodeMatch[1];
                const lbl = (nodeMatch[3] || '').trim();
                if (!nodeMap.has(nid)) {
                    nodeMap.set(nid, { id: nid, label: lbl || nid, shape: 'box' });
                } else if (lbl) {
                    nodeMap.get(nid).label = lbl;
                }
            }
        }
    }
    return { nodes: Array.from(nodeMap.values()), edges };
}

function normalizeGraphData(graphData) {
    if (!graphData) return { nodes: [], edges: [] };
    if (typeof graphData === 'object' && graphData !== null) {
        if (Array.isArray(graphData.nodes) && graphData.nodes.length > 0) {
            return {
                nodes: graphData.nodes,
                edges: Array.isArray(graphData.edges) ? graphData.edges : [],
            };
        }
        if (typeof graphData.diagram_code === 'string' && graphData.diagram_code.trim()) {
            return normalizeGraphData(graphData.diagram_code);
        }
        return {
            nodes: Array.isArray(graphData.nodes) ? graphData.nodes : [],
            edges: Array.isArray(graphData.edges) ? graphData.edges : [],
        };
    }
    if (typeof graphData === 'string') {
        const trimmed = graphData.trim();
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                return normalizeGraphData(parsed);
            } catch (e) {
                console.warn('Failed to parse graphData as JSON:', e);
            }
        }
        return parseMermaidSyntax(trimmed);
    }
    return { nodes: [], edges: [] };
}

async function renderDiagram(graphData, recordHistory = true, customSummary = null, customTerms = null, customNotes = null, customQuiz = null, customFlashcards = null) {
    try {
        const { nodes, edges } = normalizeGraphData(graphData);
        if (nodes.length === 0) {
            const placeholder = $('diagram-empty-placeholder');
            if (placeholder) placeholder.classList.remove('hidden');
            closeConceptInspector();
            return false;
        }

        const placeholder = $('diagram-empty-placeholder');
        if (placeholder) placeholder.classList.add('hidden');

        currentGraphRaw = { nodes, edges };
        initVisNetwork();

        if (visNodes && visEdges) {
            const { formattedNodes, formattedEdges } = formatConceptNodesAndEdges(nodes, edges);

            const currentIds = new Set(formattedNodes.map(n => String(n.id)));
            const existingIds = visNodes.getIds();
            const toRemoveNodes = existingIds.filter(id => !currentIds.has(String(id)));
            if (toRemoveNodes.length > 0) visNodes.remove(toRemoveNodes);
            visNodes.update(formattedNodes);

            const currentEdgeIds = new Set(formattedEdges.map(e => String(e.id)));
            const existingEdgeIds = visEdges.getIds();
            const toRemoveEdges = existingEdgeIds.filter(id => !currentEdgeIds.has(String(id)));
            if (toRemoveEdges.length > 0) visEdges.remove(toRemoveEdges);
            visEdges.update(formattedEdges);

            if (selectedConceptNodeId && currentIds.has(String(selectedConceptNodeId))) {
                highlightNeighborhood(selectedConceptNodeId);
            } else {
                closeConceptInspector();
            }

            if (visNetwork) {
                visNetwork.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
            }
        }

        // Update Node Count HUD
        const nodeHud = $('diagram-node-hud');
        if (nodeHud) {
            nodeHud.textContent = `📊 ${nodes.length} Concepts • ${edges.length} Relationships`;
        }

        const snapshot = {
            id: ++graphSeq,
            diagram_code: JSON.stringify({ nodes, edges }, null, 2),
            graph_data: { nodes, edges },
            summary_bullets: customSummary || [],
            key_terms: customTerms || [],
            short_notes: customNotes || [],
            quiz: customQuiz || [],
            flashcards: customFlashcards || [],
            timestamp: new Date().toISOString(),
            timeString: stamp(),
        };

        if (recordHistory) {
            sessionDiagrams.push(snapshot);
            (customTerms || []).forEach((t) => allSessionKeyTerms.add(t));
            hasUnsavedSessionChanges = true;
            saveCurrentSessionToStorage();
        }

        const targetIndex = recordHistory ? sessionDiagrams.length - 1 : currentDiagramIndex;
        const liveFollow = $('live-follow-toggle');
        if (!liveFollow || liveFollow.checked || !recordHistory) {
            currentDiagramIndex = targetIndex;
            renderSummaryAndNotes(snapshot.summary_bullets, snapshot.short_notes, snapshot.key_terms);
            renderQuiz(snapshot.quiz);
            renderFlashcards(snapshot.flashcards);
            if ($('quiz-badge')) $('quiz-badge').textContent = String((snapshot.quiz || []).length);
            if ($('flashcard-badge')) $('flashcard-badge').textContent = String((snapshot.flashcards || []).length);
            if ($('nav-study-badge')) $('nav-study-badge').textContent = String(sessionDiagrams.length);
            updateTimelineControls();
        } else {
            updateTimelineControls();
        }

        clearError();
        return true;
    } catch (err) {
        console.error('Vis.js render error:', err);
        return false;
    }
}

function renderDiagramDirect(graphData, summaryBullets = [], keyTerms = []) {
    return renderDiagram(graphData, true, summaryBullets, keyTerms);
}

function applyLiveDiagramDelta(deltas, graphState, summaryBullets = [], keyTerms = []) {
    if (graphState) {
        return renderDiagram(graphState, true, summaryBullets, keyTerms);
    }
}

window.renderDiagram = renderDiagram;
window.renderDiagramDirect = renderDiagramDirect;
window.applyLiveDiagramDelta = applyLiveDiagramDelta;

async function displayDiagramSnapshot(index) {
    if (index < 0 || index >= sessionDiagrams.length) return;
    currentDiagramIndex = index;
    const snap = sessionDiagrams[index];

    const placeholder = $('diagram-empty-placeholder');
    const graphData = snap.graph_data || normalizeGraphData(snap.diagram_code);

    if (graphData.nodes && graphData.nodes.length > 0) {
        if (placeholder) placeholder.classList.add('hidden');
        currentGraphRaw = graphData;
        initVisNetwork();
        if (visNodes && visEdges) {
            const { formattedNodes, formattedEdges } = formatConceptNodesAndEdges(graphData.nodes, graphData.edges);

            const currentIds = new Set(formattedNodes.map(n => String(n.id)));
            const existingIds = visNodes.getIds();
            const toRemoveNodes = existingIds.filter(id => !currentIds.has(String(id)));
            if (toRemoveNodes.length > 0) visNodes.remove(toRemoveNodes);
            visNodes.update(formattedNodes);

            const currentEdgeIds = new Set(formattedEdges.map(e => String(e.id)));
            const existingEdgeIds = visEdges.getIds();
            const toRemoveEdges = existingEdgeIds.filter(id => !currentEdgeIds.has(String(id)));
            if (toRemoveEdges.length > 0) visEdges.remove(toRemoveEdges);
            visEdges.update(formattedEdges);

            closeConceptInspector();

            if (visNetwork) {
                visNetwork.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
            }
        }
        const nodeHud = $('diagram-node-hud');
        if (nodeHud) {
            nodeHud.textContent = `📊 ${graphData.nodes.length} Concepts • ${graphData.edges.length} Relationships`;
        }
    } else {
        if (placeholder) placeholder.classList.remove('hidden');
        closeConceptInspector();
        if (visNodes) visNodes.clear();
        if (visEdges) visEdges.clear();
    }

    const lastUp = $('last-update');
    if (lastUp) lastUp.textContent = `diagram ${snap.timeString}`;

    renderSummaryAndNotes(snap.summary_bullets, snap.short_notes, snap.key_terms);
    renderQuiz(snap.quiz);
    renderFlashcards(snap.flashcards);

    if ($('quiz-badge')) $('quiz-badge').textContent = String((snap.quiz || []).length);
    if ($('flashcard-badge')) $('flashcard-badge').textContent = String((snap.flashcards || []).length);
    if ($('nav-study-badge')) $('nav-study-badge').textContent = String(sessionDiagrams.length);

    updateTimelineControls();
}

function updateTimelineControls() {
    const count = sessionDiagrams.length;
    if ($('nav-study-badge')) $('nav-study-badge').textContent = String(count);

    const slider = $('diagram-slider');
    const prevBtn = $('prev-diagram-btn');
    const nextBtn = $('next-diagram-btn');
    const counter = $('diagram-counter');

    if (count === 0) {
        if (slider) { slider.disabled = true; slider.min = '1'; slider.max = '1'; slider.value = '1'; }
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (counter) counter.textContent = '0 / 0';
        return;
    }

    if (slider) {
        slider.disabled = false;
        slider.min = '1';
        slider.max = String(count);
        slider.value = String(currentDiagramIndex + 1);
    }
    if (prevBtn) prevBtn.disabled = currentDiagramIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentDiagramIndex >= count - 1;
    if (counter) counter.textContent = `${currentDiagramIndex + 1} / ${count}`;
}

function initTimelineControls() {
    const slider = $('diagram-slider');
    const prevBtn = $('prev-diagram-btn');
    const nextBtn = $('next-diagram-btn');
    const liveFollow = $('live-follow-toggle');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentDiagramIndex > 0) {
                if (liveFollow) liveFollow.checked = false;
                displayDiagramSnapshot(currentDiagramIndex - 1);
                showToast(`Viewing diagram ${currentDiagramIndex + 1} of ${sessionDiagrams.length}`);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentDiagramIndex < sessionDiagrams.length - 1) {
                const nextIdx = currentDiagramIndex + 1;
                displayDiagramSnapshot(nextIdx);
                if (nextIdx === sessionDiagrams.length - 1 && liveFollow) {
                    liveFollow.checked = true;
                }
                showToast(`Viewing diagram ${currentDiagramIndex + 1} of ${sessionDiagrams.length}`);
            }
        });
    }

    if (slider) {
        slider.addEventListener('input', () => {
            const val = parseInt(slider.value, 10);
            const targetIndex = val - 1;
            if (targetIndex >= 0 && targetIndex < sessionDiagrams.length) {
                if (targetIndex < sessionDiagrams.length - 1 && liveFollow) {
                    liveFollow.checked = false;
                }
                displayDiagramSnapshot(targetIndex);
            }
        });
    }

    if (liveFollow) {
        liveFollow.addEventListener('change', () => {
            if (liveFollow.checked && sessionDiagrams.length > 0) {
                displayDiagramSnapshot(sessionDiagrams.length - 1);
                showToast('Live diagram follow enabled');
            }
        });
    }

    window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (sessionDiagrams.length <= 1) return;

        if ((e.altKey && e.key === 'ArrowLeft') || e.key === '[') {
            e.preventDefault();
            if (currentDiagramIndex > 0) {
                if (liveFollow) liveFollow.checked = false;
                displayDiagramSnapshot(currentDiagramIndex - 1);
            }
        } else if ((e.altKey && e.key === 'ArrowRight') || e.key === ']') {
            e.preventDefault();
            if (currentDiagramIndex < sessionDiagrams.length - 1) {
                displayDiagramSnapshot(currentDiagramIndex + 1);
            }
        }
    });

    updateTimelineControls();
}

function renderSummaryAndNotes(bullets, notes, terms) {
    const sumList = $('summary-list');
    if (sumList) {
        sumList.innerHTML = (bullets && bullets.length)
            ? bullets.map((b) => `<li class="rise-in flex gap-2"><span class="text-accent font-mono mt-[1px]">›</span><span>${escapeHtml(b)}</span></li>`).join('')
            : '<li class="text-slate-500 italic">No summary points generated yet. Click "Generate Diagram" on the Classroom page to create one.</li>';
    }

    const nList = $('notes-list');
    if (nList) {
        nList.innerHTML = (notes && notes.length)
            ? notes.map((n) => `<li class="rise-in flex gap-2"><span class="text-accent-soft font-mono mt-[1px]">▪</span><span>${escapeHtml(n)}</span></li>`).join('')
            : '<li class="text-slate-500 italic">No study notes generated yet. Click "Generate Short Notes" above to create them on demand.</li>';
    }

    const tList = $('terms-list');
    if (tList) {
        tList.innerHTML = (terms && terms.length)
            ? terms.map((t) => `<span class="rise-in px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent text-xs font-mono">${escapeHtml(t)}</span>`).join('')
            : '<span class="text-slate-500 italic text-xs">No key terms recorded yet.</span>';
    }
}

// Lettered quiz prefixes like "A. " or "B) " — the only safe case for a
// short-prefix answer comparison.
const QUIZ_LETTERED_PREFIX = /^[a-f][.)]\s/i;

function renderQuiz(quizItems) {
    const container = $('quiz-questions-container');
    if (!container) return;

    if (!quizItems || !quizItems.length) {
        container.innerHTML = '<p class="text-xs text-slate-500 italic">No quiz generated yet. Click "Generate Quiz" above to create comprehension questions on demand.</p>';
        if ($('quiz-score-badge')) $('quiz-score-badge').textContent = 'Score: 0 / 0';
        return;
    }

    let correctCount = 0;
    const totalCount = quizItems.length;

    function updateScore() {
        if ($('quiz-score-badge')) $('quiz-score-badge').textContent = `Score: ${correctCount} / ${totalCount}`;
    }
    updateScore();

    container.innerHTML = quizItems.map((q, qIdx) => `
        <div class="bg-raised border border-edge rounded-xl p-4 space-y-3 rise-in" data-qidx="${qIdx}">
            <div class="text-xs md:text-sm font-semibold text-white flex items-start gap-2">
                <span class="text-accent font-mono">Q${qIdx + 1}.</span>
                <span>${escapeHtml(q.question)}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                ${(q.options || []).map((opt) => `
                    <button class="quiz-option text-left px-3.5 py-2.5 rounded-lg bg-ink text-xs text-slate-200"
                            data-qidx="${qIdx}" data-option="${escapeHtml(opt)}">
                        ${escapeHtml(opt)}
                    </button>
                `).join('')}
            </div>
            <div class="quiz-explanation hidden p-3 rounded-lg bg-ink border border-edge text-xs text-slate-300">
                <strong class="text-accent">Explanation:</strong> <span>${escapeHtml(q.explanation || 'Correct answer: ' + q.answer)}</span>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.quiz-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const card = btn.closest('[data-qidx]');
            if (!card || card.classList.contains('answered')) return;
            card.classList.add('answered');

            const qIdx = Number(btn.dataset.qidx);
            const selectedOpt = btn.dataset.option || '';
            const correctOpt = quizItems[qIdx]?.answer || '';

            // Full-text match, or lettered-prefix match only. A blind 2-char
            // prefix comparison marked wrong answers correct ("Ozone" vs "Oxygen").
            const isCorrect = selectedOpt.trim().toLowerCase() === correctOpt.trim().toLowerCase() ||
                (QUIZ_LETTERED_PREFIX.test(selectedOpt) && QUIZ_LETTERED_PREFIX.test(correctOpt) &&
                 selectedOpt.slice(0, 2).toLowerCase() === correctOpt.slice(0, 2).toLowerCase());

            if (isCorrect) {
                btn.classList.add('correct');
                correctCount++;
                showToast('🎉 Correct answer!');
            } else {
                btn.classList.add('wrong');
                card.querySelectorAll('.quiz-option').forEach((b) => {
                    const optText = b.dataset.option || '';
                    if (optText.trim().toLowerCase() === correctOpt.trim().toLowerCase() ||
                        (QUIZ_LETTERED_PREFIX.test(optText) && QUIZ_LETTERED_PREFIX.test(correctOpt) &&
                         optText.slice(0, 2).toLowerCase() === correctOpt.slice(0, 2).toLowerCase())) {
                        b.classList.add('correct');
                    }
                });
                showToast('❌ Incorrect answer');
            }

            const expBox = card.querySelector('.quiz-explanation');
            if (expBox) expBox.classList.remove('hidden');
            updateScore();
        });
    });

    const resetBtn = $('reset-quiz-btn');
    if (resetBtn) {
        resetBtn.onclick = () => renderQuiz(quizItems);
    }
}

function renderFlashcards(flashcards) {
    const grid = $('flashcards-grid');
    if (!grid) return;

    if (!flashcards || !flashcards.length) {
        grid.innerHTML = '<p class="text-xs text-slate-500 italic col-span-full">No flashcards generated yet. Click "Generate Flashcards" above to create concept revision cards on demand.</p>';
        return;
    }

    grid.innerHTML = flashcards.map((fc, idx) => `
        <div class="flashcard rise-in" data-card-idx="${idx}">
            <div class="flashcard-inner">
                <div class="flashcard-front bg-raised border border-edge text-slate-100 shadow-md">
                    <span class="text-[10px] font-mono uppercase tracking-wider text-accent mb-1">Concept #${idx + 1}</span>
                    <h4 class="text-xs md:text-sm font-semibold text-white px-2 leading-snug">${escapeHtml(fc.front)}</h4>
                    <span class="text-[10px] text-slate-400 font-mono mt-2">↻ Click to flip</span>
                </div>
                <div class="flashcard-back bg-panel border border-accent/40 text-slate-200 shadow-lg">
                    <span class="text-[10px] font-mono text-accent-soft mb-1">Explanation</span>
                    <p class="text-xs text-slate-300 px-2 leading-relaxed">${escapeHtml(fc.back)}</p>
                    <span class="text-[10px] text-slate-500 font-mono mt-2">↻ Click to flip back</span>
                </div>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.flashcard').forEach((card) => {
        card.addEventListener('click', () => card.classList.toggle('flipped'));
    });
}

function initStudyTabs() {
    const tabNotesBtn = $('tab-study-notes-btn');
    const tabQuizBtn = $('tab-study-quiz-btn');
    const tabFlashcardsBtn = $('tab-study-flashcards-btn');
    const notesPane = $('study-notes-pane');
    const quizPane = $('study-quiz-pane');
    const flashcardsPane = $('study-flashcards-pane');

    if (!tabNotesBtn || !tabQuizBtn || !tabFlashcardsBtn) return;

    function resetTabs() {
        tabNotesBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1.5';
        tabQuizBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1.5';
        tabFlashcardsBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1.5';
        if (notesPane) { notesPane.classList.add('hidden'); notesPane.classList.remove('grid'); }
        if (quizPane) { quizPane.classList.add('hidden'); quizPane.classList.remove('flex'); }
        if (flashcardsPane) { flashcardsPane.classList.add('hidden'); flashcardsPane.classList.remove('flex'); }
    }

    tabNotesBtn.addEventListener('click', () => {
        resetTabs();
        tabNotesBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-raised text-white transition-all shadow-sm flex items-center gap-1.5';
        if (notesPane) { notesPane.classList.remove('hidden'); notesPane.classList.add('grid'); }
    });

    tabQuizBtn.addEventListener('click', () => {
        resetTabs();
        tabQuizBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-raised text-white transition-all shadow-sm flex items-center gap-1.5';
        if (quizPane) { quizPane.classList.remove('hidden'); quizPane.classList.add('flex'); }
    });

    tabFlashcardsBtn.addEventListener('click', () => {
        resetTabs();
        tabFlashcardsBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-raised text-white transition-all shadow-sm flex items-center gap-1.5';
        if (flashcardsPane) { flashcardsPane.classList.remove('hidden'); flashcardsPane.classList.add('flex'); }
    });

    const copyBtn = $('copy-study-pack-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
                showToast('No study notes available to copy');
                return;
            }
            const snap = sessionDiagrams[currentDiagramIndex];
            const text = `Classroom Study Pack (${snap.timeString})\n\nSummary:\n${snap.summary_bullets.map((b) => `- ${b}`).join('\n')}\n\nNotes:\n${(snap.short_notes || []).map((n) => `- ${n}`).join('\n')}\n\nKey Terms: ${snap.key_terms.join(', ')}`;
            copyToClipboard(text, '📋 Study notes copied!');
        });
    }
}

// ------------------------------------------------------------------
// Zoom & Fullscreen Controls & Downloads
// ------------------------------------------------------------------
function setZoom(factor) {
    zoomLevel = Math.max(0.4, Math.min(2.5, factor));
    if (visNetwork) {
        visNetwork.moveTo({
            scale: zoomLevel,
            animation: { duration: 250, easingFunction: 'easeInOutQuad' },
        });
    }
    const label = $('zoom-label');
    if (label) label.textContent = `${Math.round(zoomLevel * 100)}%`;
    const mobileLabel = $('mobile-zoom-label');
    if (mobileLabel) mobileLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function adjustZoom(delta) {
    setZoom(zoomLevel + delta);
}

function resetZoom() {
    zoomLevel = 1.0;
    if (visNetwork) {
        visNetwork.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
    }
    const label = $('zoom-label');
    if (label) label.textContent = '100%';
    const mobileLabel = $('mobile-zoom-label');
    if (mobileLabel) mobileLabel.textContent = '100%';
}

function downloadDiagramPng() {
    const canvas = document.querySelector('#vis-network-container canvas');
    if (!canvas) {
        showToast('No diagram to download yet');
        return;
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `lecture_diagram_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('💾 Diagram PNG downloaded!');
}

function downloadDiagramSvg() {
    downloadDiagramPng();
}

function initZoomAndFullscreen() {
    const zoomInBtn = $('zoom-in-btn');
    const zoomOutBtn = $('zoom-out-btn');
    const zoomResetBtn = $('zoom-reset-btn');
    const mobileZoomIn = $('mobile-zoom-in');
    const mobileZoomOut = $('mobile-zoom-out');
    const mobileZoomFit = $('mobile-zoom-fit');
    const copyCodeBtn = $('copy-diagram-btn');
    const dlSvgBtn = $('download-svg-btn');
    const dlPngBtn = $('download-png-btn');
    const fsBtn = $('diagram-fullscreen-btn');
    const focusBtn = $('toggle-focus-btn');
    const fsModal = $('fullscreen-modal');
    const closeFs = $('close-fullscreen-btn');

    if (focusBtn) {
        let isFocused = false;
        focusBtn.addEventListener('click', () => {
            isFocused = !isFocused;
            const captionCol = $('caption-column');
            const visualCol = $('visual-column');
            if (captionCol && visualCol) {
                if (isFocused) {
                    captionCol.classList.add('hidden');
                    visualCol.classList.remove('lg:col-span-7');
                    visualCol.classList.add('lg:col-span-12');
                    showToast('🔍 Full Whiteboard Focus Mode enabled');
                } else {
                    captionCol.classList.remove('hidden');
                    visualCol.classList.remove('lg:col-span-12');
                    visualCol.classList.add('lg:col-span-7');
                    showToast('Split Classroom View restored');
                }
            }
        });
    }

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => adjustZoom(0.15));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => adjustZoom(-0.15));
    if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => resetZoom());

    // Mobile on-canvas zoom buttons
    if (mobileZoomIn) mobileZoomIn.addEventListener('click', () => adjustZoom(0.15));
    if (mobileZoomOut) mobileZoomOut.addEventListener('click', () => adjustZoom(-0.15));
    if (mobileZoomFit) mobileZoomFit.addEventListener('click', () => resetZoom());

    // Multi-touch pinch-to-zoom, touch pan, and double-tap on diagram canvas
    const diagContainer = $('diagram-container');
    if (diagContainer) {
        let initialPinchDistance = null;
        let initialZoom = zoomLevel;
        let lastTapTime = 0;
        let isTouchPanning = false;
        let touchStartX = 0, touchStartY = 0;
        let scrollStartLeft = 0, scrollStartTop = 0;

        diagContainer.addEventListener('touchstart', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;

            if (e.touches.length === 2) {
                // Two-finger pinch start
                isTouchPanning = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                initialPinchDistance = Math.hypot(dx, dy);
                initialZoom = zoomLevel;
            } else if (e.touches.length === 1) {
                // Double tap check
                const now = Date.now();
                if (now - lastTapTime < 300) {
                    setZoom(zoomLevel > 1.1 ? 1.0 : 1.5);
                    lastTapTime = 0;
                    return;
                }
                lastTapTime = now;

                // Single finger pan ONLY when significantly zoomed in AND diagram overflows container
                const hasScrollOverflow = (diagContainer.scrollWidth > diagContainer.clientWidth + 10) ||
                                          (diagContainer.scrollHeight > diagContainer.clientHeight + 10);
                if (zoomLevel > 1.25 && hasScrollOverflow) {
                    isTouchPanning = true;
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    scrollStartLeft = diagContainer.scrollLeft;
                    scrollStartTop = diagContainer.scrollTop;
                } else {
                    isTouchPanning = false;
                }
            }
        }, { passive: true });

        diagContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && initialPinchDistance) {
                // Pinch zoom active
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const currentDistance = Math.hypot(dx, dy);
                if (initialPinchDistance > 0) {
                    const scale = currentDistance / initialPinchDistance;
                    setZoom(initialZoom * scale);
                }
            } else if (e.touches.length === 1 && isTouchPanning) {
                // Single finger pan active only if moving significantly
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                if (Math.hypot(dx, dy) > 8) {
                    e.preventDefault();
                    diagContainer.scrollLeft = scrollStartLeft - dx;
                    diagContainer.scrollTop = scrollStartTop - dy;
                }
            }
        }, { passive: false });

        diagContainer.addEventListener('touchend', () => {
            initialPinchDistance = null;
            isTouchPanning = false;
        }, { passive: true });
    }

    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', () => {
            if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
                copyToClipboard(sessionDiagrams[currentDiagramIndex].diagram_code, '📋 Graph JSON data copied!');
            } else {
                showToast('No diagram to copy yet');
            }
        });
    }

    if (dlSvgBtn) dlSvgBtn.addEventListener('click', downloadDiagramSvg);
    if (dlPngBtn) dlPngBtn.addEventListener('click', downloadDiagramPng);

    if (fsBtn && fsModal) {
        let fsNetwork = null;
        fsBtn.addEventListener('click', () => {
            const fsContent = $('fullscreen-diagram-body');
            const snap = sessionDiagrams[currentDiagramIndex];
            const graphData = snap?.graph_data || normalizeGraphData(snap?.diagram_code);
            if (fsContent && graphData.nodes && graphData.nodes.length > 0) {
                fsContent.innerHTML = '<div id="fs-network-canvas" style="width:100%;height:100%;min-height:500px;"></div>';
                fsModal.classList.remove('hidden');
                setTimeout(() => {
                    const fsContainer = $('fs-network-canvas');
                    if (fsContainer) {
                        const fsNodes = new vis.DataSet(graphData.nodes.map(n => ({
                            id: String(n.id),
                            label: n.label || String(n.id),
                            shape: n.shape || 'box',
                        })));
                        const fsEdges = new vis.DataSet(graphData.edges.map(e => ({
                            from: String(e.from),
                            to: String(e.to),
                            label: e.label || e.relation || '',
                            arrows: 'to',
                        })));
                        fsNetwork = new vis.Network(fsContainer, { nodes: fsNodes, edges: fsEdges }, getVisNetworkOptions());
                        fsNetwork.fit();
                    }
                }, 50);
            } else {
                showToast('No diagram to expand');
            }
        });
    }

    if (closeFs && fsModal) {
        closeFs.addEventListener('click', () => fsModal.classList.add('hidden'));
    }
}

// ------------------------------------------------------------------
// Mobile Classroom Mode Switcher (Split / Captions / Whiteboard)
// ------------------------------------------------------------------
function initClassroomMobileSwitcher() {
    const splitBtn = $('mobile-mode-split');
    const captionsBtn = $('mobile-mode-captions');
    const boardBtn = $('mobile-mode-board');
    const classroom = $('view-classroom');

    if (!splitBtn || !captionsBtn || !boardBtn || !classroom) return;

    function setClassroomMode(mode) {
        [splitBtn, captionsBtn, boardBtn].forEach((btn) => {
            btn.classList.remove('active', 'bg-raised', 'text-white');
            btn.classList.add('text-slate-400');
        });

        classroom.classList.remove('mobile-mode-captions', 'mobile-mode-board');

        if (mode === 'captions') {
            classroom.classList.add('mobile-mode-captions');
            captionsBtn.classList.add('active', 'bg-raised', 'text-white');
            captionsBtn.classList.remove('text-slate-400');
            showToast('🎙️ Live Captions Focus Mode');
        } else if (mode === 'board') {
            classroom.classList.add('mobile-mode-board');
            boardBtn.classList.add('active', 'bg-raised', 'text-white');
            boardBtn.classList.remove('text-slate-400');
            showToast('📐 Whiteboard Focus Mode');
        } else {
            splitBtn.classList.add('active', 'bg-raised', 'text-white');
            splitBtn.classList.remove('text-slate-400');
            showToast('⊞ Split Classroom Mode');
        }
    }

    splitBtn.addEventListener('click', () => setClassroomMode('split'));
    captionsBtn.addEventListener('click', () => setClassroomMode('captions'));
    boardBtn.addEventListener('click', () => setClassroomMode('board'));
}

function initLiveSpeechRecognition() {
    const micLang = $('mic-lang-select');
    const startBtn = $('start-class-btn');
    const micWarning = $('mic-warning');

    if (startBtn) {
        startBtn.onclick = (e) => {
            if (e) e.preventDefault();
            isListening ? stopListening() : startListening();
        };
    }

    if (!SpeechRecognition) {
        if (micWarning) micWarning.classList.remove('hidden');
        console.warn('SpeechRecognition API not available in this browser; fallback audio modes active.');
        return;
    }

    try {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = micLang ? micLang.value : 'en-US';

        recognition.onresult = (event) => {
            let interim = '';
            let finalChunk = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                if (!res || !res[0]) continue;
                const text = res[0].transcript || '';
                if (res.isFinal) {
                    const trimmed = text.trim();
                    if (trimmed.length > 0) {
                        // When Groq Whisper is active, skip appending Web Speech
                        // finals to the buffer — Groq provides far more accurate
                        // Urdu/English text and avoids duplicate accumulation.
                        if (!groqIsActive) {
                            if (interimBuffer.length > 0 && !interimBuffer.endsWith(' ') && !interimBuffer.endsWith('\n')) {
                                interimBuffer += ' ';
                            }
                            interimBuffer += trimmed + ' ';
                        }
                        finalChunk += (finalChunk ? ' ' : '') + trimmed;
                    }
                } else {
                    interim += text;
                }
            }
            renderCaption(interim);

            if (finalChunk.trim()) {
                sendWsTranscriptChunk(finalChunk.trim(), true, true);
            } else if (interim.trim()) {
                sendWsTranscriptChunk(interim.trim(), false, false);
            }

            if (!wsConnected) {
                scheduleAutoDiagramDebounced();
            }
        };

        recognition.onerror = (event) => {
            if (event.error === 'no-speech' || event.error === 'aborted') {
                return;
            }
            console.warn('Speech recognition warning:', event.error);
            if (event.error === 'not-allowed') {
                setStatus('mic blocked', 'bg-amber-950 text-amber-300 border-amber-800');
                showToast('🎙️ Microphone access blocked. You can still use Prompt Chips & Expression Board!', true);
            }
        };

        recognition.onend = () => {
            if (isListening) {
                try {
                    recognition.start();
                } catch (e) {
                    setTimeout(() => {
                        if (isListening) {
                            try { recognition.start(); } catch (err) {}
                        }
                    }, 100);
                }
            }
        };

        if (micLang) {
            micLang.addEventListener('change', () => {
                recognition.lang = micLang.value;
                const langLabel = micLang.options[micLang.selectedIndex].text;

                // Start/stop Groq Whisper when switching languages mid-session
                if (isListening) {
                    if (micLang.value === 'ur-PK') {
                        startGroqRecorder();
                        showToast(`🎙️ ${langLabel} — Groq Whisper STT ${groqIsActive ? 'active' : 'unavailable'}`);
                    } else {
                        stopGroqRecorder();
                        showToast(`🎙️ Microphone set to ${langLabel}`);
                    }
                    try {
                        recognition.stop();
                        setTimeout(() => {
                            try { if (isListening) recognition.start(); } catch (e) {}
                        }, 150);
                    } catch (e) {}
                } else {
                    showToast(`🎙️ Microphone set to ${langLabel}`);
                }
            });
        }
    } catch (e) {
        console.warn('SpeechRecognition setup error:', e);
    }
}

// ------------------------------------------------------------------
// Groq Whisper STT Pipeline (Accurate Urdu Speech-to-Text, Free API)
// ------------------------------------------------------------------
// Captures mic audio via MediaRecorder, sends 5-sec chunks to the backend
// /api/speech-to-text endpoint (Groq whisper-large-v3-turbo).
// Uses a staggered dual-recorder pattern: two MediaRecorders alternate so
// there is always one actively capturing. Each stop() produces a complete,
// valid audio container (proper headers/footer) that Groq can decode.
// Results replace the caption buffer for pixel-perfect Urdu transcription
// while Web Speech API continues providing real-time interim feedback.

function _getAudioMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
    ];
    for (const mime of candidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';  // let browser pick default
}

/**
 * Map a MIME type to the Content-Type header and filename that Groq expects.
 */
function _getGroqAudioMeta(mimeType) {
    if (!mimeType) return { contentType: 'audio/webm', filename: 'audio.webm' };
    if (mimeType.includes('ogg'))  return { contentType: 'audio/ogg',  filename: 'audio.ogg' };
    if (mimeType.includes('mp4'))  return { contentType: 'audio/mp4',  filename: 'audio.mp4' };
    if (mimeType.includes('wav'))  return { contentType: 'audio/wav',  filename: 'audio.wav' };
    return { contentType: 'audio/webm', filename: 'audio.webm' };
}

async function startGroqRecorder() {
    if (!window.MediaRecorder) {
        console.warn('[Groq STT] MediaRecorder not available');
        return;
    }
    try {
        groqMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                noiseSuppression: true,
                echoCancellation: true,
                autoGainControl: true,
            },
        });

        const mimeType = _getAudioMimeType();
        const recOpts = { mimeType: mimeType || undefined };
        const { contentType, filename } = _getGroqAudioMeta(mimeType);

        groqIsActive = true;
        groqCumulativeText = '';

        // Send a finished chunk to Groq and return the transcribed text.
        async function _sendChunk(blob) {
            if (!blob || blob.size < 2000 || !groqIsActive) return;   // skip silence / tiny blobs / stopped
            try {
                const resp = await fetch(`${API_BASE}/api/speech-to-text`, {
                    method: 'POST',
                    headers: { 'Content-Type': contentType },
                    body: blob,
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                    if (resp.status === 429) return;   // free-tier throttle — skip silently
                    console.warn('[Groq STT]', resp.status, err.detail || err);
                    return;
                }
                const result = await resp.json();
                const text = (result.text || '').trim();
                if (text) _integrateGroqResult(text);
            } catch (err) {
                console.warn('[Groq STT] fetch error:', err.message);
            }
        }

        // Create a fresh MediaRecorder that records for `durationMs` then stops.
        // On stop, the blob is sent and a replacement recorder is spawned so
        // there is never a gap in coverage.
        function _spawnRecorder(startDelay) {
            return new Promise((resolve) => {
                setTimeout(() => {
                    if (!groqIsActive || !groqMicStream) { resolve(null); return; }
                    let rec;
                    try {
                        rec = new MediaRecorder(groqMicStream, recOpts);
                    } catch (e) {
                        console.warn('[Groq STT] MediaRecorder create error:', e);
                        resolve(null);
                        return;
                    }

                    rec.ondataavailable = async (ev) => {
                        if (!groqIsActive) return;
                        await _sendChunk(ev.data);
                        // If we are still active, spawn the next recorder
                        if (groqIsActive) {
                            _spawnRecorder(0);
                        }
                    };

                    rec.onerror = (e) => {
                        console.warn('[Groq STT] MediaRecorder error:', e.error || e);
                    };

                    // When this recorder is replaced (not the active one), ignore
                    rec.onstop = () => {
                        // ondataavailable already fired before onstop, so
                        // the next recorder was already spawned there.
                    };

                    try {
                        rec.start();
                        // Schedule an auto-stop after GROQ_CHUNK_INTERVAL_MS
                        // as a safety net in case ondataavailable doesn't fire.
                        const stopTimer = setTimeout(() => {
                            if (rec.state === 'recording') {
                                try { rec.stop(); } catch (e) {}
                            }
                        }, GROQ_CHUNK_INTERVAL_MS);

                        // Store reference for cleanup
                        if (!groqRecorder) groqRecorder = rec;
                        else if (groqRecorder !== rec) {
                            // Replace the old reference
                            groqRecorder = rec;
                        }
                        // Keep a list of active timers for cleanup
                        if (!window._groqStopTimers) window._groqStopTimers = [];
                        window._groqStopTimers.push(stopTimer);

                        resolve(rec);
                    } catch (e) {
                        console.warn('[Groq STT] recorder start error:', e);
                        resolve(null);
                    }
                }, startDelay);
            });
        }

        // Staggered dual-recorder: R1 starts immediately, R2 starts 2.5 s later.
        // Each records for 5 s then stops → valid container. The stagger ensures
        // one recorder is always active, so no audio is lost.
        window._groqStopTimers = [];
        _spawnRecorder(0);                                // R1: t=0 → stops at t=5s
        _spawnRecorder(GROQ_CHUNK_INTERVAL_MS / 2);      // R2: t=2.5s → stops at t=7.5s

        console.log('[Groq STT] Staggered recorders started (5-sec chunks, ~12 RPM)');
    } catch (err) {
        console.warn('[Groq STT] Failed to start:', err.message);
        groqIsActive = false;
    }
}

function stopGroqRecorder() {
    groqIsActive = false;

    // Clear all pending stop timers
    if (window._groqStopTimers) {
        window._groqStopTimers.forEach((t) => clearTimeout(t));
        window._groqStopTimers = [];
    }

    // Stop the current recorder(s)
    if (groqRecorder && groqRecorder.state !== 'inactive') {
        try { groqRecorder.stop(); } catch (e) {}
    }
    groqRecorder = null;

    // Release the mic stream
    if (groqMicStream) {
        groqMicStream.getTracks().forEach((t) => t.stop());
        groqMicStream = null;
    }
    groqCumulativeText = '';
    console.log('[Groq STT] Recorder stopped');
}

/**
 * Integrate a Groq Whisper transcription into the caption display.
 * Uses suffix-overlap deduplication to handle audio overlap between
 * consecutive 5-sec chunks (staggered by 2.5 s → ~2.5 s overlap).
 */
function _integrateGroqResult(newText) {
    // Guard: if the recorder was stopped, groqCumulativeText is already
    // cleared — integrating now would overwrite the full transcription
    // with just the last in-flight chunk (async race condition).
    if (!groqIsActive) return;

    if (!groqCumulativeText) {
        groqCumulativeText = newText;
    } else {
        // Detect overlap: check if the tail of cumulative text matches
        // the head of the new transcription (up to 150 chars).
        const maxOverlap = Math.min(150, groqCumulativeText.length, newText.length);
        let overlap = 0;
        for (let n = Math.max(5, maxOverlap); n >= 5; n--) {
            const tail = groqCumulativeText.slice(-n);
            if (newText.indexOf(tail) >= 0 && newText.indexOf(tail) <= 15) {
                overlap = n;
                break;
            }
        }
        if (overlap > 0) {
            const novelPart = newText.slice(newText.indexOf(groqCumulativeText.slice(-overlap)) + overlap);
            if (novelPart.trim()) {
                groqCumulativeText += (groqCumulativeText.endsWith(' ') ? '' : ' ') + novelPart.trim();
            }
        } else {
            groqCumulativeText += (groqCumulativeText.endsWith(' ') ? '' : ' ') + newText;
        }
    }

    if (groqCumulativeText.length > MAX_TRANSCRIPT_CHARS) {
        groqCumulativeText = groqCumulativeText.slice(-MAX_TRANSCRIPT_CHARS);
    }

    interimBuffer = groqCumulativeText;
    sendWsTranscriptChunk(newText, true, false);
    renderCaption('', true);

    if (!wsConnected) {
        scheduleAutoDiagramDebounced();
    }
}

function renderCaption(interimText, markDirty = true) {
    const finalSpan = $('caption-final');
    const interimSpan = $('caption-interim');
    const emptyP = $('caption-empty');
    const body = $('caption-body');

    const cleanFinal = interimBuffer;
    const cleanInterim = interimText || '';

    if (finalSpan) finalSpan.textContent = cleanFinal;
    if (interimSpan) {
        const needsSpace = cleanFinal.length > 0 && !cleanFinal.endsWith(' ') && cleanInterim.length > 0 && !cleanInterim.startsWith(' ');
        interimSpan.textContent = (needsSpace ? ' ' : '') + cleanInterim;
    }
    if (emptyP) emptyP.classList.toggle('hidden', (cleanFinal + cleanInterim).trim().length > 0);
    if (body) body.scrollTop = body.scrollHeight;

    if (markDirty && (cleanFinal + cleanInterim).trim().length > 0) {
        hasUnsavedSessionChanges = true;
    }
    saveCurrentSessionToStorage();
}

// ------------------------------------------------------------------
// Auto-Diagram Generation Engine (Real-Time from Captions)
// ------------------------------------------------------------------
function checkAndTriggerAutoDiagram(force = false) {
    if (!isListening && !force) return;
    const current = getCurrentLectureTranscript();
    if (current.length < 15) return;

    const diff = current.length - lastAutoDiagramTranscript.length;
    if (force || diff >= AUTO_DIAGRAM_MIN_NEW_CHARS || (lastAutoDiagramTranscript === '' && current.length >= 15)) {
        triggerAutoDiagram();
    }
}

function scheduleAutoDiagramDebounced() {
    if (!isListening) return;
    if (autoDiagramTimer) clearTimeout(autoDiagramTimer);
    autoDiagramTimer = setTimeout(() => {
        checkAndTriggerAutoDiagram();
    }, AUTO_DIAGRAM_DEBOUNCE_MS);
}

function triggerAutoDiagram() {
    const raw = getCurrentLectureTranscript();
    if (raw.length < 15) return;
    if (raw === lastAutoDiagramTranscript) return;

    lastAutoDiagramTranscript = raw;
    lastAutoDiagramAt = Date.now();
    const chunk = raw.slice(-MAX_TRANSCRIPT_CHARS);
    enqueueApiTask('diagram', chunk);
}

function resetClassroomForNewClass() {
    // 0. Auto-save previous class session if it had content
    autoSaveSessionOnClassEnd('Previous lecture ended');

    // 1. Reset state variables
    interimBuffer = '';
    sessionDiagrams = [];
    currentDiagramIndex = -1;
    allSessionKeyTerms.clear();
    spokenHistory = [];
    sessionStartTime = new Date();
    lastAutoDiagramTranscript = '';
    lastAutoDiagramAt = 0;
    hasUnsavedSessionChanges = false;

    // Reset WebSocket server session graph state
    sendWsMessage({ type: 'reset_session' });

    // 2. Clear captions UI
    const finalSpan = $('caption-final');
    const interimSpan = $('caption-interim');
    const emptyP = $('caption-empty');
    if (finalSpan) finalSpan.textContent = '';
    if (interimSpan) interimSpan.textContent = '';
    if (emptyP) emptyP.classList.remove('hidden');

    // 3. Clear translation UI
    const transTarget = $('translated-text-target');
    const transEmpty = $('translated-empty');
    const transActions = $('translated-actions');
    if (transTarget) transTarget.textContent = '';
    if (transEmpty) transEmpty.classList.remove('hidden');
    if (transActions) transActions.classList.add('hidden');

    // 4. Clear Diagram UI
    if (visNodes) visNodes.clear();
    if (visEdges) visEdges.clear();
    const placeholder = $('diagram-empty-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    const lastUp = $('last-update');
    if (lastUp) lastUp.textContent = 'auto-updates from speech';
    updateTimelineControls();

    // 5. Clear Study Hub (Notes, Summary, Terms, Quiz, Flashcards)
    renderSummaryAndNotes([], [], []);
    renderQuiz([]);
    renderFlashcards([]);
    if ($('quiz-badge')) $('quiz-badge').textContent = '0';
    if ($('flashcard-badge')) $('flashcard-badge').textContent = '0';
    if ($('nav-study-badge')) $('nav-study-badge').textContent = '0';

    // 6. Clear Expression Board Spoken Log
    renderSpokenLog();

    // 7. Update Dashboard Stats & clean last session
    refreshStorageDashboard();
    saveCurrentSessionToStorage();
}

function startListening() {
    resetClassroomForNewClass();
    isListening = true;

    const startBtn = $('start-class-btn');
    if (startBtn) {
        startBtn.classList.replace('bg-accent', 'bg-red-600');
        const label = $('start-btn-text') || startBtn.querySelector('span:last-child');
        if (label) label.textContent = 'Stop Class';
        else startBtn.textContent = 'Stop Class';
    }

    const dot = $('caption-dot');
    if (dot) {
        dot.classList.replace('bg-slate-600', 'bg-emerald-400');
        dot.classList.add('animate-pulse');
    }

    const meter = $('audio-meter');
    if (meter) meter.classList.replace('hidden', 'flex');

    if (autoDiagramInterval) clearInterval(autoDiagramInterval);
    autoDiagramInterval = setInterval(() => checkAndTriggerAutoDiagram(), AUTO_DIAGRAM_INTERVAL_MS);

    setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');

    let speechStarted = false;
    if (recognition) {
        try {
            recognition.start();
            speechStarted = true;
        } catch (e) {
            console.warn('Recognition start exception:', e);
        }
    }

    const micLang = $('mic-lang-select');
    if (micLang && micLang.value === 'ur-PK') {
        startGroqRecorder();
        showToast('🎙️ Urdu class started! (Groq Whisper STT active)');
    } else if (speechStarted) {
        showToast('🎙️ Live lecture started! Transcribing speech into Vis.js diagrams...');
    } else {
        showToast('🎙️ Class session started! Live transcript active (speak, click Prompt chips, or use Expression Board).');
    }
}

function stopListening() {
    isListening = false;
    if (recognition) {
        try { recognition.stop(); } catch (e) {}
    }

    // Stop Groq Whisper recorder
    stopGroqRecorder();

    if (autoDiagramInterval) {
        clearInterval(autoDiagramInterval);
        autoDiagramInterval = null;
    }
    if (autoDiagramTimer) {
        clearTimeout(autoDiagramTimer);
        autoDiagramTimer = null;
    }

    const startBtn = $('start-class-btn');
    if (startBtn) {
        startBtn.classList.replace('bg-red-600', 'bg-accent');
        const label = $('start-btn-text') || startBtn.querySelector('span:last-child');
        if (label) label.textContent = 'Start Class';
        else startBtn.textContent = 'Start Class';
    }

    const meter = $('audio-meter');
    if (meter) meter.classList.replace('flex', 'hidden');

    const dot = $('caption-dot');
    if (dot) {
        dot.classList.remove('animate-pulse');
        dot.classList.replace('bg-emerald-400', 'bg-slate-600');
    }

    checkAndTriggerAutoDiagram(true);
    setStatus('idle', 'bg-raised text-slate-400 border-edge');

    // Automatically archive the ended lecture to storage!
    autoSaveSessionOnClassEnd('Lecture ended');
}

function getCurrentLectureTranscript() {
    return (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
}

// ------------------------------------------------------------------
// On-Command Diagram & Study Generators (Separate On-Demand Triggers)
// ------------------------------------------------------------------
function initOnCommandGenerator() {
    const manualBtn = $('manual-generate-btn');
    if (!manualBtn) return;

    manualBtn.addEventListener('click', () => {
        if (isGeneratingDiagram) {
            showToast('⏳ Visual generation is already in progress...');
            return;
        }

        const raw = getCurrentLectureTranscript();
        if (raw.length < 3) {
            showToast('🎙️ Please start class and speak some lecture content first!');
            return;
        }

        const chunk = raw.slice(-MAX_TRANSCRIPT_CHARS);
        lastAutoDiagramTranscript = raw;
        showToast('⚡ Refreshing diagram from speech...');
        enqueueApiTask('diagram', chunk);
    });
}

function initStudyGenerators() {
    const notesBtn = $('generate-notes-btn');
    if (notesBtn) {
        notesBtn.addEventListener('click', () => {
            if (isGeneratingNotes) {
                showToast('⏳ Notes generation already in progress...');
                return;
            }
            const chunk = getCurrentLectureTranscript();
            if (chunk.length < 3) {
                showToast('🎙️ Please start class and speak some lecture content first!');
                return;
            }
            showToast('⚡ Generating high-yield study notes...');
            enqueueApiTask('notes', chunk.slice(-MAX_TRANSCRIPT_CHARS));
        });
    }

    const quizBtn = $('generate-quiz-btn');
    if (quizBtn) {
        quizBtn.addEventListener('click', () => {
            if (isGeneratingQuiz) {
                showToast('⏳ Quiz generation already in progress...');
                return;
            }
            const chunk = getCurrentLectureTranscript();
            if (chunk.length < 3) {
                showToast('🎙️ Please start class and speak some lecture content first!');
                return;
            }
            showToast('⚡ Generating interactive comprehension quiz...');
            enqueueApiTask('quiz', chunk.slice(-MAX_TRANSCRIPT_CHARS));
        });
    }

    const flashcardsBtn = $('generate-flashcards-btn');
    if (flashcardsBtn) {
        flashcardsBtn.addEventListener('click', () => {
            if (isGeneratingFlashcards) {
                showToast('⏳ Flashcards generation already in progress...');
                return;
            }
            const chunk = getCurrentLectureTranscript();
            if (chunk.length < 3) {
                showToast('🎙️ Please start class and speak some lecture content first!');
                return;
            }
            showToast('⚡ Generating 3D concept flashcards...');
            enqueueApiTask('flashcards', chunk.slice(-MAX_TRANSCRIPT_CHARS));
        });
    }
}

function setGeneratingButtonState(loading) {
    isGeneratingDiagram = loading;
    const manualBtn = $('manual-generate-btn');
    const label = $('generate-btn-label');
    const icon = $('generate-btn-icon');

    if (manualBtn) {
        manualBtn.disabled = loading;
        if (loading) {
            manualBtn.classList.add('opacity-75', 'cursor-wait');
        } else {
            manualBtn.classList.remove('opacity-75', 'cursor-wait');
        }
    }
    if (label) {
        label.textContent = loading ? 'Generating...' : 'Generate Diagram';
    }
    if (icon) {
        icon.innerHTML = loading
            ? '<circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="16" class="animate-spin"/>'
            : '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>';
    }
}

function setGeneratingNotesButtonState(loading) {
    isGeneratingNotes = loading;
    const btn = $('generate-notes-btn');
    const label = $('generate-notes-label');
    const icon = $('generate-notes-icon');

    if (btn) {
        btn.disabled = loading;
        if (loading) {
            btn.classList.add('opacity-75', 'cursor-wait');
        } else {
            btn.classList.remove('opacity-75', 'cursor-wait');
        }
    }
    if (label) {
        label.textContent = loading ? 'Generating Notes...' : 'Generate Short Notes';
    }
    if (icon) {
        icon.innerHTML = loading
            ? '<circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="16" class="animate-spin"/>'
            : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>';
    }
}

function setGeneratingQuizButtonState(loading) {
    isGeneratingQuiz = loading;
    const btn = $('generate-quiz-btn');
    const label = $('generate-quiz-label');
    const icon = $('generate-quiz-icon');

    if (btn) {
        btn.disabled = loading;
        if (loading) {
            btn.classList.add('opacity-75', 'cursor-wait');
        } else {
            btn.classList.remove('opacity-75', 'cursor-wait');
        }
    }
    if (label) {
        label.textContent = loading ? 'Generating Quiz...' : 'Generate Quiz';
    }
    if (icon) {
        icon.innerHTML = loading
            ? '<circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="16" class="animate-spin"/>'
            : '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
    }
}

function setGeneratingFlashcardsButtonState(loading) {
    isGeneratingFlashcards = loading;
    const btn = $('generate-flashcards-btn');
    const label = $('generate-flashcards-label');
    const icon = $('generate-flashcards-icon');

    if (btn) {
        btn.disabled = loading;
        if (loading) {
            btn.classList.add('opacity-75', 'cursor-wait');
        } else {
            btn.classList.remove('opacity-75', 'cursor-wait');
        }
    }
    if (label) {
        label.textContent = loading ? 'Generating Cards...' : 'Generate Flashcards';
    }
    if (icon) {
        icon.innerHTML = loading
            ? '<circle cx="12" cy="12" r="10" stroke-width="2" stroke-dasharray="32" stroke-dashoffset="16" class="animate-spin"/>'
            : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>';
    }
}

// ------------------------------------------------------------------
// Rate-Limited API Queue
// ------------------------------------------------------------------
function enqueueApiTask(kind, payload) {
    if (kind === 'diagram') {
        const last = apiQueue[apiQueue.length - 1];
        if (last && last.kind === 'diagram') {
            last.payload = payload;
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
                setGeneratingButtonState(true);
                await sendTranscriptChunk(task.payload);
            } else if (task.kind === 'speech') {
                await refineAndSpeak(task.payload);
            } else if (task.kind === 'notes') {
                setGeneratingNotesButtonState(true);
                await sendNotesRequest(task.payload);
            } else if (task.kind === 'quiz') {
                setGeneratingQuizButtonState(true);
                await sendQuizRequest(task.payload);
            } else if (task.kind === 'flashcards') {
                setGeneratingFlashcardsButtonState(true);
                await sendFlashcardsRequest(task.payload);
            }
        } catch (err) {
            console.error(`API task (${task.kind}) failed:`, err);
            showError(`${task.kind} pipeline failed: ${err.message}`);
        } finally {
            if (task.kind === 'diagram') {
                setGeneratingButtonState(false);
            } else if (task.kind === 'notes') {
                setGeneratingNotesButtonState(false);
            } else if (task.kind === 'quiz') {
                setGeneratingQuizButtonState(false);
            } else if (task.kind === 'flashcards') {
                setGeneratingFlashcardsButtonState(false);
            }
        }
    }
    queueRunning = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendTranscriptChunk(transcript) {
    setStatus('generating', 'bg-accent/15 text-accent border-accent/30');
    if ($('last-update')) $('last-update').textContent = 'generating diagram…';

    const res = await fetch(`${API_BASE}/api/transcribe-to-diagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Backend responded ${res.status}`);
    }

    const data = await res.json();
    const graphData = normalizeGraphData(
        (data && Array.isArray(data.nodes) && data.nodes.length > 0)
            ? data
            : (data.graph_data || data.diagram_code || data)
    );

    // Auto-generate ONLY diagram, summary, and key terms; notes, quiz, and flashcards remain on-demand
    await renderDiagram(
        graphData,
        true,
        data.summary_bullets || [],
        data.key_terms || [],
        [],
        [],
        []
    );
    showToast('📊 Visual diagram & summary created!');

    if (isListening) {
        setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
    } else {
        setStatus('idle', 'bg-raised text-slate-400 border-edge');
    }
}

async function sendNotesRequest(transcript) {
    const res = await fetch(`${API_BASE}/api/generate-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Backend responded ${res.status}`);
    }

    const data = await res.json();
    const notes = data.short_notes || [];
    hasUnsavedSessionChanges = true;

    if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
        sessionDiagrams[currentDiagramIndex].short_notes = notes;
        saveCurrentSessionToStorage();
        renderSummaryAndNotes(
            sessionDiagrams[currentDiagramIndex].summary_bullets,
            notes,
            sessionDiagrams[currentDiagramIndex].key_terms
        );
    } else {
        renderSummaryAndNotes([], notes, []);
    }
    showToast(`📋 ${notes.length} high-yield study notes generated!`);
}

async function sendQuizRequest(transcript) {
    const res = await fetch(`${API_BASE}/api/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Backend responded ${res.status}`);
    }

    const data = await res.json();
    const quiz = data.quiz || [];
    hasUnsavedSessionChanges = true;

    if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
        sessionDiagrams[currentDiagramIndex].quiz = quiz;
        saveCurrentSessionToStorage();
    }
    renderQuiz(quiz);
    if ($('quiz-badge')) $('quiz-badge').textContent = String(quiz.length);
    showToast(`❓ ${quiz.length} quiz questions generated!`);
}

async function sendFlashcardsRequest(transcript) {
    const res = await fetch(`${API_BASE}/api/generate-flashcards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Backend responded ${res.status}`);
    }

    const data = await res.json();
    const flashcards = data.flashcards || [];
    hasUnsavedSessionChanges = true;

    if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
        sessionDiagrams[currentDiagramIndex].flashcards = flashcards;
        saveCurrentSessionToStorage();
    }
    renderFlashcards(flashcards);
    if ($('flashcard-badge')) $('flashcard-badge').textContent = String(flashcards.length);
    showToast(`🎴 ${flashcards.length} concept flashcards generated!`);
}

// ------------------------------------------------------------------
// Read Aloud Live Captions
// ------------------------------------------------------------------
function stopCaptionReadAloud() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (captionAudioEl) {
        captionAudioEl.onended = captionAudioEl.onerror = null;
        captionAudioEl.pause();
        if (captionAudioEl.src && captionAudioEl.src.startsWith('blob:')) {
            URL.revokeObjectURL(captionAudioEl.src);
        }
        captionAudioEl = null;
    }
    isReadingAloud = false;
    const speakBtn = $('speak-caption-btn');
    const label = $('speak-caption-label');
    if (speakBtn) speakBtn.classList.remove('speaking-active');
    if (label) label.textContent = 'Read Aloud';
}

async function toggleSpeakCaptions() {
    // Toggle off: stop whichever read-aloud engine is running (Edge-TTS or browser voice)
    if (isReadingAloud || (window.speechSynthesis && window.speechSynthesis.speaking)) {
        stopCaptionReadAloud();
        showToast('⏹️ Caption read-aloud stopped');
        return;
    }

    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (!fullText) {
        showToast('No caption text to speak aloud yet');
        return;
    }

    const speakBtn = $('speak-caption-btn');
    const label = $('speak-caption-label');

    // Prefer the human-quality Edge neural voice (same voice QuickTalk uses)
    try {
        const res = await fetch(`${API_BASE}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: fullText }),
        });
        if (!res.ok) throw new Error(`TTS request failed (${res.status})`);
        const blob = await res.blob();
        if (!blob.size) throw new Error('Empty audio stream');

        captionAudioEl = new Audio(URL.createObjectURL(blob));
        captionAudioEl.onended = stopCaptionReadAloud;
        captionAudioEl.onerror = stopCaptionReadAloud;
        await captionAudioEl.play();
        isReadingAloud = true;
        if (speakBtn) speakBtn.classList.add('speaking-active');
        if (label) label.textContent = 'Stop Audio';
        showToast('🔊 Reading captions with neural voice...');
        return;
    } catch (err) {
        console.warn('Edge-TTS read-aloud unavailable, using browser voice:', err.message);
        stopCaptionReadAloud();
    }

    // Last-resort fallback: browser speech synthesis
    if (!('speechSynthesis' in window)) {
        showToast('Speech synthesis not supported in this browser');
        return;
    }

    window.speechSynthesis.cancel();
    captionSpeechUtterance = new SpeechSynthesisUtterance(fullText);
    captionSpeechUtterance.rate = 1.0;

    if (/[\u0600-\u06FF]/.test(fullText)) {
        captionSpeechUtterance.lang = 'ur-PK';
    }

    captionSpeechUtterance.onstart = () => {
        isReadingAloud = true;
        if (speakBtn) speakBtn.classList.add('speaking-active');
        if (label) label.textContent = 'Stop Audio';
        showToast('🔊 Speaking live captions aloud...');
    };

    captionSpeechUtterance.onend = () => {
        isReadingAloud = false;
        if (speakBtn) speakBtn.classList.remove('speaking-active');
        if (label) label.textContent = 'Read Aloud';
    };

    captionSpeechUtterance.onerror = () => {
        isReadingAloud = false;
        if (speakBtn) speakBtn.classList.remove('speaking-active');
        if (label) label.textContent = 'Read Aloud';
    };

    window.speechSynthesis.speak(captionSpeechUtterance);
}

function initCaptionToolbar() {
    const speakBtn = $('speak-caption-btn');
    if (speakBtn) speakBtn.addEventListener('click', toggleSpeakCaptions);

    const copyBtn = $('copy-caption-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            const raw = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
            if (!raw) {
                showToast('No caption text to copy');
                return;
            }
            copyToClipboard(raw, '📋 Captions copied to clipboard!');
        });
    }

    const dlBtn = $('download-caption-btn');
    if (dlBtn) {
        dlBtn.addEventListener('click', () => {
            const raw = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
            if (!raw) {
                showToast('No caption text to download');
                return;
            }
            downloadTextFile(`captions_${fileStamp()}.txt`, raw);
            showToast('Captions downloaded');
        });
    }

    const clearBtn = $('clear-caption-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            interimBuffer = '';
            renderCaption('');
            showToast('Captions cleared');
        });
    }
}

// ------------------------------------------------------------------
// Live Multi-Language Translation
// ------------------------------------------------------------------
function initTranslationControls() {
    const tabOrig = $('tab-original-btn');
    const tabTrans = $('tab-translated-btn');
    const capBody = $('caption-body');
    const capTransBody = $('caption-translated-body');

    if (!tabOrig || !tabTrans) return;

    tabOrig.addEventListener('click', () => {
        tabOrig.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-raised text-white transition-all shadow-sm';
        tabTrans.className = 'px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1';
        if (capBody) capBody.classList.remove('hidden');
        if (capTransBody) {
            capTransBody.classList.add('hidden');
            capTransBody.classList.remove('flex');
        }
    });

    tabTrans.addEventListener('click', () => {
        tabTrans.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-raised text-white transition-all shadow-sm flex items-center gap-1';
        tabOrig.className = 'px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 transition-all';
        if (capBody) capBody.classList.add('hidden');
        if (capTransBody) {
            capTransBody.classList.remove('hidden');
            capTransBody.classList.add('flex');
        }
    });

    const transBtn = $('translate-caption-btn');
    if (transBtn) transBtn.addEventListener('click', translateLiveCaptions);

    const copyTrans = $('copy-translated-btn');
    if (copyTrans) {
        copyTrans.addEventListener('click', () => {
            if (!currentTranslationText) {
                showToast('No translated text to copy');
                return;
            }
            copyToClipboard(currentTranslationText, '📋 Translated text copied to clipboard!');
        });
    }

    const speakTrans = $('speak-translated-btn');
    if (speakTrans) {
        speakTrans.addEventListener('click', () => {
            if (!currentTranslationText) {
                showToast('No translated text to read aloud');
                return;
            }
            speakTranslatedText(currentTranslationText, currentTargetLanguage);
        });
    }
}

async function translateLiveCaptions() {
    const rawText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (!rawText) {
        showToast('No speech transcript to translate yet');
        return;
    }

    const langSelect = $('caption-lang-select');
    const targetLang = langSelect ? langSelect.value : 'Urdu (اردو)';
    currentTargetLanguage = targetLang;

    const tabTrans = $('tab-translated-btn');
    if (tabTrans) tabTrans.click();

    const empty = $('translated-empty');
    if (empty) empty.classList.add('hidden');
    const actions = $('translated-actions');
    if (actions) {
        actions.classList.add('hidden');
        actions.classList.remove('flex');
    }

    const targetEl = $('translated-text-target');
    if (targetEl) {
        targetEl.innerHTML = `
            <div class="flex items-center gap-2 text-sm text-accent py-8">
                <span class="w-2.5 h-2.5 rounded-full bg-accent animate-ping"></span>
                <span>Translating classroom transcript into <strong>${escapeHtml(targetLang)}</strong>...</span>
            </div>
        `;
    }

    try {
        const res = await fetch(`${API_BASE}/api/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: rawText.slice(-MAX_TRANSCRIPT_CHARS),
                target_language: targetLang,
            }),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: 'Translation request failed' }));
            throw new Error(errData.detail || `Server error: ${res.status}`);
        }

        const data = await res.json();
        currentTranslationText = data.translated_text;

        const isRtl = /Urdu|Arabic|Sindhi|Pashto|Punjabi/i.test(targetLang);
        if (targetEl) {
            targetEl.className = isRtl
                ? 'urdu-script text-right text-xl md:text-2xl leading-loose text-slate-100'
                : 'text-base md:text-lg leading-relaxed text-slate-100';
            targetEl.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
            targetEl.textContent = currentTranslationText;
        }

        const badge = $('trans-badge');
        if (badge) {
            badge.textContent = targetLang.split(' ')[0];
            badge.classList.remove('hidden');
        }

        const ind = $('translated-lang-indicator');
        if (ind) ind.textContent = `Translated: ${targetLang}`;

        if (actions) {
            actions.classList.remove('hidden');
            actions.classList.add('flex');
        }

        showToast(`🌐 Translated into ${targetLang}!`);
    } catch (err) {
        console.error('Translation error:', err);
        if (targetEl) {
            targetEl.innerHTML = `<span class="text-xs text-red-400 font-mono">Translation failed: ${escapeHtml(err.message)}</span>`;
        }
        showToast('Translation failed');
    }
}

function speakTranslatedText(text, language) {
    if (!('speechSynthesis' in window)) {
        showToast('Speech synthesis not supported');
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;

    if (/Urdu/i.test(language)) utterance.lang = 'ur-PK';
    else if (/Arabic/i.test(language)) utterance.lang = 'ar-SA';
    else if (/French/i.test(language)) utterance.lang = 'fr-FR';
    else if (/Spanish/i.test(language)) utterance.lang = 'es-ES';
    else if (/German/i.test(language)) utterance.lang = 'de-DE';
    else if (/Chinese/i.test(language)) utterance.lang = 'zh-CN';
    else if (/Hindi/i.test(language)) utterance.lang = 'hi-IN';
    else utterance.lang = 'en-US';

    showToast(`🔊 Reading ${language} translation aloud...`);
    window.speechSynthesis.speak(utterance);
}

// ------------------------------------------------------------------
// Student Expression Board (Shorthand refinement + Speech)
// ------------------------------------------------------------------


// ------------------------------------------------------------------
// Live Concept Chips & HUD
// ------------------------------------------------------------------
function renderLiveConceptChips(terms) {
    const container = $('live-terms-chips');
    if (!container) return;
    if (!terms || !terms.length) {
        container.innerHTML = '<span class="text-[10px] text-slate-500 italic font-mono">Terms extracted live as teacher speaks...</span>';
        return;
    }
    container.innerHTML = terms.map((t) => `
        <button class="concept-chip px-2.5 py-0.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-[10px] font-mono whitespace-nowrap hover:bg-accent hover:text-white transition-all shadow-sm flex items-center gap-1"
                data-term="${escapeHtml(t)}" title="Click to copy concept">
            <span>⚡</span>
            <span>${escapeHtml(t)}</span>
        </button>
    `).join('');

    container.querySelectorAll('.concept-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.term, `Copied concept: ${btn.dataset.term}`);
        });
    });

    const hudNode = $('diagram-node-hud');
    if (hudNode) {
        hudNode.textContent = `${terms.length} Concepts Identified`;
    }
}

function initPromptChips() {
    $$('.prompt-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const promptText = chip.dataset.prompt;
            if (!promptText) return;
            showToast(`🚀 Generating visual for "${chip.innerText.trim()}"...`);
            enqueueApiTask('diagram', promptText);
        });
    });
}

function toggleAudioVisualizer(active) {
    const vis = $('tts-audio-visualizer');
    if (vis) {
        vis.classList.toggle('hidden', !active);
        vis.classList.toggle('flex', active);
    }
    const badge = $('voice-engine-badge');
    if (badge) {
        badge.textContent = active ? '🔊 Speaking...' : 'Neural TTS Ready';
        badge.classList.toggle('text-accent', active);
        badge.classList.toggle('border-accent', active);
    }
}

function setRefinePreview(text) {
    const el = $('refine-preview-text');
    if (el && typeof text === 'string' && text.trim()) {
        el.textContent = text;
        el.title = text; // hover shows the full untruncated refinement
    }
}

function initToneBadges() {
    const hiddenInput = $('shorthand-tone-select');
    const badges = $$('.tone-badge');
    badges.forEach((badge) => {
        badge.addEventListener('click', () => {
            badges.forEach((b) => {
                b.classList.remove('active', 'bg-accent', 'text-white', 'border-accent');
                b.classList.add('bg-raised', 'text-slate-300', 'border-edge');
            });
            badge.classList.add('active', 'bg-accent', 'text-white', 'border-accent');
            badge.classList.remove('bg-raised', 'text-slate-300', 'border-edge');
            if (hiddenInput) {
                hiddenInput.value = badge.dataset.tone;
            }
            setRefinePreview(`${badge.innerText.trim()} · refines shorthand into natural spoken dialogue`);
            showToast(`Persona: ${badge.innerText.trim()}`);
        });
    });
}

function initSoundboardTabs() {
    const tabs = $$('.soundboard-tab');
    const presetBtns = $$('#soundboard-grid .preset-btn');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => {
                t.classList.remove('active', 'bg-raised', 'text-white', 'border-accent', 'shadow-sm');
                t.classList.add('bg-ink', 'text-slate-400', 'border-edge');
            });
            tab.classList.add('active', 'bg-raised', 'text-white', 'border-accent', 'shadow-sm');
            tab.classList.remove('bg-ink', 'text-slate-400', 'border-edge');

            const cat = tab.dataset.cat;
            presetBtns.forEach((btn) => {
                if (cat === 'all' || btn.dataset.cat === cat) {
                    btn.classList.remove('hidden');
                    btn.classList.add('flex');
                } else {
                    btn.classList.add('hidden');
                    btn.classList.remove('flex');
                }
            });
        });
    });
}

function initStudentExpressionBoard() {
    const input = $('shorthand-input');
    const count = $('char-count');
    const speakBtn = $('speak-btn');
    const clearBtn = $('clear-btn');
    const autoToggle = $('auto-speak-toggle');
    const toneSelect = $('shorthand-tone-select');
    const speedSlider = $('tts-speed-slider');
    const speedLabel = $('tts-speed-label');
    // Live "n/1000" counter — the backend rejects shorthand over 1000 chars
    const syncCount = () => {
        if (input && count) count.textContent = `${input.value.length}/1000`;
    };

    if (speedSlider && speedLabel) {
        speedSlider.addEventListener('input', () => {
            speedLabel.textContent = `${speedSlider.value}x`;
        });
    }

    if (input && count) {
        input.addEventListener('input', syncCount);

        input.addEventListener('keydown', (e) => {
            if (autoToggle && autoToggle.checked && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (speakBtn) speakBtn.click();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (speakBtn) speakBtn.click();
            }
        });
    }

    if (speakBtn && input) {
        speakBtn.addEventListener('click', () => {
            const text = input.value.trim();
            if (!text) return;
            const tone = toneSelect ? toneSelect.value : 'polite and respectful academic question';
            enqueueApiTask('speech', { shorthand: text, tone });
            input.value = '';
            syncCount();
        });
    }

    if (clearBtn && input) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            syncCount();
            input.focus();
        });
    }

    $$('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.text;
            const tone = toneSelect ? toneSelect.value : 'polite';
            if (text) enqueueApiTask('speech', { shorthand: text, tone });
        });
    });

    const savePresetBtn = $('save-preset-btn');
    const customInput = $('custom-preset-input');
    if (savePresetBtn && customInput) {
        savePresetBtn.addEventListener('click', () => {
            const val = customInput.value.trim();
            if (!val) return;
            saveCustomPreset(val);
            customInput.value = '';
        });
        customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                savePresetBtn.click();
            }
        });
    }

    renderCustomPresets();
    initToneBadges();
    initSoundboardTabs();
    initPromptChips();

    const clearLogBtn = $('clear-spoken-log-btn');
    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', () => {
            spokenHistory = [];
            renderSpokenLog();
            saveCurrentSessionToStorage();
            showToast('Spoken questions history cleared.');
        });
    }
}

async function speakWithEdgeTts(text) {
    // Human-quality neural speech via the backend Edge-TTS endpoint (free, no key).
    // Streams into the same low-latency player the WebSocket path uses; returns
    // false on failure so callers can fall back to browser speechSynthesis.
    try {
        const res = await fetch(`${API_BASE}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) throw new Error(`TTS request failed (${res.status})`);
        streamAudioPlayer.ensureContext();
        streamAudioPlayer.reset();
        const reader = res.body.getReader();
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength) {
                received += value.byteLength;
                streamAudioPlayer.enqueueChunk(
                    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
                );
            }
        }
        if (!received) throw new Error('Empty audio stream');
        return true;
    } catch (err) {
        console.warn('Edge-TTS unavailable, falling back to browser voice:', err.message);
        return false;
    }
}

async function refineAndSpeak(payload) {
    const rawShorthand = typeof payload === 'string' ? payload : (payload.shorthand || '');
    const tone = (typeof payload === 'object' && payload.tone) ? payload.tone : 'polite';
    if (!rawShorthand.trim()) return;

    // Use full-duplex WebSocket Neural TTS streaming if connected (<500ms latency)
    if (wsConnected) {
        streamAudioPlayer.ensureContext();
        streamAudioPlayer.reset();
        sendWsMessage({
            type: 'shorthand_speak',
            shorthand: rawShorthand,
            tone: tone,
        });
        setRefinePreview('⚡ Refining with Gemini · streaming neural voice...');
        showToast('⚡ QuickTalk Neural TTS streaming...');
        return;
    }

    // Fallback REST pipeline
    const speakBtn = $('speak-btn');
    if (speakBtn) speakBtn.disabled = true;
    setStatus('refining', 'bg-accent/15 text-accent border-accent/30');
    setRefinePreview('✨ Refining with Gemini...');

    let refinedText = rawShorthand;
    try {
        const res = await fetch(`${API_BASE}/api/shorthand-to-speech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shorthand: rawShorthand, tone }),
        });
        if (res.ok) {
            const data = await res.json();
            if (typeof data.refined_text === 'string' && data.refined_text.length > 0) {
                refinedText = data.refined_text;
                setRefinePreview(refinedText);
            }
        }
    } catch (err) {
        console.warn('Speech refinement failed, speaking raw input:', err.message);
        setRefinePreview('⚠️ Refinement unavailable — speaking your raw text instead.');
    } finally {
        if (speakBtn) speakBtn.disabled = false;
        if (isListening) {
            setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
        } else {
            setStatus('idle', 'bg-raised text-slate-400 border-edge');
        }
    }

    if (await speakWithEdgeTts(refinedText)) {
        showToast('🔊 Speaking with Edge neural voice');
        logSpoken(refinedText, rawShorthand);
    } else {
        speak(refinedText, rawShorthand);
    }
}

function speak(text, rawShorthand = '') {
    if (!('speechSynthesis' in window)) {
        console.error('speechSynthesis not supported');
        showToast('Speech synthesis not supported on this device');
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const speedSlider = $('tts-speed-slider');
    const speed = speedSlider ? parseFloat(speedSlider.value) || 1.0 : 1.0;
    utterance.rate = speed;

    if (/[\u0600-\u06FF]/.test(text)) {
        utterance.lang = 'ur-PK';
    } else {
        utterance.lang = 'en-US';
    }

    window.speechSynthesis.speak(utterance);
    logSpoken(text, rawShorthand);
}

function logSpoken(text, rawShorthand = '') {
    const item = { time: stamp(), text, raw: rawShorthand || text };
    spokenHistory.unshift(item);
    hasUnsavedSessionChanges = true;
    renderSpokenLog();
    saveCurrentSessionToStorage();
}

function renderSpokenLog() {
    const log = $('spoken-log');
    if (!log) return;

    if (!spokenHistory.length) {
        log.innerHTML = '<li class="text-slate-500 italic text-xs">Nothing spoken yet.</li>';
        return;
    }

    log.innerHTML = spokenHistory.slice(0, 20).map((item) => `
        <li class="rise-in p-3 rounded-xl bg-ink border border-edge flex items-center justify-between gap-3 text-xs">
            <div class="min-w-0 flex-1">
                <div class="text-slate-200 font-semibold text-sm leading-snug">${escapeHtml(item.text)}</div>
                <div class="text-[11px] font-mono text-slate-500 flex items-center gap-2 mt-1">
                    <span>${escapeHtml(item.time)}</span>
                    ${item.raw && item.raw !== item.text ? `<span class="truncate text-slate-600">‹ ${escapeHtml(item.raw)}</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button class="replay-btn px-2.5 py-1 rounded-lg bg-raised hover:bg-edge text-slate-300 hover:text-white text-xs border border-edge"
                        data-text="${escapeHtml(item.text)}" title="Replay voice">
                    🔊 Replay
                </button>
                <button class="copy-spoken-btn px-2 py-1 rounded-lg bg-raised hover:bg-edge text-slate-300 hover:text-white text-xs border border-edge"
                        data-text="${escapeHtml(item.text)}" title="Copy text">
                    📋
                </button>
            </div>
        </li>
    `).join('');

    log.querySelectorAll('.replay-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            speak(btn.dataset.text || '');
            showToast('🔊 Replaying speech...');
        });
    });

    log.querySelectorAll('.copy-spoken-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            copyToClipboard(btn.dataset.text || '', '📋 Spoken phrase copied!');
        });
    });
}

function getSavedPresets() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_PRESETS_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveCustomPreset(phrase) {
    const list = getSavedPresets();
    if (!list.includes(phrase)) {
        list.push(phrase);
        try {
            localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn('Preset save failed:', e);
            showToast('Could not save preset (storage full?)', true);
            return;
        }
        renderCustomPresets();
        showToast(`Saved preset: "${phrase.slice(0, 20)}..."`);
    }
}

function deleteCustomPreset(phrase) {
    let list = getSavedPresets();
    list = list.filter((p) => p !== phrase);
    try {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('Preset delete failed:', e);
    }
    renderCustomPresets();
    showToast('Preset removed');
}

function renderCustomPresets() {
    const container = $('custom-presets-container');
    if (!container) return;
    const list = getSavedPresets();
    if (!list.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = list.map((phrase) => `
        <span class="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg bg-ink border border-edge text-slate-200 text-xs">
            <button class="custom-preset-btn hover:text-accent transition-colors text-left max-w-[220px] truncate" data-text="${escapeHtml(phrase)}" title="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>
            <button class="del-preset-btn text-slate-500 hover:text-red-400 font-bold leading-none px-1" data-phrase="${escapeHtml(phrase)}" title="Delete preset">×</button>
        </span>
    `).join('');

    const toneSelect = $('shorthand-tone-select');
    container.querySelectorAll('.custom-preset-btn').forEach((b) => {
        b.addEventListener('click', () => {
            const tone = toneSelect ? toneSelect.value : 'polite';
            enqueueApiTask('speech', { shorthand: b.dataset.text || '', tone });
        });
    });

    container.querySelectorAll('.del-preset-btn').forEach((b) => {
        b.addEventListener('click', () => {
            deleteCustomPreset(b.dataset.phrase || '');
        });
    });
}

// ------------------------------------------------------------------
// AI Chatbot Assistant (Full-Page Tutor)
// ------------------------------------------------------------------
function initChatbot() {
    const clearBtn = $('clear-chat-btn');
    const form = $('chat-form');
    const input = $('chat-input');
    const messages = $('chat-messages');
    const incContext = $('chat-include-context');

    if (clearBtn && messages) {
        clearBtn.addEventListener('click', () => {
            chatHistory = [];
            messages.innerHTML = `
                <div class="chat-msg chat-msg-bot flex gap-3 items-start">
                    <div class="w-7 h-7 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0 text-sm mt-0.5">🤖</div>
                    <div class="bg-raised border border-edge rounded-2xl p-4 text-xs md:text-sm text-slate-200 max-w-[80%] leading-relaxed shadow-sm">
                        Chat cleared. Ask me anything about the lecture concepts, diagrams, or key terms!
                    </div>
                </div>
            `;
            showToast('Chat history cleared');
        });
    }

    $$('.chat-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            if (prompt) sendChatMessage(prompt);
        });
    });

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            sendChatMessage(text);
            input.value = '';
        });
    }

    async function sendChatMessage(userText) {
        appendChatMessage('user', userText);
        const loadingId = appendChatLoading();

        let contextString = '';
        if (incContext && incContext.checked) {
            const currentDiag = (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex])
                ? sessionDiagrams[currentDiagramIndex]
                : (sessionDiagrams[sessionDiagrams.length - 1] || null);

            const recentSpeech = (interimBuffer + ($('caption-interim')?.textContent || '')).slice(-1000).trim();
            contextString = `Recent Classroom Speech:\n${recentSpeech || 'None'}\n\n`;
            if (currentDiag) {
                contextString += `Current Diagram Graph Data:\n${currentDiag.diagram_code}\n\nSummary Points:\n${currentDiag.summary_bullets.join(', ')}\n\nKey Terms: ${currentDiag.key_terms.join(', ')}`;
            }
        }

        try {
            const res = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userText,
                    context: contextString,
                    history: chatHistory.slice(-6),
                }),
            });

            removeChatLoading(loadingId);

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `Server error ${res.status}`);
            }

            const data = await res.json();
            appendChatMessage('bot', data.reply);
        } catch (err) {
            removeChatLoading(loadingId);
            appendChatMessage('bot', `⚠️ Could not reach AI assistant: ${err.message}`);
        }
    }

    function appendChatMessage(role, text) {
        if (!messages) return;
        chatHistory.push({ role, content: text });
        const wrapper = document.createElement('div');
        wrapper.className = `chat-msg chat-msg-${role} flex gap-3 items-start ${role === 'user' ? 'justify-end' : 'justify-start'} rise-in`;

        if (role === 'user') {
            wrapper.innerHTML = `
                <div class="bg-accent text-white rounded-2xl rounded-tr-sm p-4 text-xs md:text-sm max-w-[80%] leading-relaxed shadow-md">
                    ${escapeHtml(text)}
                </div>
            `;
        } else {
            wrapper.innerHTML = `
                <div class="w-7 h-7 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0 text-sm mt-0.5">🤖</div>
                <div class="bg-raised border border-edge rounded-2xl rounded-tl-sm p-4 text-xs md:text-sm text-slate-200 max-w-[80%] leading-relaxed shadow-sm">
                    ${formatMarkdownChat(text)}
                </div>
            `;
        }

        messages.appendChild(wrapper);
        messages.scrollTop = messages.scrollHeight;
    }

    let loadingCounter = 0;
    function appendChatLoading() {
        if (!messages) return '';
        const id = `chat-loading-${++loadingCounter}`;
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'chat-msg flex gap-3 items-start justify-start rise-in';
        wrapper.innerHTML = `
            <div class="w-7 h-7 rounded-lg bg-accent/20 text-accent flex items-center justify-center shrink-0 text-sm mt-0.5">🤖</div>
            <div class="bg-raised border border-edge rounded-2xl p-4 text-xs font-mono text-slate-400 flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style="animation-delay:0.15s"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style="animation-delay:0.3s"></span>
                <span class="ml-1">thinking...</span>
            </div>
        `;
        messages.appendChild(wrapper);
        messages.scrollTop = messages.scrollHeight;
        return id;
    }

    function removeChatLoading(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function formatMarkdownChat(raw) {
        let clean = escapeHtml(raw);
        clean = clean.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        clean = clean.replace(/\*(.*?)\*/g, '<em>$1</em>');
        clean = clean.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-ink border border-edge font-mono text-[11px]">$1</code>');
        clean = clean.replace(/\n/g, '<br/>');
        return clean;
    }
}

// ------------------------------------------------------------------
// Session Storage Archive & Export Engine
// ------------------------------------------------------------------
function generateSessionDescription(transcript, diagrams, keyTerms) {
    const termsArr = Array.from(keyTerms || []);
    if (termsArr.length > 0) {
        return `Lecture covering ${termsArr.slice(0, 4).join(', ')}`;
    }

    if (diagrams && diagrams.length > 0) {
        for (const d of diagrams) {
            if (d.summary_bullets && d.summary_bullets.length > 0) {
                const firstBullet = d.summary_bullets[0].trim();
                if (firstBullet.length > 0) {
                    return firstBullet.length > 60 ? firstBullet.slice(0, 57) + '...' : firstBullet;
                }
            }
        }
    }

    const cleanText = (transcript || '').trim().replace(/\s+/g, ' ');
    if (cleanText.length > 0) {
        return cleanText.length > 50 ? cleanText.slice(0, 47) + '...' : cleanText;
    }

    return 'Classroom Lecture Session';
}

// Strip the rendered SVG markup before persisting: it is the bulk of the
// payload and can be re-rendered from diagram_code on demand, so sessions
// no longer risk blowing the localStorage quota.
function serializeSessionDiagrams() {
    return sessionDiagrams.map((d) => ({ ...d, svg: undefined }));
}

function buildSessionRecord() {
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    const desc = generateSessionDescription(fullText, sessionDiagrams, allSessionKeyTerms);
    return {
        id: sessionStartTime ? sessionStartTime.getTime() : Date.now(),
        date: sessionStartTime ? sessionStartTime.toLocaleString() : new Date().toLocaleString(),
        description: desc,
        transcript: fullText,
        diagrams: serializeSessionDiagrams(),
        spokenLog: [...spokenHistory],
        keyTerms: Array.from(allSessionKeyTerms),
    };
}

// Debounced: renderCaption fires several times per second during live speech,
// and serializing the whole session on every interim result caused jank.
let sessionSaveTimer = null;
function saveCurrentSessionToStorage() {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
        sessionSaveTimer = null;
        try {
            localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(buildSessionRecord()));
        } catch (e) {
            console.warn('LocalStorage save failed:', e);
        }
    }, 2000);
}

function flushSessionSave() {
    if (!sessionSaveTimer) return;
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
    try {
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(buildSessionRecord()));
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

function getSavedSessions() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) || '[]');
    } catch {
        return [];
    }
}

function autoSaveSessionOnClassEnd(reason = 'Class ended') {
    // Skip when nothing changed since the last archive (prevents duplicate
    // saves and toasts when stopping and immediately restarting a class).
    if (!hasUnsavedSessionChanges) return false;
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (fullText.length === 0 && sessionDiagrams.length === 0 && spokenHistory.length === 0) {
        return false;
    }

    const roomTag = currentRoomId ? ` [Room: ${currentRoomId}]` : '';
    const sessionSnapshot = buildSessionRecord();
    sessionSnapshot.description += roomTag;
    sessionSnapshot.room = currentRoomId || null;

    const list = getSavedSessions();
    const existingIndex = list.findIndex((s) => s.id === sessionSnapshot.id);
    if (existingIndex >= 0) {
        list[existingIndex] = sessionSnapshot;
    } else {
        list.unshift(sessionSnapshot);
        while (list.length > 25) list.pop();
    }

    try {
        localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(sessionSnapshot));
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }
    hasUnsavedSessionChanges = false;

    renderSavedSessionsList();
    refreshStorageDashboard();
    showToast(`💾 ${reason}: Class session auto-saved to Storage!`);
    return true;
}
window.autoSaveSessionOnClassEnd = autoSaveSessionOnClassEnd;

function saveCurrentSnapshot() {
    const roomTag = currentRoomId ? ` [Room: ${currentRoomId}]` : '';
    const currentSession = buildSessionRecord();
    currentSession.id = Date.now();
    currentSession.date = new Date().toLocaleString();
    currentSession.description += roomTag;
    currentSession.room = currentRoomId || null;

    const list = getSavedSessions();
    list.unshift(currentSession);
    while (list.length > 25) list.pop();
    try {
        localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(currentSession));
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }
    renderSavedSessionsList();
    refreshStorageDashboard();
    showToast('Session snapshot saved to storage archive!');
}

function refreshStorageDashboard() {
    if ($('stat-diagrams')) $('stat-diagrams').textContent = String(sessionDiagrams.length);
    if ($('stat-captions')) $('stat-captions').textContent = `${(interimBuffer + ($('caption-interim')?.textContent || '')).length} chars`;
    if ($('stat-terms')) $('stat-terms').textContent = String(allSessionKeyTerms.size);
    if ($('stat-status')) $('stat-status').textContent = isListening ? 'Active (Recording)' : 'Idle';
    renderSavedSessionsList();
}

function renderSavedSessionsList() {
    const listEl = $('saved-sessions-list');
    if (!listEl) return;
    const list = getSavedSessions();
    if (!list.length) {
        listEl.innerHTML = `
            <div class="text-xs text-slate-500 italic p-6 bg-raised rounded-2xl border border-edge text-center flex flex-col items-center gap-1.5">
                <span class="text-xl">💾</span>
                <span class="font-medium text-slate-300">No saved sessions in archive yet.</span>
                <span class="text-[11px] text-slate-500">Classes and lectures are automatically saved here as soon as they end.</span>
            </div>
        `;
        return;
    }

    listEl.innerHTML = list.map((s, idx) => `
        <div class="p-4 bg-raised border ${idx === 0 ? 'border-accent/50 bg-accent/5' : 'border-edge'} rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-sm hover:border-accent/60 transition-all">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-white text-sm">${escapeHtml(s.date)}</span>
                    ${idx === 0 ? '<span class="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">⚡ RECENTLY ENDED</span>' : ''}
                    ${s.room ? `<span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-raised text-indigo-300 border border-indigo-500/30 font-medium">Room: ${escapeHtml(s.room)}</span>` : ''}
                    <span class="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 font-medium truncate max-w-sm">
                        ${escapeHtml(s.description || 'Classroom Lecture Session')}
                    </span>
                </div>
                <div class="text-xs text-slate-400 font-mono mt-1 flex items-center gap-2 flex-wrap">
                    <span>📊 ${s.diagrams ? s.diagrams.length : 0} diagrams</span>
                    <span>•</span>
                    <span>📝 ${(s.transcript || '').length} chars</span>
                    <span>•</span>
                    <span>🔑 ${(s.keyTerms || []).length} key terms</span>
                    <span>•</span>
                    <span>🗣️ ${(s.spokenLog || []).length} spoken items</span>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button onclick="window.restoreSessionByIndex(${idx})" title="Restore session to Classroom & Study Hub"
                        class="px-3.5 py-1.5 rounded-xl bg-accent hover:opacity-90 text-white font-mono text-xs font-semibold shadow-sm shadow-accent/20 transition-all">
                    Restore to View
                </button>
                <button onclick="window.deleteSessionByIndex(${idx})" title="Delete archived session"
                        class="p-2 rounded-xl bg-panel hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-edge transition-colors">
                    <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

window.restoreSessionByIndex = function(idx) {
    const list = getSavedSessions();
    if (list[idx]) {
        restoreSession(list[idx]);
        navigateToPage('classroom');
    }
};

window.deleteSessionByIndex = function(idx) {
    const list = getSavedSessions();
    list.splice(idx, 1);
    try {
        localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('Session delete failed:', e);
    }
    renderSavedSessionsList();
    showToast('Saved session removed');
};

function restoreSession(session) {
    if (!session) return;
    interimBuffer = session.transcript || '';
    sessionDiagrams = session.diagrams || [];
    spokenHistory = session.spokenLog || [];
    allSessionKeyTerms = new Set(session.keyTerms || []);

    // Restored content already lives in storage; do not mark it dirty.
    renderCaption('', false);
    renderSpokenLog();

    if (sessionDiagrams.length > 0) {
        displayDiagramSnapshot(sessionDiagrams.length - 1);
    } else {
        updateTimelineControls();
    }

    refreshStorageDashboard();
    showToast(`Session restored (${sessionDiagrams.length} diagrams, ${interimBuffer.length} chars)`);
}

function restoreLastSession() {
    try {
        const lastRaw = localStorage.getItem(LAST_SESSION_KEY);
        if (!lastRaw) {
            showToast('No previous session found in storage');
            return;
        }
        const session = JSON.parse(lastRaw);
        restoreSession(session);
        navigateToPage('classroom');
    } catch {
        showToast('Failed to restore previous session');
    }
}

// ------------------------------------------------------------------
// Exports & Downloads (.md, .html, .json, .txt, .svg, .png)
// ------------------------------------------------------------------
function exportMarkdownStudyGuide() {
    const fullTranscript = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    let md = `# EchoVisual Classroom Study Guide\n\n`;
    md += `**Date:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
    md += `**Total Diagrams Generated:** ${sessionDiagrams.length}\n`;
    md += `**Key Terms Covered:** ${Array.from(allSessionKeyTerms).join(', ') || 'None'}\n\n`;
    md += `---\n\n`;

    md += `## 1. Visual Study Diagrams, Notes & Quizzes\n\n`;
    if (sessionDiagrams.length === 0) {
        md += `*No diagrams recorded in this session.*\n\n`;
    } else {
        sessionDiagrams.forEach((snap, idx) => {
            md += `### Diagram ${idx + 1} (${snap.timeString})\n\n`;
            md += `\`\`\`json
${snap.diagram_code}
\`\`\`

`;
            md += `**Summary:**\n`;
            if (snap.summary_bullets && snap.summary_bullets.length) {
                snap.summary_bullets.forEach((b) => { md += `- ${b}\n`; });
            } else {
                md += `- No summary points recorded.\n`;
            }
            if (snap.short_notes && snap.short_notes.length) {
                md += `\n**Structured Study Notes:**\n`;
                snap.short_notes.forEach((n) => { md += `- ${n}\n`; });
            }
            if (snap.quiz && snap.quiz.length) {
                md += `\n**Quiz Questions:**\n`;
                snap.quiz.forEach((q, qIdx) => {
                    md += `**Q${qIdx + 1}: ${q.question}**\n`;
                    (q.options || []).forEach((opt) => { md += `  - ${opt}\n`; });
                    md += `  *Correct Answer: ${q.answer}*\n`;
                    if (q.explanation) md += `  *Explanation: ${q.explanation}*\n`;
                });
            }
            if (snap.flashcards && snap.flashcards.length) {
                md += `\n**Flashcards:**\n`;
                snap.flashcards.forEach((fc) => {
                    md += `- **Front:** ${fc.front} | **Back:** ${fc.back}\n`;
                });
            }
            md += `\n**Key Terms:** ${(snap.key_terms || []).join(', ') || 'None'}\n\n`;
        });
    }

    md += `---\n\n## 2. Complete Classroom Speech Transcript\n\n`;
    md += fullTranscript ? fullTranscript : `*No speech recorded.*`;
    md += `\n\n---\n*Generated by EchoVisual & QuickTalk AI Study Companion*\n`;

    downloadTextFile(`study-guide_${fileStamp()}.md`, md, 'text/markdown;charset=utf-8');
    showToast('📄 Study Guide (.md) downloaded!');
}

function exportHtmlStudyReport() {
    const fullTranscript = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    const diagramsHtml = sessionDiagrams.map((snap, idx) => `
        <div style="background:#10141b; border:1px solid #212836; border-radius:12px; padding:20px; margin-bottom:24px;">
            <div style="font-family:monospace; color:#818cf8; font-size:12px; margin-bottom:8px;">DIAGRAM ${idx + 1} • ${snap.timeString}</div>
            <div style="background:#07090e; border:1px solid #1e2a40; border-radius:8px; padding:12px; margin:12px 0;">
                <div style="font-size:11px; font-family:monospace; color:#818cf8; margin-bottom:6px;">CONCEPT GRAPH DATA</div>
                <pre style="font-family:monospace; font-size:12px; color:#cbd5e1; white-space:pre-wrap; margin:0;">${escapeHtml(snap.diagram_code)}</pre>
            </div>
            <h4 style="color:#ffffff; margin:12px 0 6px 0;">Summary Points</h4>
            <ul style="color:#cbd5e1; font-size:14px; line-height:1.6;">
                ${(snap.summary_bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}
            </ul>
            ${(snap.short_notes && snap.short_notes.length) ? `
                <h4 style="color:#38bdf8; margin:12px 0 6px 0;">Study Notes</h4>
                <ul style="color:#cbd5e1; font-size:14px; line-height:1.6;">
                    ${snap.short_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
                </ul>
            ` : ''}
            ${(snap.quiz && snap.quiz.length) ? `
                <h4 style="color:#f59e0b; margin:12px 0 6px 0;">Classroom Quiz</h4>
                <div style="font-size:13px; color:#e2e8f0;">
                    ${snap.quiz.map((q, qIdx) => `
                        <div style="margin-bottom:10px; background:#07090e; padding:10px; border-radius:8px;">
                            <strong>Q${qIdx + 1}: ${escapeHtml(q.question)}</strong><br/>
                            <span style="color:#94a3b8;">Options: ${(q.options || []).map((o) => escapeHtml(o)).join(' | ')}</span><br/>
                            <span style="color:#10b981;">Answer: ${escapeHtml(q.answer)}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            ${(snap.flashcards && snap.flashcards.length) ? `
                <h4 style="color:#a855f7; margin:14px 0 8px 0;">Concept Flashcards (${snap.flashcards.length})</h4>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-bottom:12px;">
                    ${snap.flashcards.map((fc, fcIdx) => `
                        <div class="flashcard-box">
                            <div class="fc-tag">Flashcard #${fcIdx + 1}</div>
                            <div class="fc-front">${escapeHtml(fc.front)}</div>
                            <div class="fc-back">${escapeHtml(fc.back)}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap;">
                ${(snap.key_terms || []).map((t) => `<span style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#818cf8; padding:2px 8px; border-radius:6px; font-size:12px; font-family:monospace;">${escapeHtml(t)}</span>`).join('')}
            </div>
        </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>EchoVisual Classroom Report - ${new Date().toLocaleDateString()}</title>
    <!-- Standalone Report Viewer -->
    <style>
        body { background:#07090e; color:#f1f5f9; font-family:system-ui,-apple-system,sans-serif; margin:0; padding:32px 20px; }
        .container { max-width:900px; margin:0 auto; }
        h1 { color:#ffffff; font-size:24px; margin-bottom:4px; }
        h2 { color:#ffffff; font-size:18px; margin-top:0; border-bottom:1px solid #1e2a40; padding-bottom:10px; }
        h4 { font-size:14px; font-weight:600; }
        .meta { font-family:monospace; color:#94a3b8; font-size:13px; margin-bottom:24px; }
        .section { background:#0d121c; border:1px solid #1e2a40; border-radius:16px; padding:24px; margin-bottom:24px; }
        .transcript-box { background:#07090e; border:1px solid #1e2a40; border-radius:12px; padding:16px; font-size:15px; line-height:1.7; color:#e2e8f0; max-height:400px; overflow-y:auto; }
        .flashcard-box { background:#07090e; border:1px solid #1e2a40; border-radius:12px; padding:14px; transition:border-color 0.2s; }
        .flashcard-box:hover { border-color:#818cf8; }
        .fc-tag { font-size:10px; font-family:monospace; color:#818cf8; text-transform:uppercase; margin-bottom:4px; font-weight:600; }
        .fc-front { font-weight:600; color:#ffffff; font-size:13px; margin-bottom:8px; }
        .fc-back { font-size:12px; color:#cbd5e1; border-top:1px dashed #334155; padding-top:8px; line-height:1.5; }
    </style>
</head>
<body>
    <div class="container">
        <h1>EchoVisual & QuickTalk AI - Classroom Study Report</h1>
        <div class="meta">Recorded on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</div>

        <div class="section">
            <h2>Visual Learning Diagrams, Notes, Quizzes & Flashcards (${sessionDiagrams.length})</h2>
            ${diagramsHtml || '<p style="color:#64748b;">No diagrams in this session.</p>'}
        </div>

        <div class="section">
            <h2>Classroom Speech Transcript</h2>
            <div class="transcript-box">${escapeHtml(fullTranscript) || '<em>No captions recorded.</em>'}</div>
        </div>
    </div>
</body>
</html>`;

    downloadTextFile(`lecture-report_${fileStamp()}.html`, html, 'text/html;charset=utf-8');
    showToast('🌐 HTML Study Report with Flashcards downloaded!');
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function convertSvgToPngAndDownload(svgString, filename) {
    try {
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const URLObj = window.URL || window.webkitURL || window;
        const blobURL = URLObj.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = 2;
            canvas.width = (img.width || 800) * scale;
            canvas.height = (img.height || 600) * scale;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0d121c';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                if (!blob) throw new Error('Canvas conversion failed');
                const pngURL = URLObj.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = pngURL;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URLObj.revokeObjectURL(pngURL);
                URLObj.revokeObjectURL(blobURL);
                showToast('🖼️ PNG image downloaded!');
            }, 'image/png');
        };
        img.onerror = () => {
            URLObj.revokeObjectURL(blobURL);
            downloadTextFile(filename.replace('.png', '.svg'), svgString, 'image/svg+xml');
            showToast('Downloaded SVG format');
        };
        img.src = blobURL;
    } catch {
        downloadTextFile(filename.replace('.png', '.svg'), svgString, 'image/svg+xml');
    }
}

function initStorageActions() {
    const saveBtn = $('save-current-session-btn');
    const restoreBtn = $('restore-last-session-btn');
    const dlMd = $('download-study-guide-btn');
    const dlHtml = $('download-html-report-btn');

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentSnapshot);
    if (restoreBtn) restoreBtn.addEventListener('click', restoreLastSession);
    if (dlMd) dlMd.addEventListener('click', exportMarkdownStudyGuide);
    if (dlHtml) dlHtml.addEventListener('click', exportHtmlStudyReport);
}

// ------------------------------------------------------------------
// Keyboard Shortcuts & Hover Hints
// Alt+1..6 jump between tabs; Alt+S/M/T/C/R trigger common actions.
// Hover (or keyboard-focus) any tagged control to see its shortcut.
// Note: Alt+ArrowLeft/Right and [ ] are reserved for the diagram timeline.
// ------------------------------------------------------------------
const SHORTCUT_ROUTES = ['classroom', 'rooms', 'expression', 'study', 'tutor', 'storage'];
const THEME_CYCLE_ORDER = ['theme-indigo', 'theme-cobalt', 'theme-emerald', 'theme-violet', 'theme-cyan'];

function isTypingContext(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function triggerShortcutTarget(id, label) {
    const el = $(id);
    if (el) {
        el.click();
        console.log(`[Shortcut] ${label}`);
    }
}

function cycleColorTheme() {
    const idx = THEME_CYCLE_ORDER.indexOf(currentThemeClass);
    const next = THEME_CYCLE_ORDER[(idx + 1 + THEME_CYCLE_ORDER.length) % THEME_CYCLE_ORDER.length] || THEME_CYCLE_ORDER[0];
    const btn = document.querySelector(`.theme-select-btn[data-theme="${next}"]`);
    if (btn) {
        // Reuse the theme button so apply + persist + toast stay in one place
        btn.click();
    } else {
        currentThemeClass = next;
        applyThemeAndMode();
    }
    console.log(`[Shortcut] Cycle color theme -> ${next.replace('theme-', '')} (Alt+T)`);
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape closes the fullscreen diagram modal
        if (e.key === 'Escape') {
            const modal = $('fullscreen-modal');
            if (modal && !modal.classList.contains('hidden')) {
                const closeBtn = $('close-fullscreen-btn');
                if (closeBtn) closeBtn.click();
            }
            return;
        }

        // All app shortcuts use Alt (Ctrl/Cmd combos stay free for the browser)
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        if (isTypingContext(e.target)) return;

        // Alt+1..6 -> jump straight to that tab
        const digitMatch = /^(?:Digit|Numpad)([1-6])$/.exec(e.code || '');
        if (digitMatch) {
            e.preventDefault();
            const route = SHORTCUT_ROUTES[Number(digitMatch[1]) - 1];
            if (window.location.hash === `#${route}`) {
                navigateToPage(route); // already there: just re-run the page hooks
            } else {
                window.location.hash = `#${route}`; // triggers the hash router
            }
            console.log(`[Shortcut] Navigate to "${route}" (Alt+${digitMatch[1]})`);
            return;
        }

        switch (e.code) {
            case 'KeyS':
                e.preventDefault();
                triggerShortcutTarget('start-class-btn', 'Start / Stop Class (Alt+S)');
                break;
            case 'KeyM':
                e.preventDefault();
                triggerShortcutTarget('color-mode-toggle-btn', 'Toggle Light / Dark mode (Alt+M)');
                break;
            case 'KeyT':
                e.preventDefault();
                cycleColorTheme();
                break;
            case 'KeyC':
                e.preventDefault();
                triggerShortcutTarget('copy-caption-btn', 'Copy live captions (Alt+C)');
                break;
            case 'KeyR':
                e.preventDefault();
                triggerShortcutTarget('speak-caption-btn', 'Read captions aloud (Alt+R)');
                break;
        }
    });
}

function initKbdTooltips() {
    // Hover hints only make sense with a fine pointer; skip pure touch devices
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const tip = document.createElement('div');
    tip.id = 'kbd-tooltip';
    tip.className = 'kbd-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let currentEl = null;

    const hideTip = () => {
        if (!currentEl) return;
        currentEl = null;
        tip.classList.remove('visible');
    };

    const showTip = (el) => {
        const combo = el.getAttribute('data-kbd');
        if (!combo) return;
        const label = el.getAttribute('data-kbd-label') || '';
        const keysHtml = combo.split('+')
            .map((key) => `<kbd>${escapeHtml(key.trim())}</kbd>`)
            .join('<span class="kbd-plus">+</span>');
        tip.innerHTML = label ? `<span class="kbd-tip-label">${escapeHtml(label)}</span>${keysHtml}` : keysHtml;

        // Measure while still hidden (visibility:hidden keeps box metrics)
        tip.style.left = '0px';
        tip.style.top = '0px';
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const rect = el.getBoundingClientRect();
        const gap = 8;

        let top;
        let left;
        if (el.getAttribute('data-kbd-pos') === 'left') {
            // Side placement: the theme picker's hover dropdown opens below the button
            top = rect.top + rect.height / 2 - th / 2;
            left = rect.left - tw - gap;
        } else {
            top = rect.bottom + gap;
            left = rect.left + rect.width / 2 - tw / 2;
            if (top + th > window.innerHeight - gap) {
                top = rect.top - th - gap; // flip above (e.g. bottom nav bar)
            }
        }
        left = Math.min(Math.max(gap, left), window.innerWidth - tw - gap);
        top = Math.min(Math.max(gap, top), window.innerHeight - th - gap);

        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
        tip.classList.add('visible');
        currentEl = el;
    };

    document.addEventListener('mouseover', (e) => {
        const el = e.target instanceof Element ? e.target.closest('[data-kbd]') : null;
        if (el) {
            if (el !== currentEl) showTip(el);
        } else {
            hideTip();
        }
    });

    document.addEventListener('focusin', (e) => {
        const el = e.target instanceof Element ? e.target.closest('[data-kbd]') : null;
        if (el) showTip(el);
    });
    document.addEventListener('focusout', hideTip);

    // Hide when the anchored control moves (inner scrolls included) or the window loses focus
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
    window.addEventListener('blur', hideTip);
}

// ------------------------------------------------------------------
// Application Initialization
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const safeInit = (name, fn) => {
        try {
            fn();
        } catch (err) {
            console.error(`[Init Error] ${name}:`, err);
        }
    };

    safeInit('Themes', initThemesAndModes);
    safeInit('Router', initPageRouter);
    safeInit('KeyboardShortcuts', initKeyboardShortcuts);
    safeInit('KbdTooltips', initKbdTooltips);
    safeInit('WebSocket', initLiveWebSocket);
    safeInit('SpeechRecognition', initLiveSpeechRecognition);
    safeInit('OnCommandGenerator', initOnCommandGenerator);
    safeInit('StudyGenerators', initStudyGenerators);
    safeInit('StudyTabs', initStudyTabs);
    safeInit('VisNetwork', initVisNetwork);
    safeInit('VisBoardControls', initVisBoardControls);
    safeInit('ZoomAndFullscreen', initZoomAndFullscreen);
    safeInit('ClassroomMobileSwitcher', initClassroomMobileSwitcher);
    safeInit('CaptionToolbar', initCaptionToolbar);
    safeInit('TranslationControls', initTranslationControls);
    safeInit('StudentExpressionBoard', initStudentExpressionBoard);
    safeInit('Chatbot', initChatbot);
    safeInit('StorageActions', initStorageActions);
    safeInit('Lobby', initLobby);
    safeInit('DraggableDeck', initDraggableVideoDeck);
    safeInit('Timeline', initTimelineControls);
    safeInit('StorageDashboard', refreshStorageDashboard);

    const micWarning = $('mic-warning');
    if (!window.isSecureContext && micWarning) {
        micWarning.classList.remove('hidden');
        console.warn('Not a secure context, microphone APIs may be blocked');
    }

    window.addEventListener('beforeunload', () => {
        flushSessionSave();
        autoSaveSessionOnClassEnd('Session closed');
    });

    console.log('EchoVisual & QuickTalk AI Suite successfully loaded and ready!');
});


// ------------------------------------------------------------------


// ------------------------------------------------------------------

// ------------------------------------------------------------------
// WebRTC Video & Audio Conference Engine
// ------------------------------------------------------------------
let localStream = null;
const peerConnections = {}; // peer_id -> RTCPeerConnection
const iceCandidateQueues = {}; // peer_id -> Array of candidates
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

async function startLocalVideo() {
    try {
        console.log('[WebRTC] Requesting camera and microphone access...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            },
            audio: true
        });
        console.log('[WebRTC] Camera and microphone acquired successfully');
        addVideoElement(currentClientId, localStream, true);
        attachLocalStreamToPeers();
    } catch (err) {
        console.warn('[WebRTC] Video+Audio capture failed, trying audio only:', err);
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('[WebRTC] Audio-only stream acquired');
            addVideoElement(currentClientId, localStream, true);
            attachLocalStreamToPeers();
        } catch (err2) {
            console.warn('[WebRTC] Audio capture failed:', err2);
            showToast('Camera/Microphone not available. You can still watch the live session.', true);
        }
    }
}

function attachLocalStreamToPeers() {
    if (!localStream) return;
    Object.entries(peerConnections).forEach(([peerId, pc]) => {
        localStream.getTracks().forEach((track) => {
            const senders = pc.getSenders ? pc.getSenders() : [];
            const alreadyAdded = senders.some((s) => s.track === track);
            if (!alreadyAdded) {
                try {
                    pc.addTrack(track, localStream);
                    console.log(`[WebRTC] Attached local track (${track.kind}) to peer ${peerId}`);
                } catch (e) {
                    console.warn(`[WebRTC] Failed to add track to peer ${peerId}:`, e);
                }
            }
        });
    });
}

function stopLocalVideo() {
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            try { track.stop(); } catch (e) {}
        });
        localStream = null;
    }
    removeVideoElement(currentClientId);
    Object.keys(peerConnections).forEach((peerId) => {
        try { peerConnections[peerId].close(); } catch (e) {}
        delete peerConnections[peerId];
        delete iceCandidateQueues[peerId];
        removeVideoElement(peerId);
    });
}

function addVideoElement(peerId, stream, isLocal = false) {
    const grid = $('video-grid');
    const streamTrack = $('video-deck-streams') || grid;
    if (!grid || !streamTrack) return;

    grid.classList.remove('hidden');
    grid.classList.add('flex');

    let container = $(`video-container-${peerId}`);
    if (!container) {
        container = document.createElement('div');
        container.id = `video-container-${peerId}`;
        container.className = 'video-card relative shrink-0 h-24 sm:h-28 aspect-video rounded-xl bg-ink overflow-hidden border border-edge shadow-lg';

        const videoEl = document.createElement('video');
        videoEl.id = `video-${peerId}`;
        videoEl.className = 'video-stream w-full h-full object-cover rounded-xl';
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('autoplay', 'true');
        videoEl.setAttribute('playsinline', 'true');
        if (isLocal) {
            videoEl.muted = true;
            videoEl.setAttribute('muted', 'true');
            videoEl.style.transform = 'scaleX(-1)';
        }

        const badge = document.createElement('div');
        badge.className = 'absolute bottom-1.5 left-1.5 bg-panel/90 backdrop-blur border border-edge text-slate-200 text-[10px] px-2 py-0.5 rounded-md font-mono flex items-center gap-1.5 shadow-sm z-10';
        badge.innerHTML = isLocal
            ? `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> You`
            : `<span class="w-2 h-2 rounded-full bg-accent"></span> Peer ${escapeHtml(peerId.slice(0, 5))}`;

        container.appendChild(videoEl);
        container.appendChild(badge);
        streamTrack.appendChild(container);
    }

    const videoEl = $(`video-${peerId}`);
    if (videoEl && stream) {
        if (videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
        }
        videoEl.onloadedmetadata = () => {
            videoEl.play().catch((err) => console.warn(`[WebRTC] Video play error for ${peerId}:`, err));
        };
        videoEl.play().catch((err) => console.warn(`[WebRTC] Direct play error for ${peerId}:`, err));
    }
}

function removeVideoElement(peerId) {
    const container = $(`video-container-${peerId}`);
    if (container) container.remove();

    const streamTrack = $('video-deck-streams') || $('video-grid');
    const grid = $('video-grid');
    if (streamTrack && streamTrack.children.length === 0 && grid) {
        grid.classList.add('hidden');
        grid.classList.remove('flex');
    }
}

function handleQueuedIceCandidates(peerId, pc) {
    if (iceCandidateQueues[peerId] && pc && pc.remoteDescription && pc.remoteDescription.type) {
        const queue = iceCandidateQueues[peerId];
        delete iceCandidateQueues[peerId];
        queue.forEach((cand) => {
            try {
                pc.addIceCandidate(new RTCIceCandidate(cand)).catch((e) => console.warn('[WebRTC] Error adding queued ICE:', e));
            } catch (e) {
                console.warn('[WebRTC] Invalid queued ICE candidate:', e);
            }
        });
    }
}

function createPeerConnection(peerId, initiate = false) {
    if (peerConnections[peerId]) return peerConnections[peerId];

    console.log(`[WebRTC] Initializing RTCPeerConnection for ${peerId} (initiate=${initiate})`);
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[peerId] = pc;

    if (localStream) {
        localStream.getTracks().forEach((track) => {
            try {
                pc.addTrack(track, localStream);
                console.log(`[WebRTC] Added local track (${track.kind}) to new peer ${peerId}`);
            } catch (e) {
                console.warn(`[WebRTC] addTrack error for ${peerId}:`, e);
            }
        });
    }

    pc.ontrack = (event) => {
        console.log(`[WebRTC] Received remote track from ${peerId}:`, event.track.kind);
        let stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
        if (!stream) {
            stream = new MediaStream();
            stream.addTrack(event.track);
        }
        addVideoElement(peerId, stream, false);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWsMessage({
                type: 'webrtc_ice_candidate',
                target_peer: peerId,
                candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Peer ${peerId} connectionState: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            removeVideoElement(peerId);
        }
    };

    if (initiate) {
        pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
                console.log(`[WebRTC] Sending offer to ${peerId}`);
                sendWsMessage({
                    type: 'webrtc_offer',
                    target_peer: peerId,
                    offer: pc.localDescription,
                });
            })
            .catch((err) => console.warn('[WebRTC] Offer creation error:', err));
    }

    return pc;
}

// ------------------------------------------------------------------
// Online Classroom Lobby & Room Lifecycle
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Floating Draggable Video Deck Engine
// ------------------------------------------------------------------
function initDraggableVideoDeck() {
    const deck = $('video-grid');
    const handle = $('video-deck-drag-handle');
    const minBtn = $('minimize-video-deck-btn');
    const streams = $('video-deck-streams');

    if (minBtn && streams) {
        let isMinimized = false;
        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isMinimized = !isMinimized;
            streams.classList.toggle('hidden', isMinimized);
            minBtn.innerHTML = isMinimized
                ? '<svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
                : '<svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
            showToast(isMinimized ? 'Cameras minimized' : 'Cameras expanded');
        });
    }

    if (!deck || !handle) return;

    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseDown = (e) => {
        if (e.button !== 0 || e.target.closest('button') || e.target.closest('input')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = deck.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        deck.style.left = `${initialLeft}px`;
        deck.style.top = `${initialTop}px`;
        deck.style.right = 'auto';
        deck.style.bottom = 'auto';

        handle.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const pad = 8;
        const maxLeft = window.innerWidth - deck.offsetWidth - pad;
        const maxTop = window.innerHeight - deck.offsetHeight - pad;

        newLeft = Math.max(pad, Math.min(newLeft, maxLeft));
        newTop = Math.max(pad, Math.min(newTop, maxTop));

        deck.style.left = `${newLeft}px`;
        deck.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.cursor = 'grab';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    };

    const onTouchStart = (e) => {
        if (e.target.closest('button') || e.target.closest('input') || !e.touches[0]) return;
        isDragging = true;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;

        const rect = deck.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        deck.style.left = `${initialLeft}px`;
        deck.style.top = `${initialTop}px`;
        deck.style.right = 'auto';
        deck.style.bottom = 'auto';

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    };

    const onTouchMove = (e) => {
        if (!isDragging || !e.touches[0]) return;
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const pad = 8;
        const maxLeft = window.innerWidth - deck.offsetWidth - pad;
        const maxTop = window.innerHeight - deck.offsetHeight - pad;

        newLeft = Math.max(pad, Math.min(newLeft, maxLeft));
        newTop = Math.max(pad, Math.min(newTop, maxTop));

        deck.style.left = `${newLeft}px`;
        deck.style.top = `${newTop}px`;
    };

    const onTouchEnd = () => {
        isDragging = false;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onTouchStart, { passive: true });
}

function initLobby() {
    const openModalBtn = $('open-online-modal-btn');
    const navRoomsBtn = $('nav-rooms');

    // Hub page elements
    const hubJoinBtn = $('hub-join-btn');
    const hubCreateBtn = $('hub-create-btn');
    const hubRoomInput = $('hub-room-code-input');
    const hubNameInput = $('hub-name-input');
    const hubLeaveBtn = $('hub-leave-active-btn');
    const hubCopyBtn = $('hub-copy-active-btn');

    const handleJoin = async (roomCode, displayName) => {
        const code = (roomCode || '').trim().toUpperCase();
        const name = (displayName || '').trim() || 'Student';
        if (!code) {
            showToast('Please enter a 6-digit room code', true);
            return;
        }
        try {
            showToast(`Connecting to room ${code}...`);
            const res = await fetch(`${API_BASE}/api/rooms/${code}/validate`);
            const data = await res.json();
            if (data && (data.valid || data.exists)) {
                enterRoom(code, name);
                navigateToPage('classroom');
                showToast(`🎉 Joined online class ${code}!`);
            } else {
                enterRoom(code, name);
                navigateToPage('classroom');
                showToast(`🎉 Created & joined classroom ${code}!`);
            }
        } catch (e) {
            enterRoom(code, name);
            navigateToPage('classroom');
            showToast(`🎉 Joined classroom ${code}!`);
        }
    };

    const handleCreate = async (displayName) => {
        const name = (displayName || '').trim() || 'Teacher';
        try {
            showToast('Creating new live classroom...');
            const res = await fetch(`${API_BASE}/api/rooms/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host_name: name })
            });
            const data = await res.json();
            if (data && data.room_id) {
                enterRoom(data.room_id, name);
                navigateToPage('classroom');
                showToast(`✨ Classroom ${data.room_id} created!`);
            }
        } catch (e) {
            const fallbackCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            enterRoom(fallbackCode, name);
            navigateToPage('classroom');
            showToast(`✨ Classroom ${fallbackCode} created!`);
        }
    };

    if (openModalBtn) {
        openModalBtn.addEventListener('click', () => {
            navigateToPage('rooms');
        });
    }

    // Hub page listeners
    if (hubJoinBtn) {
        hubJoinBtn.addEventListener('click', () => {
            handleJoin(hubRoomInput?.value, hubNameInput?.value);
        });
    }

    if (hubCreateBtn) {
        hubCreateBtn.addEventListener('click', () => {
            handleCreate(hubNameInput?.value);
        });
    }

    if (hubLeaveBtn) {
        hubLeaveBtn.addEventListener('click', () => {
            leaveRoom();
            updateHubActiveCard();
            showToast('Left classroom');
        });
    }

    if (hubCopyBtn) {
        hubCopyBtn.addEventListener('click', () => {
            if (currentRoomId) copyToClipboard(currentRoomId, '📋 Room code copied!');
        });
    }

    // Quick demo room cards
    $$('.quick-room-card').forEach((card) => {
        card.addEventListener('click', () => {
            const code = card.dataset.room;
            if (code) handleJoin(code, 'Student');
        });
    });

    // Direct room joining via shared link, e.g. #room=ABC123
    const hash = window.location.hash || '';
    if (hash.includes('room=')) {
        const match = hash.match(/room=([A-Za-z0-9]+)/);
        if (match && match[1]) {
            setTimeout(() => handleJoin(match[1], 'Student'), 500);
        }
    }
}

function updateHubActiveCard() {
    const card = $('hub-active-session-card');
    const badge = $('nav-room-badge');
    const text = $('hub-active-room-text');
    if (!card) return;

    if (currentRoomId) {
        card.classList.remove('hidden');
        if (badge) badge.classList.remove('hidden');
        if (text) text.textContent = `Room: ${currentRoomId}`;
    } else {
        card.classList.add('hidden');
        if (badge) badge.classList.add('hidden');
    }
}

function enterRoom(roomId, displayName) {
    currentRoomId = roomId;
    updateHubActiveCard();

    // 1. Update Header UI Controls
    const openBtn = $('open-online-modal-btn');
    if (openBtn) openBtn.classList.add('hidden');

    const roomControls = $('room-controls');
    if (roomControls) {
        roomControls.classList.remove('hidden');
        roomControls.classList.add('flex');
    }

    const roomCodeDisplay = $('room-code-display');
    if (roomCodeDisplay) {
        roomCodeDisplay.textContent = `Room: ${roomId}`;
    }

    const copyBtn = $('copy-room-code-btn');
    if (copyBtn) {
        copyBtn.onclick = () => {
            copyToClipboard(roomId, `📋 Room code ${roomId} copied!`);
        };
    }

    const toggleVideoBtn = $('toggle-video-btn');
    if (toggleVideoBtn) {
        toggleVideoBtn.onclick = () => {
            if (localStream) {
                const videoTrack = localStream.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = !videoTrack.enabled;
                    toggleVideoBtn.classList.toggle('bg-red-500/20', !videoTrack.enabled);
                    showToast(videoTrack.enabled ? '📹 Camera on' : '📹 Camera off');
                }
            }
        };
    }

    const toggleAudioBtn = $('toggle-audio-btn');
    if (toggleAudioBtn) {
        toggleAudioBtn.onclick = () => {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    audioTrack.enabled = !audioTrack.enabled;
                    toggleAudioBtn.classList.toggle('bg-red-500/20', !audioTrack.enabled);
                    showToast(audioTrack.enabled ? '🎙️ Mic unmuted' : '🎙️ Mic muted');
                }
            }
        };
    }

    const leaveBtn = $('leave-class-btn');
    if (leaveBtn) {
        leaveBtn.onclick = () => leaveRoom();
    }

    // 2. Connect WebSocket to Room
    initLiveWebSocket(roomId);

    // 3. Display Floating Draggable Video Deck & Start WebRTC
    const grid = $('video-grid');
    if (grid) {
        grid.classList.remove('hidden');
        grid.classList.add('flex');
    }
    startLocalVideo().catch((e) => console.warn('WebRTC start error:', e));

    // 4. Navigate to Classroom Whiteboard View
    navigateToPage('classroom');
}

function leaveRoom() {
    autoSaveSessionOnClassEnd('Left online classroom');
    stopLocalVideo();
    if (wsSocket) {
        try { wsSocket.close(); } catch (e) {}
        wsSocket = null;
    }
    currentRoomId = null;
    updateHubActiveCard();

    const openBtn = $('open-online-modal-btn');
    if (openBtn) openBtn.classList.remove('hidden');

    const roomControls = $('room-controls');
    if (roomControls) {
        roomControls.classList.add('hidden');
        roomControls.classList.remove('flex');
    }

    const grid = $('video-grid');
    if (grid) {
        grid.classList.add('hidden');
        grid.classList.remove('flex');
    }

    showToast('👋 You left the online class room.');
}
