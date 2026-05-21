/**
 * @file code-typer.js
 * @description Frontend game logic for "Code Typer". Handles fetching snippets, typing
 * tracking, WPM calculation, dynamic charts, and UI updates.
 */

let snippets = [];
let currentSnippet = null;

if (typeof fetch !== "undefined" && typeof window !== "undefined") {
    fetch("/code-typer/snippets.json")
        .then((res) => res.json())
        .then((data) => {
            snippets = data;
            newGame();
        })
        .catch((err) => console.error("fetch err", err));
}

let startTime = null;
let timerInterval = null;
let sampleInterval = null;
let started = false;
let typed = "";
let gameActive = false;

// Per-second tracking for the chart
let wpmHistory = []; // { sec, wpm, rawWpm, errors }
let totalKeystrokes = 0;

let displayEl = null;

function initUI() {
    displayEl = document.getElementById("code-display");
}

if (typeof window !== "undefined") {
    document.addEventListener("DOMContentLoaded", initUI);
    // If DOM is already loaded
    if (document.readyState !== "loading") initUI();
}

function newGame() {
    clearInterval(timerInterval);
    clearInterval(sampleInterval);
    startTime = null;
    timerInterval = null;
    sampleInterval = null;
    started = false;
    typed = "";
    gameActive = true;
    wpmHistory = [];
    totalKeystrokes = 0;

    let next;
    do {
        next = snippets[Math.floor(Math.random() * snippets.length)];
    } while (snippets.length > 1 && next === currentSnippet);
    currentSnippet = next;

    renderCode();
    updateNextKey();

    document.getElementById("stat-wpm").textContent = "0";
    document.getElementById("stat-acc").textContent = "100%";
    document.getElementById("stat-err").textContent = "0";
    document.getElementById("stat-time").textContent = "0s";

    document.getElementById("game-screen").classList.remove("hidden");
    document.getElementById("result-screen").classList.add("hidden");
}

function renderCode() {
    displayEl.innerHTML = "";
    for (let i = 0; i < currentSnippet.code.length; i++) {
        const span = document.createElement("span");
        span.textContent = currentSnippet.code[i];
        if (i === 0) span.className = "char-cursor";
        displayEl.appendChild(span);
    }
}

// ── Sampling: record WPM every second for the chart ───
function sampleWpm() {
    const code = currentSnippet.code;
    const elapsedSec = (Date.now() - startTime) / 1000;
    if (elapsedSec < 0.5) return; // skip noise

    let errors = 0;
    for (let i = 0; i < typed.length; i++) {
        if (typed[i] !== code[i]) errors++;
    }
    const correct = typed.length - errors;
    const elapsedMin = elapsedSec / 60;
    const wpm = elapsedMin > 0 ? Math.round(correct / 5 / elapsedMin) : 0;
    const rawWpm = elapsedMin > 0 ? Math.round(typed.length / 5 / elapsedMin) : 0;

    wpmHistory.push({
        sec: Math.round(elapsedSec),
        wpm,
        rawWpm,
        errors,
    });
}

// ── Direct keyboard input handling ────────────────────
document.addEventListener("keydown", (e) => {
    if (!gameActive) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const code = currentSnippet.code;

    if (["Tab", "Backspace", "Enter", " "].includes(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
    }

    if (e.key === "Backspace") {
        if (typed.length > 0) typed = typed.slice(0, -1);
    } else if (e.key === "Tab") {
        const ahead = code.slice(typed.length);
        if (ahead[0] === "\t") {
            typed += "\t";
            totalKeystrokes++;
        } else if (ahead[0] === " ") {
            let count = 0;
            while (ahead[count] === " ") count++;
            typed += " ".repeat(count);
            totalKeystrokes += count;
        }
    } else if (e.key === "Enter") {
        if (typed.length < code.length) {
            typed += "\n";
            totalKeystrokes++;
        }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        if (typed.length < code.length) {
            typed += e.key;
            totalKeystrokes++;
        }
        // no-op: error tracking handled per-frame in refreshStats
    } else {
        return;
    }

    // Start timer on first real keystroke
    if (!started && typed.length > 0) {
        started = true;
        startTime = Date.now();
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            document.getElementById("stat-time").textContent = elapsed + "s";
        }, 500);
        sampleInterval = setInterval(sampleWpm, 1000);
    }

    // Highlight characters
    const spans = displayEl.querySelectorAll("span");
    let errors = 0;
    spans.forEach((span, i) => {
        span.className = "";
        if (i < typed.length) {
            if (typed[i] === code[i]) {
                span.className = "char-correct";
            } else {
                span.className = "char-wrong";
                errors++;
            }
        } else if (i === typed.length) {
            span.className = "char-cursor";
        }
    });

    refreshStats(typed, errors);
    updateNextKey();

    if (typed.length === code.length) {
        sampleWpm(); // one last sample
        finishGame(typed, errors);
    }
});

