/* EchoVisual & QuickTalk AI: Application Logic (v2.0) */
'use strict';

// ------------------------------------------------------------------
// Configuration & Constants
// ------------------------------------------------------------------
const API_BASE = window.location.origin;          // served by FastAPI
const CHUNK_FLUSH_MS = 8000;                      // finalize buffer every 8s
const MIN_API_GAP_MS = 4100;                      // 1 req / 4.1s -> max 14/min (safely < 15 RPM cap)
const MAX_TRANSCRIPT_CHARS = 4000;                // mirrors backend limit
const LAST_SESSION_KEY = 'echovisual_last_session';
const SAVED_SESSIONS_KEY = 'echovisual_saved_sessions';
const THEME_STORAGE_KEY = 'echovisual_theme';
const COLOR_MODE_KEY = 'echovisual_color_mode';

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const startBtn = document.getElementById('start-class-btn');
const statusPill = document.getElementById('status-pill');
const audioMeter = document.getElementById('audio-meter');
const micWarning = document.getElementById('mic-warning');

// Light/Dark Mode
const colorModeToggleBtn = document.getElementById('color-mode-toggle-btn');
const modeIcon = document.getElementById('mode-icon');
const modeText = document.getElementById('mode-text');

// Live Caption & Translation
const captionBody = document.getElementById('caption-body');
const captionFinal = document.getElementById('caption-final');
const captionInterim = document.getElementById('caption-interim');
const captionEmpty = document.getElementById('caption-empty');
const captionDot = document.getElementById('caption-dot');
const speakCaptionBtn = document.getElementById('speak-caption-btn');
const speakCaptionLabel = document.getElementById('speak-caption-label');
const copyCaptionBtn = document.getElementById('copy-caption-btn');
const downloadCaptionBtn = document.getElementById('download-caption-btn');
const clearCaptionBtn = document.getElementById('clear-caption-btn');

// Translation Tab & Elements
const tabOriginalBtn = document.getElementById('tab-original-btn');
const tabTranslatedBtn = document.getElementById('tab-translated-btn');
const transBadge = document.getElementById('trans-badge');
const captionLangSelect = document.getElementById('caption-lang-select');
const translateCaptionBtn = document.getElementById('translate-caption-btn');
const captionTranslatedBody = document.getElementById('caption-translated-body');
const translatedContentWrapper = document.getElementById('translated-content-wrapper');
const translatedEmpty = document.getElementById('translated-empty');
const translatedTextTarget = document.getElementById('translated-text-target');
const translatedActions = document.getElementById('translated-actions');
const translatedLangIndicator = document.getElementById('translated-lang-indicator');
const speakTranslatedBtn = document.getElementById('speak-translated-btn');
const copyTranslatedBtn = document.getElementById('copy-translated-btn');

// Diagram & Stream
const diagramContainer = document.getElementById('diagram-container');
const diagramSvgWrapper = document.getElementById('diagram-svg-wrapper');
const lastUpdate = document.getElementById('last-update');
const summaryList = document.getElementById('summary-list');
const termsList = document.getElementById('terms-list');
const errorBanner = document.getElementById('error-banner');

// Diagram Toolbar & Timeline Slider
const prevDiagramBtn = document.getElementById('prev-diagram-btn');
const nextDiagramBtn = document.getElementById('next-diagram-btn');
const diagramSlider = document.getElementById('diagram-slider');
const diagramCounter = document.getElementById('diagram-counter');
const liveFollowToggle = document.getElementById('live-follow-toggle');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const zoomLabel = document.getElementById('zoom-label');
const diagramFullscreenBtn = document.getElementById('diagram-fullscreen-btn');
const copyDiagramBtn = document.getElementById('copy-diagram-btn');
const copySummaryBtn = document.getElementById('copy-summary-btn');
const downloadSvgBtn = document.getElementById('download-svg-btn');
const downloadPngBtn = document.getElementById('download-png-btn');
const sessionDiagramBadge = document.getElementById('session-diagram-badge');

// Student Expression Board
const shorthandInput = document.getElementById('shorthand-input');
const charCount = document.getElementById('char-count');
const speakBtn = document.getElementById('speak-btn');
const clearBtn = document.getElementById('clear-btn');
const spokenLog = document.getElementById('spoken-log');

