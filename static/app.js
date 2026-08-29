/* ==========================================================================
   EchoVisual & QuickTalk AI - Multi-Page Application Logic (v3.0)
   5 Dedicated Views with Continuous Live Background Recording:
   1. 🎙️ Classroom View (#classroom): Live Speech + Urdu/Eng + Multi-Lang Translation + Visual Stream
   2. 🗣️ Student Expression Board (#expression): Full-page voice composer, Pakistani soundboards & spoken history
   3. 📚 Study Hub & Quiz Arena (#study): Structured study notes, interactive MCQs & 3D flashcards
   4. 🤖 AI Classroom Tutor (#tutor): Full-screen contextual conversational tutor (Roman Urdu & English)
   5. 💾 Session Storage & Downloads (#storage): Session archives, 1-click restore & multi-format export center
   ========================================================================== */

'use strict';

// ------------------------------------------------------------------
// Configuration & Constants
// ------------------------------------------------------------------
const API_BASE = window.location.origin;
const MIN_API_GAP_MS = 3500;
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
let mermaidSeq = 0;

// Speech Recognition State (Continuous Live Capture)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let interimBuffer = '';

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
// DOM Reference Utilities
// ------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

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
    return div.innerHTML;
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
const VALID_PAGES = ['classroom', 'expression', 'study', 'tutor', 'storage'];

function navigateToPage(pageName) {
    if (!VALID_PAGES.includes(pageName)) {
        pageName = 'classroom';
    }

    // Update URL hash without triggering double events
    if (window.location.hash !== `#${pageName}`) {
        window.location.hash = `#${pageName}`;
    }

    // Hide all views & remove active nav classes
    VALID_PAGES.forEach((p) => {
        const viewEl = $(`view-${p}`);
        if (viewEl) viewEl.classList.remove('active');

        const navLink = $(`nav-${p}`);
        if (navLink) navLink.classList.remove('active');
    });

    $$('.mobile-nav-link').forEach((link) => link.classList.remove('active'));

    // Show active page view & highlight links
    const activeView = $(`view-${pageName}`);
    if (activeView) activeView.classList.add('active');

    const activeNav = $(`nav-${pageName}`);
    if (activeNav) activeNav.classList.add('active');

    const activeMobileNav = document.querySelector(`.mobile-nav-link[data-page="${pageName}"]`);
    if (activeMobileNav) activeMobileNav.classList.add('active');

    // Page-specific on-enter hooks
    if (pageName === 'storage') {
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
}

// ------------------------------------------------------------------
// Mermaid Engine & Interactive Study Materials
// ------------------------------------------------------------------
try {
    if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrors: true });
    }
} catch (e) {
    console.warn('Mermaid initialization warning:', e);
}

async function renderDiagram(code, recordHistory = true, customSummary = null, customTerms = null, customNotes = null, customQuiz = null, customFlashcards = null) {
    try {
        const clean = (code || '').trim().replace(/^```(mermaid)?\s*/i, '').replace(/```$/, '');
        if (!clean) return false;

        let svg = '';
        if (typeof mermaid !== 'undefined') {
            await mermaid.parse(clean);
            const id = `mermaid-graph-${++mermaidSeq}`;
            const result = await mermaid.render(id, clean);
            svg = result.svg;
        } else {
            svg = `<pre class="text-xs font-mono text-slate-300 p-4">${escapeHtml(clean)}</pre>`;
        }

        const snapshot = {
            id: mermaidSeq,
            diagram_code: clean,
            svg: svg,
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
            saveCurrentSessionToStorage();
        }

        const targetIndex = recordHistory ? sessionDiagrams.length - 1 : currentDiagramIndex;
        const liveFollow = $('live-follow-toggle');
        if (!liveFollow || liveFollow.checked || !recordHistory) {
            displayDiagramSnapshot(targetIndex);
        } else {
            updateTimelineControls();
        }

        clearError();
        return true;
    } catch (err) {
        console.error('Mermaid render error:', err);
        showError('Gemini diagram syntax error. Showing previous diagram.');
        return false;
    }
}

