/**
 * @file logic-cah-client.js
 * @description Client-side logic for the Logic Cards Against Humanity game mode.
 * Manages socket events, dynamic UI rendering, and game phase transitions.
 */

const socket = io();

const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get("roomCode");
const playerName = urlParams.get("name");
const isHost = urlParams.get("isHost") === "true";

if (!roomCode || !playerName) {
    window.location.href = "/";
}

/** @type {Object|null} The latest game status received from the server. */
let currentStatus = null;

const roomInfoEl = document.getElementById("room-info");
const infoLabelEl = document.getElementById("info-label");
const promptBoxEl = document.getElementById("prompt-box");
const scoreboardEl = document.getElementById("scoreboard");
const statusLabelEl = document.getElementById("status-label");
const timerLabelEl = document.getElementById("timer-label");
const dynamicContainerEl = document.getElementById("dynamic-container");
const startGameBtn = document.getElementById("start-game-btn");

const numRounds = parseInt(urlParams.get("numRounds") || "2");
const timeLimit = parseInt(urlParams.get("timeLimit") || "30");
const numPrompts = parseInt(urlParams.get("numPrompts") || "2");

startGameBtn.style.display = isHost ? "inline-block" : "none";

startGameBtn.onclick = () => {
    socket.emit("start-game", {
        roomCode,
        gameMode: "LogicCAH",
        numRounds,
        timeLimit,
        numPrompts,
    });
    startGameBtn.style.display = "none";
};

roomInfoEl.textContent = `Room: ${roomCode} | Player: ${playerName} ${isHost ? "(Host)" : ""}`;

socket.emit("logiccah-rejoin-room", { roomCode, name: playerName, isHost });

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Clears all content from the dynamic container.
 */
function clearDynamic() {
    dynamicContainerEl.innerHTML = "";
}

/**
 * Escapes a string for safe insertion as HTML text content, preventing XSS.
 * @param {*} str - The value to escape (will be coerced to string).
 * @returns {string} HTML-escaped string.
 */
function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/**
 * Returns true if the local player is the current round decider.
 * @param {Object|null} status - The current game status object.
 * @returns {boolean}
 */