// AI Chatbot
const toggleChatBtn = document.getElementById('toggle-chat-btn');
const chatDrawer = document.getElementById('chat-drawer');
const closeChatBtn = document.getElementById('close-chat-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const chatIncludeContext = document.getElementById('chat-include-context');

// Session Storage Modal
const openStorageBtn = document.getElementById('open-storage-btn');
const storageModal = document.getElementById('storage-modal');
const closeStorageModalBtn = document.getElementById('close-storage-modal-btn');
const closeStorageModalBtn2 = document.getElementById('close-storage-modal-btn-2');
const statDiagrams = document.getElementById('stat-diagrams');
const statCaptions = document.getElementById('stat-captions');
const statTerms = document.getElementById('stat-terms');
const statStatus = document.getElementById('stat-status');
const saveCurrentSessionBtn = document.getElementById('save-current-session-btn');
const restoreLastSessionBtn = document.getElementById('restore-last-session-btn');
const savedSessionsList = document.getElementById('saved-sessions-list');
const downloadStudyGuideBtn = document.getElementById('download-study-guide-btn');
const downloadHtmlReportBtn = document.getElementById('download-html-report-btn');
const downloadTranscriptTxtBtn = document.getElementById('download-transcript-txt-btn');
const downloadSessionJsonBtn = document.getElementById('download-session-json-btn');

// Fullscreen & Toast
const fullscreenModal = document.getElementById('fullscreen-modal');
const fullscreenDiagramBody = document.getElementById('fullscreen-diagram-body');
const closeFullscreenBtn = document.getElementById('close-fullscreen-btn');
const toastContainer = document.getElementById('toast-container');

// ------------------------------------------------------------------
// State Variables
// ------------------------------------------------------------------
let sessionDiagrams = [];             // Array of { id, diagram_code, svg, summary_bullets, key_terms, timestamp, timeString }
let currentDiagramIndex = -1;         // 0-indexed currently viewed diagram
let sessionStartTime = null;
let currentZoom = 1.0;
let chatHistory = [];
let allSessionKeyTerms = new Set();
let spokenHistory = [];

// ------------------------------------------------------------------
// Theme & Color Mode (Dark / Light) Management
// ------------------------------------------------------------------
let currentColorMode = localStorage.getItem(COLOR_MODE_KEY) || 'dark';
let currentThemeClass = localStorage.getItem(THEME_STORAGE_KEY) || 'theme-indigo';

function applyThemeAndMode() {
    document.documentElement.className = `${currentColorMode} ${currentThemeClass}`;
    localStorage.setItem(COLOR_MODE_KEY, currentColorMode);
    localStorage.setItem(THEME_STORAGE_KEY, currentThemeClass);
    if (modeIcon && modeText) {
        modeIcon.textContent = currentColorMode === 'dark' ? '☀️' : '🌙';
        modeText.textContent = currentColorMode === 'dark' ? 'Light' : 'Dark';
    }
}

function initThemesAndModes() {
    applyThemeAndMode();

    if (colorModeToggleBtn) {
        colorModeToggleBtn.addEventListener('click', () => {
            currentColorMode = currentColorMode === 'dark' ? 'light' : 'dark';
            applyThemeAndMode();
            showToast(`Switched to ${currentColorMode.toUpperCase()} mode`);
        });
    }

    document.querySelectorAll('.theme-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentThemeClass = btn.dataset.theme;
            applyThemeAndMode();
            showToast(`Theme changed to ${btn.textContent.trim()}`);
        });
    });
}

function setTheme(themeClass) {
    currentThemeClass = themeClass;
    applyThemeAndMode();
}

// ------------------------------------------------------------------
// Toast Notification Utility
// ------------------------------------------------------------------
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast pointer-events-auto px-4 py-2.5 rounded-xl bg-panel border border-edge shadow-2xl text-xs font-mono text-slate-100 flex items-center gap-2 border-accent/40';
    toast.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
        <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2400);
}

function showError(message) {
    console.error('UI error:', message);
    errorBanner.textContent = message;
    errorBanner.classList.remove('invisible');
}

function clearError() {
    errorBanner.classList.add('invisible');
}

function stamp() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fileStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
}

// ------------------------------------------------------------------
// Mermaid Setup & Diagram Engine
// ------------------------------------------------------------------
mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrors: true });
let mermaidSeq = 0;

async function renderDiagram(code, recordHistory = true, customSummary = null, customTerms = null) {
    try {
        const clean = code.trim().replace(/^```(mermaid)?\s*/i, '').replace(/```$/, '');
        await mermaid.parse(clean);
        const id = `mermaid-graph-${++mermaidSeq}`;
        const { svg } = await mermaid.render(id, clean);

        const snapshot = {
            id: mermaidSeq,
            diagram_code: clean,
            svg: svg,
            summary_bullets: customSummary || [],
            key_terms: customTerms || [],
            timestamp: new Date().toISOString(),
            timeString: stamp(),
        };

        if (recordHistory) {
            sessionDiagrams.push(snapshot);
            snapshot.summary_bullets.forEach(b => {});
            (customTerms || []).forEach(t => allSessionKeyTerms.add(t));
            saveCurrentSessionToStorage();
        }

        const targetIndex = recordHistory ? sessionDiagrams.length - 1 : currentDiagramIndex;
        if (liveFollowToggle.checked || !recordHistory) {
            displayDiagramSnapshot(targetIndex);
        } else {
            updateTimelineControls();
        }

        clearError();
        console.log('Diagram rendered and recorded successfully');
        return true;
    } catch (err) {
        console.error('Mermaid render failed, keeping previous diagram:', err);
        showError('Gemini returned an invalid diagram. Keeping previous diagram on screen.');
        return false;
    }
}

function displayDiagramSnapshot(index) {
    if (index < 0 || index >= sessionDiagrams.length) return;
    currentDiagramIndex = index;
    const snap = sessionDiagrams[index];

    diagramSvgWrapper.innerHTML = `<div class="rise-in w-full flex items-center justify-center">${snap.svg}</div>`;
    lastUpdate.textContent = `diagram ${snap.timeString}`;

    renderSummary(snap.summary_bullets, snap.key_terms);
    updateTimelineControls();
}