function displayDiagramSnapshot(index) {
    if (index < 0 || index >= sessionDiagrams.length) return;
    currentDiagramIndex = index;
    const snap = sessionDiagrams[index];

    const wrapper = $('diagram-svg-wrapper');
    if (wrapper) {
        wrapper.innerHTML = `<div class="rise-in w-full h-full min-h-0 min-w-0 flex items-center justify-center">${snap.svg}</div>`;
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

            const isCorrect = selectedOpt.trim().toLowerCase() === correctOpt.trim().toLowerCase() ||
                              selectedOpt.slice(0, 2).toLowerCase() === correctOpt.slice(0, 2).toLowerCase();

            if (isCorrect) {
                btn.classList.add('correct');
                correctCount++;
                showToast('🎉 Correct answer!');
            } else {
                btn.classList.add('wrong');
                card.querySelectorAll('.quiz-option').forEach((b) => {
                    const optText = b.dataset.option || '';
                    if (optText.trim().toLowerCase() === correctOpt.trim().toLowerCase() ||
                        optText.slice(0, 2).toLowerCase() === correctOpt.slice(0, 2).toLowerCase()) {
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
// Zoom & Fullscreen Controls
// ------------------------------------------------------------------
function setZoom(factor) {
    zoomLevel = Math.max(0.5, Math.min(2.5, factor));
    const wrapper = $('diagram-svg-wrapper');
    if (wrapper) wrapper.style.transform = `scale(${zoomLevel})`;
    const label = $('zoom-label');
    if (label) label.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function initZoomAndFullscreen() {
    const zoomIn = $('zoom-in-btn');
    if (zoomIn) zoomIn.addEventListener('click', () => setZoom(zoomLevel + 0.15));
    const zoomOut = $('zoom-out-btn');
    if (zoomOut) zoomOut.addEventListener('click', () => setZoom(zoomLevel - 0.15));
    const zoomReset = $('zoom-reset-btn');
    if (zoomReset) zoomReset.addEventListener('click', () => setZoom(1.0));

    const slider = $('diagram-slider');
    if (slider) {
        slider.addEventListener('input', () => {
            const idx = parseInt(slider.value, 10) - 1;
            displayDiagramSnapshot(idx);
        });
    }

    const prevBtn = $('prev-diagram-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentDiagramIndex > 0) displayDiagramSnapshot(currentDiagramIndex - 1);
        });
    }

    const nextBtn = $('next-diagram-btn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (currentDiagramIndex < sessionDiagrams.length - 1) displayDiagramSnapshot(currentDiagramIndex + 1);
        });
    }

    const fsBtn = $('diagram-fullscreen-btn');
    const fsModal = $('fullscreen-modal');
    const fsBody = $('fullscreen-diagram-body');
    const closeFs = $('close-fullscreen-btn');

    if (fsBtn && fsModal && fsBody) {
        fsBtn.addEventListener('click', () => {
            if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
                showToast('No diagram to view in fullscreen');
                return;
            }
            fsBody.innerHTML = sessionDiagrams[currentDiagramIndex].svg;
            fsModal.classList.remove('hidden');
        });
    }
    if (closeFs && fsModal) {
        closeFs.addEventListener('click', () => fsModal.classList.add('hidden'));
    }

    const copyDiag = $('copy-diagram-btn');
    if (copyDiag) {
        copyDiag.addEventListener('click', () => {
            if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
                showToast('No diagram available to copy');
                return;
            }
            copyToClipboard(sessionDiagrams[currentDiagramIndex].diagram_code, '📊 Mermaid code copied!');
        });
    }

    const dlSvg = $('download-svg-btn');
    if (dlSvg) {
        dlSvg.addEventListener('click', () => {
            if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
                showToast('No diagram to download');
                return;
            }
            const snap = sessionDiagrams[currentDiagramIndex];
            downloadTextFile(`diagram_${snap.id}_${fileStamp()}.svg`, snap.svg);
            showToast('SVG diagram downloaded');
        });
    }

    const dlPng = $('download-png-btn');
    if (dlPng) {
        dlPng.addEventListener('click', () => {
            if (currentDiagramIndex < 0 || !sessionDiagrams[currentDiagramIndex]) {
                showToast('No diagram to download');
                return;
            }
            const snap = sessionDiagrams[currentDiagramIndex];
            convertSvgToPngAndDownload(snap.svg, `diagram_${snap.id}_${fileStamp()}.png`);
        });
    }
}

