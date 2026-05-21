/**
 * @file code-typer-multiplayer.js
 * @description Frontend logic for the multiplayer version of Code Typer. Handles real-time Socket.IO
 * synchronization of typing progress, wpm calculations, and opponent progress bars.
 */

const socket = typeof io !== "undefined" ? io() : { emit: () => {}, on: () => {}, id: "test" };

let urlParams;
if (typeof window !== "undefined") {
    urlParams = new URLSearchParams(window.location.search);
} else {
    urlParams = new URLSearchParams("?roomCode=test&name=p1&isHost=true");
}
const roomCode = urlParams.get("roomCode");
const playerName = urlParams.get("name");
const isHost = urlParams.get("isHost") === "true";

if (typeof window !== "undefined") {
    if (!roomCode || !playerName) {
        window.location.href = "/";
    }
}

if (typeof document !== "undefined") {
    const roomInfoEl = document.getElementById("room-info");
    if (roomInfoEl) roomInfoEl.innerText = `Room: ${roomCode} | Player: ${playerName}`;

    if (isHost) {
        const startButton = document.getElementById("btn-start");
        const nextButton = document.getElementById("btn-next");
        if (startButton) startButton.classList.remove("hidden");
        if (nextButton) nextButton.classList.remove("hidden");
    }
}

let snippets = [];
let currentSnippet = null;
let opponents = {};

if (typeof fetch !== "undefined") {
    fetch("/code-typer-multiplayer/snippets.json")
        .then((res) => res.json())
        .then((data) => {
            snippets = data;
            socket.emit("codetyper-rejoin-room", { roomCode, name: playerName });
        });
}

socket.on("codetyper-set-snippet", (snippet) => {
    currentSnippet = snippet;
    document.getElementById("waiting-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.add("hidden");
    document.getElementById("game-screen").classList.remove("hidden");
    resetMatch();
});

socket.on("codetyper-progress-update", (playersData) => {
    opponents = playersData;
    renderOpponentProgress();

    // Update waiting screen list
    const playersList = document.getElementById("players-list");
    playersList.innerHTML = "";
    Object.values(opponents).forEach((p) => {
        const div = document.createElement("div");
        div.className = "player-item";
        div.textContent = p.name;
        playersList.appendChild(div);
    });

    checkIfAllFinished();
});

/**
 * Emits a host start event with a randomly selected snippet to all room players.
 */
function hostStart() {
    if (!snippets.length) return;
    const next = snippets[Math.floor(Math.random() * snippets.length)];
    socket.emit("codetyper-sync-snippet", { roomCode, snippet: next });
}

let startTime = null;
let timerInterval = null;
let started = false;
let typed = "";
let gameActive = false;

let displayEl = null;

if (typeof document !== "undefined") {
    displayEl = document.getElementById("code-display");
}

/**
 * Resets local match state and re-emits a room rejoin to sync server state.
 */
function resetMatch() {
    clearInterval(timerInterval);
    startTime = null;
    timerInterval = null;
    started = false;
    typed = "";
    gameActive = true;

    // Clean up stale error message from previous round
    const staleErr = document.getElementById("err-label-msg");
    if (staleErr) staleErr.remove();

    renderCode();
    updateNextKey();

    document.getElementById("stat-wpm").textContent = "0";
    document.getElementById("stat-acc").textContent = "100%";
    document.getElementById("stat-err").textContent = "0";
    document.getElementById("stat-time").textContent = "0s";

    // reset server state
    socket.emit("codetyper-rejoin-room", { roomCode, name: playerName });
}

/**
 * Renders the current snippet as individual character `<span>` elements
 * in the code display area.
 */
function renderCode() {
    displayEl.innerHTML = "";
    for (let i = 0; i < currentSnippet.code.length; i++) {
        const span = document.createElement("span");
        span.textContent = currentSnippet.code[i];
        if (i === 0) span.className = "char-cursor";
        displayEl.appendChild(span);
    }
}

/**
 * Re-renders all opponents' progress bars and labels in the opponent panel.
 */
function renderOpponentProgress() {
    const container = document.getElementById("opponent-progress");
    container.innerHTML = "";

    Object.keys(opponents).forEach((id) => {
        if (id === socket.id) return; // Don't show self
        const p = opponents[id];
        const pct = Math.floor(p.progress * 100);

        container.innerHTML += `
            <div class="progress-label">
                <span>${p.name}</span>
                <span>${p.isFinished ? p.time + "s" : pct + "% | " + p.wpm + " WPM"}</span>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${pct}%"></div>
            </div>
        `;
    });
}

/**
 * Checks whether all players have finished and triggers the results screen if so.
 */
function checkIfAllFinished() {
    const vals = Object.values(opponents);
    if (vals.length > 0 && vals.every((p) => p.isFinished)) {
        showResults();
    }
}

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
        } else if (ahead[0] === " ") {
            let count = 0;
            while (ahead[count] === " ") count++;
            typed += " ".repeat(count);
        }
    } else if (e.key === "Enter") {
        if (typed.length < code.length) typed += "\n";
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        if (typed.length < code.length) typed += e.key;
        // no-op: error tracking handled per-frame
    } else {
        return;
    }

    if (!started && typed.length > 0) {
        started = true;
        startTime = Date.now();
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            document.getElementById("stat-time").textContent = elapsed + "s";
        }, 500);
    }

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

    const elapsedMin = startTime ? (Date.now() - startTime) / 60000 : 0;
    const correctChars = typed.length - errors;
    const wpm = elapsedMin > 0 ? Math.round(correctChars / 5 / elapsedMin) : 0;
    const progress = Math.min(1, typed.length / code.length);

    refreshStats(typed, errors, wpm);
    updateNextKey();

    // Broadcast Progress
    socket.emit("codetyper-progress", { roomCode, progress, wpm });

    if (typed.length === code.length && errors === 0) {
        finishGame();
    } else if (typed.length === code.length && errors > 0) {
        document.getElementById("code-display").style.borderColor = "#ff6060";
        let errLabel = document.getElementById("err-label-msg");
        if (!errLabel) {
            errLabel = document.createElement("div");
            errLabel.id = "err-label-msg";
            errLabel.style.color = "#ff6060";
            errLabel.style.fontWeight = "bold";
            errLabel.style.marginTop = "10px";
            errLabel.innerText = "You have typos! Press Backspace and fix them to finish!";
            document.getElementById("game-screen").insertBefore(errLabel, document.getElementById("stats"));
        }
        setTimeout(() => {
            document.getElementById("code-display").style.borderColor = "#444";
        }, 300);
    }
});