function updateTimelineControls() {
    const count = sessionDiagrams.length;
    sessionDiagramBadge.textContent = String(count);

    if (count === 0) {
        diagramSlider.disabled = true;
        diagramSlider.min = '1';
        diagramSlider.max = '1';
        diagramSlider.value = '1';
        prevDiagramBtn.disabled = true;
        nextDiagramBtn.disabled = true;
        diagramCounter.textContent = '0 / 0';
        return;
    }

    diagramSlider.disabled = false;
    diagramSlider.min = '1';
    diagramSlider.max = String(count);
    diagramSlider.value = String(currentDiagramIndex + 1);

    prevDiagramBtn.disabled = currentDiagramIndex <= 0;
    nextDiagramBtn.disabled = currentDiagramIndex >= count - 1;
    diagramCounter.textContent = `${currentDiagramIndex + 1} / ${count}`;
}

function renderSummary(bullets, terms) {
    summaryList.innerHTML = (bullets && bullets.length)
        ? bullets.map(b => `<li class="rise-in flex gap-2"><span class="text-accent font-mono mt-[1px]">›</span><span>${escapeHtml(b)}</span></li>`).join('')
        : '<li class="text-slate-500 italic">No summary available.</li>';

    termsList.innerHTML = (terms && terms.length)
        ? terms.map(t => `<span class="rise-in px-2 py-0.5 rounded-md bg-accent/15 border border-accent/30 text-accent text-xs font-mono">${escapeHtml(t)}</span>`).join('')
        : '<span class="text-slate-500 italic text-sm">None detected.</span>';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// ------------------------------------------------------------------
// Diagram Timeline Slider Events
// ------------------------------------------------------------------
diagramSlider.addEventListener('input', (e) => {
    const targetIdx = Number(e.target.value) - 1;
    if (targetIdx !== currentDiagramIndex) {
        if (targetIdx < sessionDiagrams.length - 1) {
            liveFollowToggle.checked = false;
        }
        displayDiagramSnapshot(targetIdx);
    }
});

prevDiagramBtn.addEventListener('click', () => {
    if (currentDiagramIndex > 0) {
        liveFollowToggle.checked = false;
        displayDiagramSnapshot(currentDiagramIndex - 1);
    }
});

nextDiagramBtn.addEventListener('click', () => {
    if (currentDiagramIndex < sessionDiagrams.length - 1) {
        displayDiagramSnapshot(currentDiagramIndex + 1);
        if (currentDiagramIndex === sessionDiagrams.length - 1) {
            liveFollowToggle.checked = true;
        }
    }
});

// ------------------------------------------------------------------
// Diagram Zoom & Fullscreen Controls
// ------------------------------------------------------------------
function setZoom(level) {
    currentZoom = Math.min(2.5, Math.max(0.4, Number(level.toFixed(2))));
    diagramSvgWrapper.style.transform = `scale(${currentZoom})`;
    zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
}

zoomInBtn.addEventListener('click', () => setZoom(currentZoom + 0.15));
zoomOutBtn.addEventListener('click', () => setZoom(currentZoom - 0.15));
zoomResetBtn.addEventListener('click', () => setZoom(1.0));

diagramFullscreenBtn.addEventListener('click', () => {
    if (currentDiagramIndex >= 0 && sessionDiagrams[currentDiagramIndex]) {
        fullscreenDiagramBody.innerHTML = `<div class="max-w-5xl w-full">${sessionDiagrams[currentDiagramIndex].svg}</div>`;
        fullscreenModal.classList.remove('hidden');
    } else {
        showToast('No diagram to display fullscreen');
    }
});

closeFullscreenBtn.addEventListener('click', () => {
    fullscreenModal.classList.add('hidden');
});

// ------------------------------------------------------------------
// Copy & Download Actions
// ------------------------------------------------------------------
async function copyToClipboard(text, successMessage) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage);
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        showToast('Failed to copy to clipboard');
    }
}

copyCaptionBtn.addEventListener('click', () => {
    const fullText = (interimBuffer + (captionInterim.textContent || '')).trim();
    if (!fullText) {
        showToast('No captions to copy yet');
        return;
    }
    copyToClipboard(fullText, '📋 Live caption copied to clipboard!');
});

downloadCaptionBtn.addEventListener('click', () => {
    const fullText = (interimBuffer + (captionInterim.textContent || '')).trim();
    if (!fullText) {
        showToast('No captions to export');
        return;
    }
    downloadTextFile(`transcript_${fileStamp()}.txt`, fullText);
    showToast('Transcript text file downloaded');
});

clearCaptionBtn.addEventListener('click', () => {
    interimBuffer = '';
    sentLength = 0;
    captionFinal.textContent = '';
    captionInterim.textContent = '';
    captionEmpty.classList.remove('hidden');
    showToast('Captions cleared');
});

// ------------------------------------------------------------------
// Read Aloud Live Transcription (Text-to-Speech)
// ------------------------------------------------------------------
let captionSpeechUtterance = null;
let isReadingAloud = false;