// ------------------------------------------------------------------
// Live Captioning & Urdu Audio Recognition
// ------------------------------------------------------------------
function initLiveSpeechRecognition() {
    const micLang = $('mic-lang-select');
    const startBtn = $('start-class-btn');
    const micWarning = $('mic-warning');

    if (!SpeechRecognition) {
        if (micWarning) micWarning.classList.remove('hidden');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.classList.add('opacity-40', 'cursor-not-allowed');
        }
        console.warn('SpeechRecognition not supported in this browser');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = micLang ? micLang.value : 'en-US';

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                interimBuffer += text + ' ';
            } else {
                interim += text;
            }
        }
        renderCaption(interim);
        scheduleAutoDiagramDebounced();
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
            try { recognition.start(); } catch (e) {}
        }
    };

    if (micLang) {
        micLang.addEventListener('change', () => {
            recognition.lang = micLang.value;
            showToast(`🎙️ Microphone set to ${micLang.options[micLang.selectedIndex].text}`);
            if (isListening) {
                try {
                    recognition.stop();
                    setTimeout(() => {
                        try { if (isListening) recognition.start(); } catch (e) {}
                    }, 150);
                } catch (e) {}
            }
        });
    }

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            isListening ? stopListening() : startListening();
        });
    }
}

function renderCaption(interimText) {
    const finalSpan = $('caption-final');
    const interimSpan = $('caption-interim');
    const emptyP = $('caption-empty');
    const body = $('caption-body');

    if (finalSpan) finalSpan.textContent = interimBuffer;
    if (interimSpan) interimSpan.textContent = interimText || '';
    if (emptyP) emptyP.classList.toggle('hidden', (interimBuffer + (interimText || '')).trim().length > 0);
    if (body) body.scrollTop = body.scrollHeight;

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
    // 1. Reset state variables
    interimBuffer = '';
    sessionDiagrams = [];
    currentDiagramIndex = -1;
    allSessionKeyTerms.clear();
    spokenHistory = [];
    sessionStartTime = new Date();
    lastAutoDiagramTranscript = '';
    lastAutoDiagramAt = 0;

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
    const diagWrapper = $('diagram-svg-wrapper');
    if (diagWrapper) {
        diagWrapper.innerHTML = `
            <div class="text-center max-w-sm select-none">
                <svg viewBox="0 0 24 24" class="w-8 h-8 md:w-9 md:h-9 mx-auto mb-2 text-slate-700" fill="none"
                     stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <path d="M10 6.5h7a2 2 0 0 1 2 2V14M14 17.5H7a2 2 0 0 1-2-2V10" />
                </svg>
                <p class="text-xs md:text-sm text-slate-400 font-medium">Start Class to generate visual diagrams live from speech.</p>
                <p class="font-mono text-[10px] md:text-[11px] text-slate-600 mt-1">speech recorded -> diagrams auto-update -> on-demand study materials</p>
            </div>
        `;
    }
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
    if (!recognition) return;

    // Reset and clear all previous session content when starting a new class
    resetClassroomForNewClass();

    isListening = true;

    const dot = $('caption-dot');
    if (dot) {
        dot.classList.replace('bg-slate-600', 'bg-emerald-400');
        dot.classList.add('animate-pulse');
    }

    try { recognition.start(); } catch (e) {}

    const startBtn = $('start-class-btn');
    if (startBtn) {
        startBtn.textContent = 'Stop Class';
        startBtn.classList.replace('bg-accent', 'bg-red-600');
    }

    const meter = $('audio-meter');
    if (meter) meter.classList.replace('hidden', 'flex');

    if (autoDiagramInterval) clearInterval(autoDiagramInterval);
    autoDiagramInterval = setInterval(() => checkAndTriggerAutoDiagram(), AUTO_DIAGRAM_INTERVAL_MS);

    setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
    showToast('🎙️ New class started! Previous content cleared. Live speech transcribing...');
}

function stopListening() {
    isListening = false;
    if (recognition) recognition.stop();

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
        startBtn.textContent = 'Start Class';
        startBtn.classList.replace('bg-red-600', 'bg-accent');
    }

    const meter = $('audio-meter');
    if (meter) meter.classList.replace('flex', 'hidden');

    const dot = $('caption-dot');
    if (dot) {
        dot.classList.remove('animate-pulse');
        dot.classList.replace('bg-emerald-400', 'bg-slate-600');
    }

    // Process any remaining speech captured right before stopping
    checkAndTriggerAutoDiagram(true);

    setStatus('idle', 'bg-raised text-slate-400 border-edge');

    // Automatically archive the session snapshot with a description if there was speech or diagrams
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (fullText.length > 0 || sessionDiagrams.length > 0) {
        autoSaveSessionOnClassEnd();
        showToast('💾 Class ended. Session snapshot automatically saved to storage archive!');
    } else {
        saveCurrentSessionToStorage();
        showToast('Class paused / mic stopped');
    }
}