/**
 * Updates the live stats display (WPM, accuracy, error count).
 * @param {string} typedText - The text typed so far.
 * @param {number} errorCount - Number of character mismatches.
 * @param {number} wpm - Calculated words per minute.
 */
function refreshStats(typedText, errorCount, wpm) {
    const accuracy =
        typedText.length > 0 ? Math.round(((typedText.length - errorCount) / typedText.length) * 100) : 100;

    document.getElementById("stat-wpm").textContent = wpm;
    document.getElementById("stat-acc").textContent = Math.max(0, accuracy) + "%";
    document.getElementById("stat-err").textContent = errorCount;
}

/**
 * Marks the local player as finished, emits the finish event to the server,
 * and displays a waiting message in the code display.
 */
function finishGame() {
    clearInterval(timerInterval);
    gameActive = false;

    const elapsed = Math.round((Date.now() - startTime) / 10) / 100;
    document.getElementById("stat-time").textContent = elapsed + "s";
    document.getElementById("code-display").innerHTML =
        "<h3 style='color:#6bcf6b; text-align:center;'>Done! Waiting for others to finish...</h3>";

    socket.emit("codetyper-finished", { roomCode, time: elapsed });
}

/**
 * Shows the final results screen once all players have finished.
 * Renders a sorted leaderboard by completion time.
 */
function showResults() {
    document.getElementById("game-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.remove("hidden");

    const leaderboard = document.getElementById("final-leaderboard");
    leaderboard.innerHTML = "";

    const sortedPlayers = Object.values(opponents).sort((a, b) => a.time - b.time);

    sortedPlayers.forEach((p, idx) => {
        const li = document.createElement("li");
        const rankClass = idx < 3 ? `rank-${idx + 1}` : "";
        li.innerHTML = `
            <span class="${rankClass}">#${idx + 1} ${p.name}</span>
            <span>${p.time}s (${p.wpm} WPM)</span>
        `;
        leaderboard.appendChild(li);
    });
}

/**
 * Maps a code character to its keyboard key label string.
 * @param {string} ch - A single character.
 * @returns {string} The key label ("Enter", "Tab", or lowercase char).
 */
function charToKey(ch) {
    if (ch === "\n") return "Enter";
    if (ch === "\t") return "Tab";
    return ch.toLowerCase();
}

/**
 * Highlights the keyboard key corresponding to the next character to type.
 */
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

/**
 * Emits a leave-game event and exits the current game room.
 */
function leaveGame() {
    socket.emit("leave-game", { roomCode });
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        charToKey,
        updateNextKey,
        resetMatch,
        refreshStats,
        finishGame,
        setSnippets: (s) => (snippets = s),
        getCurrentSnippet: () => currentSnippet,
        setCurrentSnippet: (s) => (currentSnippet = s),
    };
}