function toggleSpeakCaptions() {
    if (!('speechSynthesis' in window)) {
        showToast('Speech synthesis not supported in this browser');
        return;
    }

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        isReadingAloud = false;
        speakCaptionBtn.classList.remove('speaking-active');
        speakCaptionLabel.textContent = 'Read Aloud';
        showToast('⏹️ Caption read-aloud stopped');
        return;
    }

    const fullText = (interimBuffer + (captionInterim.textContent || '')).trim();
    if (!fullText) {
        showToast('No caption text to speak aloud yet');
        return;
    }

    window.speechSynthesis.cancel();
    captionSpeechUtterance = new SpeechSynthesisUtterance(fullText);
    captionSpeechUtterance.rate = 1.0;
    captionSpeechUtterance.pitch = 1.0;

    captionSpeechUtterance.onstart = () => {
        isReadingAloud = true;
        speakCaptionBtn.classList.add('speaking-active');
        speakCaptionLabel.textContent = 'Stop Audio';
        showToast('🔊 Speaking live captions aloud...');
    };

    captionSpeechUtterance.onend = () => {
        isReadingAloud = false;
        speakCaptionBtn.classList.remove('speaking-active');
        speakCaptionLabel.textContent = 'Read Aloud';
    };

    captionSpeechUtterance.onerror = (e) => {
        console.error('Speech synthesis error:', e);
        isReadingAloud = false;
        speakCaptionBtn.classList.remove('speaking-active');
        speakCaptionLabel.textContent = 'Read Aloud';
    };

    window.speechSynthesis.speak(captionSpeechUtterance);
}

if (speakCaptionBtn) {
    speakCaptionBtn.addEventListener('click', toggleSpeakCaptions);
}

// ------------------------------------------------------------------
// Live Caption Multi-Language Translation
// ------------------------------------------------------------------
let currentTranslationText = '';
let currentTargetLanguage = 'Urdu (اردو)';

function initTranslationControls() {
    if (!tabOriginalBtn || !tabTranslatedBtn) return;

    tabOriginalBtn.addEventListener('click', () => {
        tabOriginalBtn.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-raised text-white transition-all shadow-sm';
        tabTranslatedBtn.className = 'px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 transition-all flex items-center gap-1';
        captionBody.classList.remove('hidden');
        captionTranslatedBody.classList.add('hidden');
        captionTranslatedBody.classList.remove('flex');
    });

    tabTranslatedBtn.addEventListener('click', () => {
        tabTranslatedBtn.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-raised text-white transition-all shadow-sm flex items-center gap-1';
        tabOriginalBtn.className = 'px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-slate-200 transition-all';
        captionBody.classList.add('hidden');
        captionTranslatedBody.classList.remove('hidden');
        captionTranslatedBody.classList.add('flex');
    });

    if (translateCaptionBtn) {
        translateCaptionBtn.addEventListener('click', translateLiveCaptions);
    }

    if (copyTranslatedBtn) {
        copyTranslatedBtn.addEventListener('click', () => {
            if (!currentTranslationText) {
                showToast('No translated text to copy');
                return;
            }
            copyToClipboard(currentTranslationText, '📋 Translated text copied to clipboard!');
        });
    }

    if (speakTranslatedBtn) {
        speakTranslatedBtn.addEventListener('click', () => {
            if (!currentTranslationText) {
                showToast('No translated text to read aloud');
                return;
            }
            speakTranslatedText(currentTranslationText, currentTargetLanguage);
        });
    }
}

async function translateLiveCaptions() {
    const rawText = (interimBuffer + (captionInterim.textContent || '')).trim();
    if (!rawText) {
        showToast('No speech transcript to translate yet');
        return;
    }

    const targetLang = captionLangSelect.value;
    currentTargetLanguage = targetLang;

    // Switch to translated view
    tabTranslatedBtn.click();
    translatedEmpty.classList.add('hidden');
    translatedActions.classList.add('hidden');
    translatedActions.classList.remove('flex');
    translatedTextTarget.innerHTML = `
        <div class="flex items-center gap-2 text-sm text-accent py-8">
            <span class="w-2.5 h-2.5 rounded-full bg-accent animate-ping"></span>
            <span>Translating classroom transcript into <strong>${escapeHtml(targetLang)}</strong>...</span>
        </div>
    `;

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
        translatedTextTarget.className = isRtl
            ? 'urdu-script text-right text-xl md:text-2xl leading-loose text-slate-100'
            : 'text-base md:text-lg leading-relaxed text-slate-100';
        translatedTextTarget.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
        translatedTextTarget.textContent = currentTranslationText;

        transBadge.textContent = targetLang.split(' ')[0];
        transBadge.classList.remove('hidden');

        translatedLangIndicator.textContent = `Translated: ${targetLang}`;
        translatedActions.classList.remove('hidden');
        translatedActions.classList.add('flex');

        showToast(`🌐 Translated into ${targetLang}!`);
    } catch (err) {
        console.error('Translation error:', err);
        translatedTextTarget.innerHTML = `<span class="text-xs text-red-400 font-mono">Translation failed: ${escapeHtml(err.message)}</span>`;
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

copyDiagramBtn.addEventListener('click', () => {
    if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
        showToast('No diagram available to copy');
        return;
    }
    copyToClipboard(sessionDiagrams[currentDiagramIndex].diagram_code, '📊 Mermaid code copied!');
});