// ------------------------------------------------------------------
// Transcript Helper
// ------------------------------------------------------------------
function getCurrentLectureTranscript() {
    let raw = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (!raw && typeof fullTranscript !== 'undefined' && fullTranscript) {
        raw = fullTranscript.trim();
    }
    return raw;
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
    if (typeof data.diagram_code !== 'string') {
        throw new Error('Invalid response shape from backend');
    }

    // Auto-generate ONLY diagram, summary, and key terms; notes, quiz, and flashcards remain on-demand
    await renderDiagram(
        data.diagram_code,
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
function toggleSpeakCaptions() {
    if (!('speechSynthesis' in window)) {
        showToast('Speech synthesis not supported in this browser');
        return;
    }

    const speakBtn = $('speak-caption-btn');
    const label = $('speak-caption-label');

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        isReadingAloud = false;
        if (speakBtn) speakBtn.classList.remove('speaking-active');
        if (label) label.textContent = 'Read Aloud';
        showToast('⏹️ Caption read-aloud stopped');
        return;
    }

    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    if (!fullText) {
        showToast('No caption text to speak aloud yet');
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
function initStudentExpressionBoard() {
    const input = $('shorthand-input');
    const count = $('char-count');
    const speakBtn = $('speak-btn');
    const clearBtn = $('clear-btn');
    const autoToggle = $('auto-speak-toggle');
    const toneSelect = $('shorthand-tone-select');
    const speedSlider = $('tts-speed-slider');
    const speedLabel = $('tts-speed-label');

    if (speedSlider && speedLabel) {
        speedSlider.addEventListener('input', () => {
            speedLabel.textContent = `${speedSlider.value}x`;
        });
    }

    if (input && count) {
        input.addEventListener('input', () => {
            count.textContent = String(input.value.length);
        });

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
            if (count) count.textContent = '0';
        });
    }

    if (clearBtn && input) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            if (count) count.textContent = '0';
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
}

async function refineAndSpeak(payload) {
    const rawShorthand = typeof payload === 'string' ? payload : (payload.shorthand || '');
    const tone = (typeof payload === 'object' && payload.tone) ? payload.tone : 'polite';
    if (!rawShorthand.trim()) return;

    const speakBtn = $('speak-btn');
    if (speakBtn) speakBtn.disabled = true;
    setStatus('refining', 'bg-accent/15 text-accent border-accent/30');

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
            }
        }
    } catch (err) {
        console.warn('Speech refinement failed, speaking raw input:', err.message);
    } finally {
        if (speakBtn) speakBtn.disabled = false;
        if (isListening) {
            setStatus('listening', 'bg-emerald-950 text-emerald-300 border-emerald-800');
        } else {
            setStatus('idle', 'bg-raised text-slate-400 border-edge');
        }
    }

    speak(refinedText, rawShorthand);
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
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(list));
        renderCustomPresets();
        showToast(`Saved preset: "${phrase.slice(0, 20)}..."`);
    }
}

function deleteCustomPreset(phrase) {
    let list = getSavedPresets();
    list = list.filter((p) => p !== phrase);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(list));
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
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent text-xs font-mono">
            <button class="custom-preset-btn hover:underline" data-text="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>
            <button class="del-preset-btn text-slate-400 hover:text-red-400 font-bold ml-1" data-phrase="${escapeHtml(phrase)}">×</button>
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
                contextString += `Current Diagram Mermaid Code:\n${currentDiag.diagram_code}\n\nSummary Points:\n${currentDiag.summary_bullets.join(', ')}\n\nKey Terms: ${currentDiag.key_terms.join(', ')}`;
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

function saveCurrentSessionToStorage() {
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    const desc = generateSessionDescription(fullText, sessionDiagrams, allSessionKeyTerms);
    const currentSession = {
        id: sessionStartTime ? sessionStartTime.getTime() : Date.now(),
        date: sessionStartTime ? sessionStartTime.toLocaleString() : new Date().toLocaleString(),
        description: desc,
        transcript: fullText,
        diagrams: [...sessionDiagrams],
        spokenLog: [...spokenHistory],
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
    } catch {
        return [];
    }
}

function autoSaveSessionOnClassEnd() {
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    const desc = generateSessionDescription(fullText, sessionDiagrams, allSessionKeyTerms);
    const sessionSnapshot = {
        id: sessionStartTime ? sessionStartTime.getTime() : Date.now(),
        date: sessionStartTime ? sessionStartTime.toLocaleString() : new Date().toLocaleString(),
        description: desc,
        transcript: fullText,
        diagrams: [...sessionDiagrams],
        spokenLog: [...spokenHistory],
        keyTerms: Array.from(allSessionKeyTerms),
    };

    const list = getSavedSessions();
    const existingIndex = list.findIndex((s) => s.id === sessionSnapshot.id);
    if (existingIndex >= 0) {
        list[existingIndex] = sessionSnapshot;
    } else {
        list.unshift(sessionSnapshot);
        while (list.length > 15) list.pop();
    }

    try {
        localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(sessionSnapshot));
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }

    renderSavedSessionsList();
    refreshStorageDashboard();
}