function refreshStats(typed, errors) {
    const correctChars = typed.length - errors;
    const elapsed = startTime ? (Date.now() - startTime) / 60000 : 0;
    const wpm = elapsed > 0 ? Math.round(correctChars / 5 / elapsed) : 0;
    const accuracy = typed.length > 0 ? Math.round((correctChars / typed.length) * 100) : 100;

    document.getElementById("stat-wpm").textContent = wpm;
    document.getElementById("stat-acc").textContent = accuracy + "%";
    document.getElementById("stat-err").textContent = errors;
}

function finishGame(typed, errors) {
    clearInterval(timerInterval);
    clearInterval(sampleInterval);
    gameActive = false;

    const elapsed = (Date.now() - startTime) / 1000;
    const elapsedMin = elapsed / 60;
    const correctChars = typed.length - errors;
    const wpm = elapsedMin > 0 ? Math.round(correctChars / 5 / elapsedMin) : 0;
    const rawWpm = elapsedMin > 0 ? Math.round(totalKeystrokes / 5 / elapsedMin) : 0;
    const accuracy = typed.length > 0 ? Math.round((correctChars / typed.length) * 100) : 100;

    // Consistency = 100% − coefficient of variation of WPM samples
    let consistency = 0;
    if (wpmHistory.length > 1) {
        const wpmVals = wpmHistory.map((s) => s.wpm);
        const mean = wpmVals.reduce((a, b) => a + b, 0) / wpmVals.length;
        const variance = wpmVals.reduce((a, v) => a + (v - mean) ** 2, 0) / wpmVals.length;
        const sd = Math.sqrt(variance);
        consistency = mean > 0 ? Math.round(Math.max(0, 100 - (sd / mean) * 100)) : 0;
    }

    // Characters: correct / incorrect / extra / missed
    let charCorrect = 0,
        charIncorrect = 0,
        charExtra = 0,
        charMissed = 0;
    const code = currentSnippet.code;
    for (let i = 0; i < Math.max(typed.length, code.length); i++) {
        if (i < typed.length && i < code.length) {
            if (typed[i] === code[i]) charCorrect++;
            else charIncorrect++;
        } else if (i >= code.length) {
            charExtra++;
        } else {
            charMissed++;
        }
    }

    // Populate result UI
    document.getElementById("res-wpm").textContent = wpm;
    document.getElementById("res-acc").textContent = accuracy + "%";
    document.getElementById("res-raw").textContent = rawWpm;
    document.getElementById("res-chars").textContent = `${charCorrect}/${charIncorrect}/${charExtra}/${charMissed}`;
    document.getElementById("res-consistency").textContent = consistency + "%";
    document.getElementById("res-time").textContent = Math.round(elapsed) + "s";
    document.getElementById("res-lang").textContent = currentSnippet.language;

    document.getElementById("guess-result").textContent = "";
    document.getElementById("lang-guess-input").value = "";

    document.getElementById("game-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.remove("hidden");

    drawChart();
}

// ── Chart drawing ─────────────────────────────────────
function drawChart() {
    const canvas = document.getElementById("result-chart");
    const wrap = document.getElementById("result-chart-wrap");
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    if (wpmHistory.length < 2) {
        ctx.fillStyle = "#646669";
        ctx.font = "14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("Not enough data for chart", W / 2, H / 2);
        return;
    }

    const PAD_L = 40,
        PAD_R = 40,
        PAD_T = 18,
        PAD_B = 28;
    const gw = W - PAD_L - PAD_R;
    const gh = H - PAD_T - PAD_B;

    const wpmVals = wpmHistory.map((s) => s.wpm);
    const rawVals = wpmHistory.map((s) => s.rawWpm);
    const errVals = wpmHistory.map((s) => s.errors);
    const maxWpm = Math.max(...wpmVals, ...rawVals, 10);
    const maxErr = Math.max(...errVals, 1);
    const timeMax = wpmHistory[wpmHistory.length - 1].sec || 1;

    function xPos(sec) {
        return PAD_L + (sec / timeMax) * gw;
    }
    function yWpm(v) {
        return PAD_T + gh - (v / maxWpm) * gh;
    }
    function yErr(v) {
        return PAD_T + gh - (v / maxErr) * gh;
    }

    // Grid lines + Y-axis labels (WPM)
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#646669";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
        const val = Math.round((maxWpm / steps) * i);
        const y = yWpm(val);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(W - PAD_R, y);
        ctx.stroke();
        ctx.fillText(val, PAD_L - 6, y + 3);
    }

    // Y-axis labels (Errors — right side)
    ctx.textAlign = "left";
    for (let i = 0; i <= Math.min(maxErr, 4); i++) {
        const val = Math.round((maxErr / Math.min(maxErr, 4)) * i);
        const y = yErr(val);
        ctx.fillText(val, W - PAD_R + 6, y + 3);
    }

    // X-axis labels (seconds)
    ctx.textAlign = "center";
    const xSteps = Math.min(wpmHistory.length, 10);
    const xInterval = Math.ceil(wpmHistory.length / xSteps);
    for (let i = 0; i < wpmHistory.length; i += xInterval) {
        const s = wpmHistory[i].sec;
        ctx.fillText(s, xPos(s), H - 4);
    }
    // Always show last
    ctx.fillText(wpmHistory[wpmHistory.length - 1].sec, xPos(timeMax), H - 4);

    // Axis labels
    ctx.save();
    ctx.fillStyle = "#646669";
    ctx.font = "9px monospace";
    ctx.translate(10, PAD_T + gh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Words per Minute", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#646669";
    ctx.font = "9px monospace";
    ctx.translate(W - 6, PAD_T + gh / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Errors", 0, 0);
    ctx.restore();

    // ── Draw raw WPM line (gray, behind) ──
    ctx.beginPath();
    ctx.strokeStyle = "rgba(120,120,120,0.5)";
    ctx.lineWidth = 2;
    wpmHistory.forEach((s, i) => {
        const x = xPos(s.sec);
        const y = yWpm(s.rawWpm);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ── Draw WPM line (blue, main) ──
    ctx.beginPath();
    ctx.strokeStyle = "#4db8ff";
    ctx.lineWidth = 2.5;
    wpmHistory.forEach((s, i) => {
        const x = xPos(s.sec);
        const y = yWpm(s.wpm);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots on WPM line
    wpmHistory.forEach((s) => {
        ctx.beginPath();
        ctx.arc(xPos(s.sec), yWpm(s.wpm), 3, 0, Math.PI * 2);
        ctx.fillStyle = "#4db8ff";
        ctx.fill();
    });

    // ── Error markers (red ×) ──
    ctx.fillStyle = "#ff6060";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    wpmHistory.forEach((s) => {
        if (s.errors > 0) {
            ctx.fillText("×", xPos(s.sec), yErr(s.errors) - 6);
        }
    });
}

function submitGuess() {
    const guess = document.getElementById("lang-guess-input").value.trim().toLowerCase();
    const actual = currentSnippet.language.toLowerCase();
    const resultEl = document.getElementById("guess-result");

    if (!guess) return;

    if (guess === actual) {
        resultEl.textContent = "Correct! It was " + currentSnippet.language + ".";
        resultEl.style.color = "#6bcf6b";
    } else {
        resultEl.textContent = "Nope! It was " + currentSnippet.language + ".";
        resultEl.style.color = "#ff6060";
    }
}

// ── Keyboard ──────────────────────────────────────────

function charToKey(ch) {
    if (ch === "\n") return "Enter";
    if (ch === "\t") return "Tab";
    return ch.toLowerCase();
}

function updateNextKey() {
    document.querySelectorAll(".key.next-key").forEach((k) => k.classList.remove("next-key"));

    if (!currentSnippet) return;
    const nextChar = currentSnippet.code[typed.length];
    if (nextChar === undefined) return;

    const keyVal = charToKey(nextChar);
    document.querySelectorAll(`.key[data-key="${CSS.escape(keyVal)}"]`).forEach((k) => k.classList.add("next-key"));
}

window.addEventListener("keydown", (e) => {
    const val = e.key === " " ? " " : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    document.querySelectorAll(`.key[data-key="${CSS.escape(val)}"]`).forEach((k) => k.classList.add("pressed"));
});

window.addEventListener("keyup", (e) => {
    const val = e.key === " " ? " " : e.key.length === 1 ? e.key.toLowerCase() : e.key;
    document.querySelectorAll(`.key[data-key="${CSS.escape(val)}"]`).forEach((k) => k.classList.remove("pressed"));
});

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        newGame,
        sampleWpm,
        refreshStats,
        finishGame,
        charToKey,
        updateNextKey,
        initUI,
        setSnippets: (s) => (snippets = s),
        getTyped: () => typed,
        setTyped: (t) => (typed = t),
        getCurrentSnippet: () => currentSnippet,
        setCurrentSnippet: (s) => (currentSnippet = s),
        setGameActive: (a) => (gameActive = a),
    };
}