copySummaryBtn.addEventListener('click', () => {
    if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
        showToast('No summary to copy');
        return;
    }
    const snap = sessionDiagrams[currentDiagramIndex];
    const text = `Summary:\n${snap.summary_bullets.map(b => `- ${b}`).join('\n')}\n\nKey Terms: ${snap.key_terms.join(', ')}`;
    copyToClipboard(text, '📝 Summary copied!');
});

downloadSvgBtn.addEventListener('click', () => {
    if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
        showToast('No diagram to download');
        return;
    }
    const snap = sessionDiagrams[currentDiagramIndex];
    downloadTextFile(`diagram_${snap.id}_${fileStamp()}.svg`, snap.svg);
    showToast('SVG diagram downloaded');
});

downloadPngBtn.addEventListener('click', () => {
    if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
        showToast('No diagram to download');
        return;
    }
    const snap = sessionDiagrams[currentDiagramIndex];
    convertSvgToPngAndDownload(snap.svg, `diagram_${snap.id}_${fileStamp()}.png`);
});

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
            const scale = 2; // high resolution export
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
            showToast('Downloaded SVG (PNG rendering not supported by browser)');
        };
        img.src = blobURL;
    } catch (e) {
        console.error('PNG export failed:', e);
        downloadTextFile(filename.replace('.png', '.svg'), svgString, 'image/svg+xml');
    }
}

// ------------------------------------------------------------------
// Live Captioning (Module 1: Teacher -> Student)
// ------------------------------------------------------------------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let interimBuffer = '';
let sentLength = 0;
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
        if (isListening) {
            console.log('Recognition ended, auto-restarting');
            try { recognition.start(); } catch (e) { /* already started */ }
        }
    };
}

function renderCaption(interimText) {
    captionFinal.textContent = interimBuffer;
    captionInterim.textContent = interimText ? interimText : '';
    const hasContent = (interimBuffer + interimText).trim().length > 0;
    captionEmpty.classList.toggle('hidden', hasContent);
    captionBody.scrollTop = captionBody.scrollHeight;
    saveCurrentSessionToStorage();
}

function startListening() {
    if (!recognition) return;
    if (!sessionStartTime) sessionStartTime = new Date();
    isListening = true;
    captionDot.classList.replace('bg-slate-600', 'bg-emerald-400');
    captionDot.classList.add('animate-pulse');
    try {
        recognition.start();
        console.log('Listening started');
    } catch (e) {
        console.warn('Recognition start threw:', e.message);
    }
    startBtn.textContent = 'Stop Class';
    startBtn.classList.replace('bg-accent', 'bg-red-600');
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
    startBtn.classList.replace('bg-red-600', 'bg-accent');
    audioMeter.classList.replace('flex', 'hidden');
    setStatus('idle', 'bg-raised text-slate-400 border-edge');
    captionDot.classList.remove('animate-pulse');
    captionDot.classList.replace('bg-emerald-400', 'bg-slate-600');
    saveCurrentSessionToStorage();
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
        interimBuffer = interimBuffer.slice(-4000);
        sentLength = 0;
    }
    console.log(`Chunk sent (${chunk.length} chars): "${chunk.slice(0, 60)}..."`);
    enqueueApiTask('diagram', chunk);
}

// ------------------------------------------------------------------
// Rate-limited API Queue
// ------------------------------------------------------------------
const apiQueue = [];
let queueRunning = false;
let lastApiCallAt = 0;