function saveCurrentSnapshot() {
    const fullText = (interimBuffer + ($('caption-interim')?.textContent || '')).trim();
    const desc = generateSessionDescription(fullText, sessionDiagrams, allSessionKeyTerms);
    const currentSession = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        description: desc,
        transcript: fullText,
        diagrams: [...sessionDiagrams],
        spokenLog: [...spokenHistory],
        keyTerms: Array.from(allSessionKeyTerms),
    };
    const list = getSavedSessions();
    list.unshift(currentSession);
    while (list.length > 15) list.pop();
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
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
            <div class="text-xs text-slate-500 italic p-4 bg-raised rounded-xl border border-edge text-center">
                No saved sessions in archive. Sessions are automatically saved when class ends.
            </div>
        `;
        return;
    }

    listEl.innerHTML = list.map((s, idx) => `
        <div class="p-4 bg-raised border border-edge rounded-2xl flex items-center justify-between gap-4 text-xs shadow-sm hover:border-accent/40 transition-colors">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-white text-sm">${escapeHtml(s.date)}</span>
                    <span class="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 font-medium truncate max-w-sm">
                        ${escapeHtml(s.description || 'Classroom Lecture Session')}
                    </span>
                </div>
                <div class="text-xs text-slate-400 font-mono mt-1">
                    ${s.diagrams ? s.diagrams.length : 0} diagrams • ${(s.transcript || '').length} chars • ${(s.keyTerms || []).length} key terms • ${(s.spokenLog || []).length} spoken questions
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button onclick="window.restoreSessionByIndex(${idx})" title="Restore session to Classroom & Study Hub"
                        class="px-3 py-1.5 rounded-lg bg-panel hover:bg-edge text-slate-200 border border-edge font-mono text-xs font-medium transition-colors">
                    Restore to View
                </button>
                <button onclick="window.deleteSessionByIndex(${idx})" title="Delete archived session"
                        class="p-1.5 rounded-lg hover:bg-red-950 text-slate-400 hover:text-red-400 transition-colors">
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
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(list));
    renderSavedSessionsList();
    showToast('Saved session removed');
};

function restoreSession(session) {
    if (!session) return;
    interimBuffer = session.transcript || '';
    sessionDiagrams = session.diagrams || [];
    spokenHistory = session.spokenLog || [];
    allSessionKeyTerms = new Set(session.keyTerms || []);

    renderCaption('');
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
            md += `\`\`\`mermaid\n${snap.diagram_code}\n\`\`\`\n\n`;
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
            <div class="mermaid" style="display:flex; justify-content:center; margin:16px 0;">${escapeHtml(snap.diagram_code)}</div>
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
        <h1>EchoVisual & QuickTalk AI - Classroom Study Report</h1>
        <div class="meta">Recorded on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</div>

        <div class="section">
            <h2>Visual Learning Diagrams, Notes & Quizzes (${sessionDiagrams.length})</h2>
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
        version: '3.0.0',
        exportedAt: new Date().toISOString(),
        transcript: interimBuffer,
        diagrams: sessionDiagrams,
        spokenLog: spokenHistory,
        keyTerms: Array.from(allSessionKeyTerms),
    };
    downloadTextFile(`session-data_${fileStamp()}.json`, JSON.stringify(sessionObj, null, 2), 'application/json');
    showToast('💾 Session JSON backup downloaded!');
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
// Application Initialization
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initThemesAndModes();
    initPageRouter();
    initLiveSpeechRecognition();
    initOnCommandGenerator();
    initStudyGenerators();
    initStudyTabs();
    initZoomAndFullscreen();
    initCaptionToolbar();
    initTranslationControls();
    initStudentExpressionBoard();
    initChatbot();
    initStorageActions();
    updateTimelineControls();
    refreshStorageDashboard();

    const micWarning = $('mic-warning');
    if (!window.isSecureContext && micWarning) {
        micWarning.classList.remove('hidden');
        console.warn('Not a secure context, microphone APIs may be blocked');
    }

    console.log('EchoVisual & QuickTalk AI v3.0 Multi-Page Suite initialized successfully');
});