function isCurrentDecider(status) {
    return status?.currentDecider?.name === playerName;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

/**
 * Renders the scoreboard sidebar from the current game status.
 * @param {Object} status - The game status object containing scores and round info.
 */
function renderScoreboard(status) {
    if (!status || !Array.isArray(status.scores)) {
        scoreboardEl.textContent = "No score data yet.";
        return;
    }

    const deciderId = status.currentDecider?.id;
    const roundNum = Number(status.currentRound || 0) + 1;
    const totalRounds = Number(status.totalRounds || 0);

    const parts = status.scores.map((player) => {
        const isDeciderRow = player.playerId === deciderId;
        return `<div class="score-line">${escapeHtml(player.name)}: ${player.score}${isDeciderRow ? " ← Decider" : ""}</div>`;
    });

    parts.push('<hr class="score-divider">');
    parts.push(`<div class="score-line">Round: ${roundNum} / ${totalRounds}</div>`);
    parts.push(`<div class="score-line">Prompts this round: ${status.numPrompts}</div>`);
    if (status.timeLimit) {
        parts.push(`<div class="score-line">Time limit: ${status.timeLimit}s</div>`);
    }

    scoreboardEl.innerHTML = parts.join("");
}

/**
 * Renders the prompt display box from the current game status.
 * @param {Object} status - The game status object.
 */
function renderPrompts(status) {
    const prompts = Array.isArray(status?.currentPrompts) ? status.currentPrompts : [];

    if (!prompts.length) {
        promptBoxEl.textContent = "Waiting for prompts...";
        return;
    }

    promptBoxEl.textContent = prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n\n");
}

/**
 * Renders a full-width waiting message card in the dynamic container.
 * @param {string} message - The message to display.
 */
function renderWaiting(message) {
    clearDynamic();
    statusLabelEl.textContent = message;
    timerLabelEl.textContent = "";

    const card = document.createElement("div");
    card.className = "card";
    card.textContent = message;
    dynamicContainerEl.appendChild(card);
}

/**
 * Renders the answer submission form for non-decider players.
 * Creates one textarea per active prompt and a submit button.
 * @param {Object} status - The current game status object.
 */
function renderAnswerForm(status) {
    clearDynamic();

    const prompts = Array.isArray(status?.currentPrompts) ? status.currentPrompts : [];
    const textareas = [];

    statusLabelEl.textContent = "Type one answer for each prompt, then submit.";
    timerLabelEl.textContent = status?.timeLimit ? `Time limit: ${status.timeLimit} seconds` : "";

    const introCard = document.createElement("div");
    introCard.className = "card";
    introCard.textContent = "Answer the prompts!";
    dynamicContainerEl.appendChild(introCard);

    prompts.forEach((prompt, index) => {
        const card = document.createElement("div");
        card.className = "card";

        const label = document.createElement("div");
        label.className = "prompt-label";
        label.textContent = `Prompt ${index + 1}: ${prompt}`;

        const textarea = document.createElement("textarea");
        textarea.className = "answer-box";
        textarea.rows = 3;
        textarea.placeholder = `Enter answer for prompt ${index + 1}...`;

        card.appendChild(label);
        card.appendChild(textarea);
        dynamicContainerEl.appendChild(card);
        textareas.push(textarea);
    });

    const buttonRow = document.createElement("div");
    buttonRow.className = "bottom-row";

    const submitBtn = document.createElement("button");
    submitBtn.className = "primary-btn";
    submitBtn.textContent = "Submit Answers";
    submitBtn.onclick = () => {
        const answers = textareas.map((box) => box.value.trim());
        socket.emit("submit-answers", { roomCode, answers });
    };

    buttonRow.appendChild(submitBtn);
    dynamicContainerEl.appendChild(buttonRow);
}

/**
 * Renders the decider's anonymous submission selection view.
 * Each submission is shown as a card with a "Choose" button.
 * @param {Array<{playerId: string, answers: string[]}>} answerSets - The anonymized submissions.
 */
function renderDeciderChoices(answerSets) {
    clearDynamic();
    statusLabelEl.textContent = "Choose the anonymous response set you agree with most.";
    timerLabelEl.textContent = "";

    if (!Array.isArray(answerSets) || answerSets.length === 0) {
        renderWaiting("No submissions to show.");
        return;
    }

    answerSets.forEach((submission, index) => {
        const card = document.createElement("div");
        card.className = "card";

        const title = document.createElement("div");
        title.className = "submission-title";
        title.textContent = `Anonymous Submission ${index + 1}`;
        card.appendChild(title);

        const block = document.createElement("div");
        block.className = "submission-block";
        block.innerHTML = submission.answers.map((answer, i) => `${i + 1}. ${escapeHtml(answer)}`).join("<br><br>");
        card.appendChild(block);

        const chooseBtn = document.createElement("button");
        chooseBtn.className = "choice-btn";
        chooseBtn.textContent = "Choose this submission";
        chooseBtn.onclick = () => {
            socket.emit("decider-select", {
                roomCode,
                selectedPlayerId: submission.playerId,
            });
            renderWaiting("Choice made. Revealing winner...");
        };

        card.appendChild(chooseBtn);
        dynamicContainerEl.appendChild(card);
    });
}

/**
 * Renders the current game round state, updating scoreboard, prompts,
 * and the dynamic action area based on phase and player role.
 * @param {Object} status - The current game status object.
 */
function renderRound(status) {
    currentStatus = status;

    renderScoreboard(status);
    renderPrompts(status);

    const decider = isCurrentDecider(status);
    const deciderName = status.currentDecider?.name || "Unknown";
    infoLabelEl.textContent = `Current decider: ${deciderName}`;

    if (status.isGameOver) return;

    if (status.roundState === "WAITING_FOR_ANSWERS") {
        if (decider) {
            renderWaiting("You are the decider this round. Waiting for other players to submit answers...");
        } else {
            renderAnswerForm(status);
        }
        return;
    }

    if (status.roundState === "SHOWING_ANSWERS") {
        if (decider) {
            renderWaiting("Loading submissions...");
        } else {
            renderWaiting("Answers submitted. Waiting for decider to choose.");
        }
    }
}

/**
 * Renders the end-of-game final standings view.
 * @param {Array<{name: string, score: number}>} finalScores - Sorted final scores.
 */
function renderGameOver(finalScores) {
    clearDynamic();
    statusLabelEl.textContent = "Game over.";
    timerLabelEl.textContent = "";

    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h2");
    title.textContent = "Final Standings";
    card.appendChild(title);

    const standings = document.createElement("div");
    standings.className = "submission-block";
    standings.innerHTML = finalScores
        .map((player, index) => `${index + 1}. ${escapeHtml(player.name)}: ${player.score}`)
        .join("<br>");
    card.appendChild(standings);

    dynamicContainerEl.appendChild(card);
}

// ─── Socket Events ────────────────────────────────────────────────────────────

socket.on("game-started", ({ gameMode, status }) => {
    if (gameMode !== "LogicCAH") return;
    if (startGameBtn) startGameBtn.style.display = "none";
    renderRound(status);
});

socket.on("answers-submitted", ({ playerId, allSubmitted }) => {
    if (!currentStatus) return;

    if (isCurrentDecider(currentStatus)) {
        renderWaiting(
            allSubmitted
                ? "All answers submitted. Loading submissions..."
                : "A player submitted answers. Waiting for the rest..."
        );
        return;
    }

    if (playerId === socket.id) {
        renderWaiting("Answers submitted. Waiting for the rest of the round.");
    }
});

socket.on("show-answers", ({ answers, deciderName }) => {
    if (isCurrentDecider(currentStatus)) {
        infoLabelEl.textContent = `Current decider: ${deciderName}`;
        renderDeciderChoices(answers);
    } else {
        renderWaiting("The decider is reviewing the anonymous submissions.");
    }
});

socket.on("selected-player-revealed", ({ selectedPlayerName, points }) => {
    clearDynamic();
    statusLabelEl.textContent = `${selectedPlayerName} wins the round!`;
    timerLabelEl.textContent = "";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <h3 class="winner-title">Round Winner</h3>
        <div>${escapeHtml(selectedPlayerName)} gets the point.</div>
        <div class="winner-points">Total points: ${points}</div>
    `;
    dynamicContainerEl.appendChild(card);
});

socket.on("round-completed", ({ status }) => {
    renderRound(status);
});

socket.on("game-over", ({ finalScores }) => {
    renderGameOver(finalScores);
});

socket.on("error", (message) => {
    alert(message);
});

/**
 * Emits a leave-game event to the server and exits the current game.
 */
function leaveGame() {
    socket.emit("leave-game", { roomCode });
}