function enqueueApiTask(kind, payload) {
    if (kind === 'diagram') {
        const last = apiQueue[apiQueue.length - 1];
        if (last && last.kind === 'diagram') {
            last.payload = payload;
            console.log('Chunk merged into queued request');
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

async function sendTranscriptChunk(transcript) {
    setStatus('generating', 'bg-accent/15 text-accent border-accent/30');
    lastUpdate.textContent = 'generating…';
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
    if (typeof data.diagram_code !== 'string' || !Array.isArray(data.summary_bullets) || !Array.isArray(data.key_terms)) {
        throw new Error('Invalid response shape from backend');
    }
    await renderDiagram(data.diagram_code, true, data.summary_bullets, data.key_terms);
    if (isListening) {
        setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
    }
}

// ------------------------------------------------------------------
// Module 2: Student Expression Board (Shorthand refinement + Speech)
// ------------------------------------------------------------------
async function refineAndSpeak(text) {
    speakBtn.disabled = true;
    setStatus('refining', 'bg-accent/15 text-accent border-accent/30');
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
        speak(data.refined_text);
    } catch (err) {
        console.error('Speech pipeline failed, speaking raw input instead:', err.message);
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
    window.speechSynthesis.speak(utterance);
    logSpoken(text);
}

function logSpoken(text) {
    const item = { time: stamp(), text };
    spokenHistory.push(item);
    const li = document.createElement('li');
    li.className = 'rise-in bg-ink border border-edge rounded-lg px-3 py-2 text-slate-300 flex items-start gap-2.5';
    li.innerHTML = `<span class="font-mono text-[10px] text-slate-500 mt-[3px] shrink-0">${item.time}</span><span></span>`;
    li.lastElementChild.textContent = text;
    if (spokenLog.firstElementChild && spokenLog.firstElementChild.classList.contains('italic')) {
        spokenLog.innerHTML = '';
    }
    spokenLog.prepend(li);
    while (spokenLog.children.length > 20) spokenLog.lastChild.remove();
    saveCurrentSessionToStorage();
}

function setStatus(label, classes) {
    statusPill.textContent = label;
    statusPill.className = `font-mono text-[11px] px-3 py-1.5 rounded-full border ${classes}`;
}

// ------------------------------------------------------------------
// AI Chatbot Assistant
// ------------------------------------------------------------------
toggleChatBtn.addEventListener('click', () => {
    chatDrawer.classList.toggle('hidden');
    if (!chatDrawer.classList.contains('hidden')) {
        chatInput.focus();
    }
});

closeChatBtn.addEventListener('click', () => {
    chatDrawer.classList.add('hidden');
});

clearChatBtn.addEventListener('click', () => {
    chatHistory = [];
    chatMessages.innerHTML = `
        <div class="chat-msg chat-msg-bot flex gap-2.5 items-start">
            <div class="w-6 h-6 rounded-md bg-accent/20 text-accent flex items-center justify-center shrink-0 text-xs mt-0.5">🤖</div>
            <div class="bg-raised border border-edge rounded-xl p-3 text-xs text-slate-200 max-w-[85%] leading-relaxed">
                Chat cleared. Ask me anything about the lecture concepts, diagrams, or key terms!
            </div>
        </div>
    `;
    showToast('Chat history cleared');
});

document.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const promptText = chip.dataset.prompt;
        chatInput.value = promptText;
        chatForm.dispatchEvent(new Event('submit'));
    });
});

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = chatInput.value.trim();
    if (!query) return;

    chatInput.value = '';
    appendChatMessage('user', query);

    const loadingId = appendChatLoading();

    try {
        let contextText = '';
        if (chatIncludeContext.checked) {
            const currentTranscript = (interimBuffer + (captionInterim.textContent || '')).trim();
            const currentDiagram = sessionDiagrams[currentDiagramIndex];
            contextText = `RECENT TRANSCRIPT:\n${currentTranscript.slice(-2500) || 'None yet'}\n\n`;
            if (currentDiagram) {
                contextText += `CURRENT DIAGRAM MERMAID:\n${currentDiagram.diagram_code}\n`;
                contextText += `CURRENT SUMMARY: ${(currentDiagram.summary_bullets || []).join('; ')}\n`;
                contextText += `CURRENT KEY TERMS: ${(currentDiagram.key_terms || []).join(', ')}\n`;
            }
        }

        const res = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: query,
                context: contextText,
                history: chatHistory.slice(-6),
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `Server responded with ${res.status}`);
        }

        const data = await res.json();
        removeChatLoading(loadingId);
        appendChatMessage('assistant', data.reply);
        chatHistory.push({ role: 'user', content: query });
        chatHistory.push({ role: 'assistant', content: data.reply });
    } catch (err) {
        removeChatLoading(loadingId);
        appendChatMessage('assistant', `⚠️ Sorry, I couldn't reach the AI: ${err.message}`);
    }
});

function appendChatMessage(role, text) {
    const isUser = role === 'user';
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg flex gap-2.5 items-start ${isUser ? 'justify-end' : 'justify-start'} rise-in`;

    const bubble = document.createElement('div');
    bubble.className = isUser
        ? 'bg-accent text-white rounded-xl p-3 text-xs max-w-[85%] leading-relaxed shadow-sm'
        : 'bg-raised border border-edge rounded-xl p-3 text-xs text-slate-200 max-w-[85%] leading-relaxed';
    bubble.innerHTML = formatMarkdownChat(text);

    if (isUser) {
        wrapper.appendChild(bubble);
    } else {
        const avatar = document.createElement('div');
        avatar.className = 'w-6 h-6 rounded-md bg-accent/20 text-accent flex items-center justify-center shrink-0 text-xs mt-0.5';
        avatar.textContent = '🤖';
        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);
    }

    chatMessages.appendChild(wrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

let loadingCounter = 0;
function appendChatLoading() {
    const id = `chat-loading-${++loadingCounter}`;
    const wrapper = document.createElement('div');
    wrapper.id = id;
    wrapper.className = 'chat-msg flex gap-2.5 items-start justify-start rise-in';
    wrapper.innerHTML = `
        <div class="w-6 h-6 rounded-md bg-accent/20 text-accent flex items-center justify-center shrink-0 text-xs mt-0.5">🤖</div>
        <div class="bg-raised border border-edge rounded-xl p-3 text-xs text-slate-400 font-mono flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style="animation-delay:0.15s"></span>
            <span class="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style="animation-delay:0.3s"></span>
            <span class="ml-1">thinking...</span>
        </div>
    `;
    chatMessages.appendChild(wrapper);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
    clean = clean.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-ink border border-edge font-mono text-[11px]">$1</code>');
    clean = clean.replace(/\n/g, '<br/>');
    return clean;
}

// ------------------------------------------------------------------
// Session Storage & Export System (Feature 2)
// ------------------------------------------------------------------
function saveCurrentSessionToStorage() {
    const currentSession = {
        id: sessionStartTime ? sessionStartTime.getTime() : Date.now(),
        date: sessionStartTime ? sessionStartTime.toLocaleString() : new Date().toLocaleString(),
        transcript: interimBuffer,
        diagrams: sessionDiagrams,
        spokenLog: spokenHistory,
        keyTerms: Array.from(allSessionKeyTerms),
    };
    try {
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(currentSession));
    } catch (e) {
        console.warn('LocalStorage save failed:', e);
    }
}

function getSavedSessions() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_SESSIONS_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveCurrentSnapshot() {
    const currentSession = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        transcript: interimBuffer,
        diagrams: sessionDiagrams,
        spokenLog: spokenHistory,
        keyTerms: Array.from(allSessionKeyTerms),
    };
    const list = getSavedSessions();
    list.unshift(currentSession);
    while (list.length > 10) list.pop();
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
    renderSavedSessionsList();
    showToast('Session snapshot saved to storage!');
}

function renderSavedSessionsList() {
    const list = getSavedSessions();
    if (!list.length) {
        savedSessionsList.innerHTML = `
            <div class="text-xs text-slate-500 italic p-3 bg-raised rounded-xl border border-edge text-center">
                No saved sessions in archive. Click "Save Current Snapshot" above to save one.
            </div>
        `;
        return;
    }

    savedSessionsList.innerHTML = list.map((s, idx) => `
        <div class="p-3 bg-raised border border-edge rounded-xl flex items-center justify-between gap-3 text-xs">
            <div>
                <div class="font-semibold text-white">${escapeHtml(s.date)}</div>
                <div class="text-[11px] text-slate-400 font-mono mt-0.5">
                    ${s.diagrams ? s.diagrams.length : 0} diagrams • ${(s.transcript || '').length} chars
                </div>
            </div>
            <div class="flex items-center gap-1.5">
                <button onclick="restoreSessionByIndex(${idx})" class="px-2.5 py-1 rounded bg-panel hover:bg-edge text-slate-200 border border-edge font-mono">
                    Restore
                </button>
                <button onclick="deleteSessionByIndex(${idx})" class="p-1 rounded hover:bg-red-950 text-slate-400 hover:text-red-400">
                    <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5">
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
        storageModal.classList.add('hidden');
    }
};

window.deleteSessionByIndex = function(idx) {
    const list = getSavedSessions();
    list.splice(idx, 1);
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
    renderSavedSessionsList();
    showToast('Session deleted from archive');
};

function restoreSession(session) {
    if (!session) return;
    interimBuffer = session.transcript || '';
    sentLength = interimBuffer.length;
    captionFinal.textContent = interimBuffer;
    captionInterim.textContent = '';
    captionEmpty.classList.toggle('hidden', interimBuffer.trim().length > 0);

    sessionDiagrams = (session.diagrams || []).map(d => ({ ...d }));
    allSessionKeyTerms = new Set(session.keyTerms || []);

    if (session.spokenLog && Array.isArray(session.spokenLog)) {
        spokenHistory = session.spokenLog;
        spokenLog.innerHTML = '';
        spokenHistory.slice(-15).forEach(item => {
            const li = document.createElement('li');
            li.className = 'bg-ink border border-edge rounded-lg px-3 py-2 text-slate-300 flex items-start gap-2.5';
            li.innerHTML = `<span class="font-mono text-[10px] text-slate-500 mt-[3px] shrink-0">${item.time}</span><span>${escapeHtml(item.text)}</span>`;
            spokenLog.appendChild(li);
        });
    }

    if (sessionDiagrams.length > 0) {
        displayDiagramSnapshot(sessionDiagrams.length - 1);
    } else {
        updateTimelineControls();
    }

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
        storageModal.classList.add('hidden');
    } catch (e) {
        showToast('Failed to restore previous session');
    }
}

// ------------------------------------------------------------------
// Export & Download Generators
// ------------------------------------------------------------------
function exportMarkdownStudyGuide() {
    const fullTranscript = (interimBuffer + (captionInterim.textContent || '')).trim();
    let md = `# EchoVisual Classroom Study Guide\n\n`;
    md += `**Date:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
    md += `**Total Diagrams Generated:** ${sessionDiagrams.length}\n`;
    md += `**Key Terms Covered:** ${Array.from(allSessionKeyTerms).join(', ') || 'None'}\n\n`;
    md += `---\n\n`;

    md += `## 1. Visual Study Diagrams & Summaries\n\n`;
    if (sessionDiagrams.length === 0) {
        md += `*No diagrams recorded in this session.*\n\n`;
    } else {
        sessionDiagrams.forEach((snap, idx) => {
            md += `### Diagram ${idx + 1} (${snap.timeString})\n\n`;
            md += `\`\`\`mermaid\n${snap.diagram_code}\n\`\`\`\n\n`;
            md += `**Summary:**\n`;
            if (snap.summary_bullets && snap.summary_bullets.length) {
                snap.summary_bullets.forEach(b => { md += `- ${b}\n`; });
            } else {
                md += `- No summary points recorded.\n`;
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
    const fullTranscript = (interimBuffer + (captionInterim.textContent || '')).trim();
    const diagramsHtml = sessionDiagrams.map((snap, idx) => `
        <div style="background:#10141b; border:1px solid #212836; border-radius:12px; padding:20px; margin-bottom:24px;">
            <div style="font-family:monospace; color:#818cf8; font-size:12px; margin-bottom:8px;">DIAGRAM ${idx+1} • ${snap.timeString}</div>
            <div class="mermaid" style="display:flex; justify-content:center; margin:16px 0;">${escapeHtml(snap.diagram_code)}</div>
            <h4 style="color:#ffffff; margin:12px 0 6px 0;">Summary Points</h4>
            <ul style="color:#cbd5e1; font-size:14px; line-height:1.6;">
                ${(snap.summary_bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}
            </ul>
            <div style="margin-top:12px; display:flex; gap:6px; flex-wrap:wrap;">
                ${(snap.key_terms || []).map(t => `<span style="background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#818cf8; padding:2px 8px; border-radius:6px; font-size:12px; font-family:monospace;">${escapeHtml(t)}</span>`).join('')}
            </div>
        </div>
    `).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>EchoVisual Classroom Report — ${new Date().toLocaleDateString()}</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
    <script>mermaid.initialize({startOnLoad:true, theme:'dark'});</script>
    <style>
        body { background:#07090e; color:#f1f5f9; font-family:system-ui,-apple-system,sans-serif; margin:0; padding:32px 20px; }
        .container { max-width:900px; margin:0 auto; }
        h1 { color:#ffffff; font-size:24px; margin-bottom:4px; }
        .meta { font-family:monospace; color:#94a3b8; font-size:13px; margin-bottom:24px; }
        .section { background:#0d121c; border:1px solid #1e2a40; border-radius:16px; padding:24px; margin-bottom:24px; }
        .transcript-box { background:#07090e; border:1px solid #1e2a40; border-radius:12px; padding:16px; font-size:15px; line-height:1.7; color:#e2e8f0; max-height:400px; overflow-y:auto; }
    </style>
</head>
<body>
    <div class="container">
        <h1>EchoVisual & QuickTalk AI — Classroom Study Report</h1>
        <div class="meta">Recorded on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</div>

        <div class="section">
            <h2>Visual Learning Diagrams (${sessionDiagrams.length})</h2>
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
    showToast('🌐 HTML Study Report downloaded!');
}

function exportSessionJson() {
    const sessionObj = {
        app: 'EchoVisual & QuickTalk AI',
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        transcript: interimBuffer,
        diagrams: sessionDiagrams,
        spokenLog: spokenHistory,
        keyTerms: Array.from(allSessionKeyTerms),
    };
    downloadTextFile(`session-data_${fileStamp()}.json`, JSON.stringify(sessionObj, null, 2), 'application/json');
    showToast('💾 Session JSON backup downloaded!');
}

// ------------------------------------------------------------------
// Storage Modal Event Listeners
// ------------------------------------------------------------------
openStorageBtn.addEventListener('click', () => {
    statDiagrams.textContent = String(sessionDiagrams.length);
    statCaptions.textContent = `${(interimBuffer + (captionInterim.textContent || '')).length} chars`;
    statTerms.textContent = String(allSessionKeyTerms.size);
    statStatus.textContent = isListening ? 'Listening' : 'Idle';
    renderSavedSessionsList();
    storageModal.classList.remove('hidden');
});

closeStorageModalBtn.addEventListener('click', () => storageModal.classList.add('hidden'));
closeStorageModalBtn2.addEventListener('click', () => storageModal.classList.add('hidden'));
saveCurrentSessionBtn.addEventListener('click', saveCurrentSnapshot);
restoreLastSessionBtn.addEventListener('click', restoreLastSession);
downloadStudyGuideBtn.addEventListener('click', exportMarkdownStudyGuide);
downloadHtmlReportBtn.addEventListener('click', exportHtmlStudyReport);
downloadTranscriptTxtBtn.addEventListener('click', () => {
    downloadTextFile(`transcript_${fileStamp()}.txt`, (interimBuffer + (captionInterim.textContent || '')).trim());
    showToast('Transcript text file downloaded');
});
downloadSessionJsonBtn.addEventListener('click', exportSessionJson);

// ------------------------------------------------------------------
// Student Expression Board Event Wiring
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

if (!window.isSecureContext) {
    micWarning.classList.remove('hidden');
    console.warn('Not a secure context, microphone APIs may be blocked');
}

// ------------------------------------------------------------------
// Initialization
// ------------------------------------------------------------------
initThemesAndModes();
initTranslationControls();
updateTimelineControls();
console.log('EchoVisual & QuickTalk AI v2.0 ready');
