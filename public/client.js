/**
 * @file client.js
 * @description Core client-side logic for the Programmer Jackbox lobby. Handles Socket.IO connections,
 * room management, chat, rendering UI views, and game transitions.
 */

const socket = (() => {
    try {
        return window.io ? io() : null;
    } catch (err) {
        return null;
    }
})() || {
    emit: () => {},
    on: () => {},
    id: "",
};

// ============================================
// LOBBY STATE
// ============================================
let playerName = "";
let currentRoomCode = "";
let isHost = false;
let currentLobbyVisibility = "private";
let gamemodes = [];
let lastPlayerCount = 0;
let selectedGameMode = "";
let bugFixerState = null;
let bugFixerSelectedCards = [];
let prophuntState = null;
let cleanupSent = false;

function emitClientCleanup() {
    if (cleanupSent || !currentRoomCode) {
        return;
    }

    cleanupSent = true;
    socket.emit("client-cleanup", { roomCode: currentRoomCode });
}

window.addEventListener("beforeunload", emitClientCleanup);
window.addEventListener("pagehide", emitClientCleanup);

const STORAGE_KEY_NAME = "pjboxPlayerName";
const STORAGE_KEY_ROOMS = "pjboxRecentRooms";

function savePlayerName(name) {
    localStorage.setItem(STORAGE_KEY_NAME, name);
}

function addRecentRoom(code) {
    const normalized = code.toUpperCase();
    const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY_ROOMS) || "[]");
    const next = [normalized, ...rooms.filter((room) => room !== normalized)].slice(0, 5);
    localStorage.setItem(STORAGE_KEY_ROOMS, JSON.stringify(next));
    if (typeof window.renderRecentRooms === "function") {
        window.renderRecentRooms();
    }
}

function restorePersistentState() {
    const savedName = localStorage.getItem(STORAGE_KEY_NAME);
    if (savedName) {
        const input = document.getElementById("nameInput");
        if (input) input.value = savedName;
        const hint = document.getElementById("lastNameHint");
        if (hint) hint.textContent = `Last used: ${savedName}`;
    }
}

restorePersistentState();

fetch("/gamemodes.json")
    .then((response) => response.json())
    .then((data) => {
        gamemodes = Array.isArray(data) ? data : [];
        updateGamemodeOptions(lastPlayerCount);
    })
    .catch(() => {
        gamemodes = [];
    });

// ============================================
// NAME ENTRY & MENU
// ============================================

function submitName() {
    const name = document.getElementById("nameInput").value.trim();
    if (!/^[A-Za-z0-9 ]{1,}$/.test(name)) {
        alert("Name must be 1+ characters (letters, numbers, spaces)");
        return;
    }
    playerName = name;
    savePlayerName(name);
    const hint = document.getElementById("lastNameHint");
    if (hint) hint.textContent = `Last used: ${name}`;
    document.getElementById("nameEntry").classList.add("hidden");
    document.getElementById("menu").classList.remove("hidden");
}

function hostPrivateLobby() {
    socket.emit("host-room", { name: playerName, visibility: "private" });
}

function joinRandomLobby() {
    showRandomJoin();
}

function showRandomJoin() {
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("randomJoinSection").classList.remove("hidden");
    renderRandomGameChecklist();
}

function renderRandomGameChecklist() {
    const checklist = document.getElementById("randomGameChecklist");
    checklist.innerHTML = "";

    if (!Array.isArray(gamemodes) || gamemodes.length === 0) {
        checklist.innerText = "No games are available for random matchmaking.";
        return;
    }

    const mpModes = gamemodes.filter((m) => m.type !== "singleplayer");
    mpModes.forEach((mode) => {
        const id = `gamemode-${mode.name}`;
        const row = document.createElement("div");
        row.className = "checklist-item";
        row.innerHTML = `
            <label class="checklist-item__label" for="${id}">
                <input type="checkbox" id="${id}" name="randomGameMode" value="${mode.name}" class="checklist-item__checkbox">
                <span class="checklist-item__icon">${getGameIcon(mode.name)}</span>
                <span class="checklist-item__text">
                    <span class="checklist-item__name">${mode.displayName || mode.name}</span>
                    <span class="checklist-item__desc">${mode.description}</span>
                </span>
            </label>
        `;
        checklist.appendChild(row);
    });
}

function submitRandomJoinPreferences() {
    const selected = Array.from(document.querySelectorAll("input[name='randomGameMode']:checked"))
        .map((entry) => entry.value)
        .filter(Boolean);

    if (selected.length === 0) {
        alert("Select at least one game for random matchmaking.");
        return;
    }

    currentRoomCode = "";
    isHost = false;
    currentLobbyVisibility = "public";
    socket.emit("join-random-room", {
        name: playerName,
        preferredGameModes: selected,
    });
}

function showJoin() {
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("randomJoinSection").classList.add("hidden");
    document.getElementById("joinSection").classList.remove("hidden");
}

function joinLobby() {
    const code = document.getElementById("joinCode").value.trim().toUpperCase();
    if (code.length !== 6) {
        alert("Room code must be 6 characters");
        return;
    }
    socket.emit("join-room", { roomCode: code, name: playerName });
    addRecentRoom(code);
}

function back() {
    location.reload();
}

function backToMenu() {
    document.getElementById("randomJoinSection").classList.add("hidden");
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("singlePlayerSection").classList.add("hidden");
    document.getElementById("menu").classList.remove("hidden");
}

function showSinglePlayer() {
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("singlePlayerSection").classList.remove("hidden");
    renderSinglePlayerCards();
}

// ============================================
// SVG ICON MAP
// ============================================
const GAME_ICONS = {
    bugFixerGame: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="6" width="8" height="14"/><line x1="2" y1="10" x2="8" y2="10"/><line x1="16" y1="10" x2="22" y2="10"/><line x1="2" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="22" y2="16"/><line x1="9" y1="6" x2="8" y2="4"/><line x1="15" y1="6" x2="16" y2="4"/></svg>`,
    codeTyperMultiplayer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="21" x2="9" y2="19"/><line x1="3" y1="19" x2="5" y2="21"/></svg>`,
    LogicCAH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    programmerProphunt: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    codeTyper: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="16"/><line x1="6" y1="9" x2="6.01" y2="9"/><line x1="10" y1="9" x2="10.01" y2="9"/><line x1="14" y1="9" x2="14.01" y2="9"/><line x1="18" y1="9" x2="18.01" y2="9"/><line x1="8" y1="13" x2="8.01" y2="13"/><line x1="12" y1="13" x2="12.01" y2="13"/><line x1="16" y1="13" x2="16.01" y2="13"/><line x1="7" y1="17" x2="17" y2="17"/></svg>`,
    flexboxSpider: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    escapeTheLoop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    _default: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
};

function getGameIcon(name) {
    return GAME_ICONS[name] || GAME_ICONS._default;
}

function renderSinglePlayerCards() {
    const container = document.getElementById("singlePlayerCards");
    container.innerHTML = "";

    const spModes = gamemodes.filter((m) => m.type === "singleplayer");
    spModes.forEach((mode) => {
        const card = document.createElement("div");
        card.className = "game-card";
        card.innerHTML = `
            <div class="game-icon">${getGameIcon(mode.name)}</div>
            <div class="game-name">${mode.displayName || mode.name}</div>
            <div class="game-desc">${mode.description}</div>
        `;
        card.onclick = () => {
            window.location.href = mode.url;
        };
        container.appendChild(card);
    });
}

// ============================================
// SOCKET EVENTS — LOBBY
// ============================================

socket.on("room-created", (payload) => {
    const roomCode = typeof payload === "string" ? payload : payload.roomCode;
    const visibility = payload && typeof payload === "object" ? payload.visibility : "private";

    currentRoomCode = roomCode || "";
    cleanupSent = false;
    currentLobbyVisibility = visibility || "private";
    isHost = payload && typeof payload === "object" ? Boolean(payload.isHost) : true;

    document.getElementById("roomKey").innerText = roomCode || "-";
    document.getElementById("lobbyTypeLabel").innerText = visibility === "public" ? "Public" : "Private";
    document.getElementById("hostSection").classList.remove("hidden");
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("randomJoinSection").classList.add("hidden");

    if (payload && payload.selectedGame) {
        selectedGameMode = payload.selectedGame;
    }
});

socket.on("room-joined", ({ roomCode: code, hostId }) => {
    currentRoomCode = code;
    cleanupSent = false;
    isHost = false;
    // hostSection becomes visible when update-players fires
});

socket.on("join-error", (msg) => {
    alert("Error: " + msg);
    document.getElementById("joinCode").value = "";
});

socket.on("update-players", (payload) => {
    const players = Array.isArray(payload) ? payload : payload.players;
    const hostId = Array.isArray(payload) ? null : payload.hostId;
    const visibility = Array.isArray(payload) ? "private" : payload.visibility || "private";

    if (hostId) isHost = socket.id === hostId;
    lastPlayerCount = players.length;
    currentLobbyVisibility = visibility;

    // Show lobby for all players (host and joined)
    document.getElementById("hostSection").classList.remove("hidden");
    document.getElementById("menu").classList.add("hidden");
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("randomJoinSection").classList.add("hidden");

    // Update player table
    const table = document.getElementById("playerTable");
    table.innerHTML = "<tr><th>Name</th></tr>";
    players.forEach((p) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${p.name}${p.id === hostId ? " (Host)" : ""}</td>`;
        table.appendChild(row);
    });

    // Also update waiting player table if visible
    const waitingTable = document.getElementById("waitingPlayerTable");
    if (waitingTable) {
        waitingTable.innerHTML = "<tr><th>Name</th></tr>";
        players.forEach((p) => {
            const row = document.createElement("tr");
            row.innerHTML = `<td>${p.name}${p.id === hostId ? " (Host)" : ""}</td>`;
            waitingTable.appendChild(row);
        });
    }

    // Show room code only to host
    document.getElementById("roomCodeArea").classList.toggle("hidden", !isHost);
    document.getElementById("lobbySectionTitle").innerText = isHost ? "Hosting Lobby" : "Waiting for Host";
    document.getElementById("lobbyTypeLabel").innerText = visibility === "public" ? "Public" : "Private";

    // Show "Select a Game" button for host with 2–8 players in a private lobby
    const canStart = isHost && players.length >= 2 && players.length <= 8 && visibility !== "public";
    document.getElementById("selectGameButton").classList.toggle("hidden", !canStart);

    // Status message
    const statusMsg = document.getElementById("lobbyStatusMsg");
    if (!isHost) {
        statusMsg.innerText = `${players.length} player${players.length !== 1 ? "s" : ""} in lobby. Waiting for host to start...`;
        statusMsg.classList.remove("hidden");
    } else {
        const needed = Math.max(0, 2 - players.length);
        if (needed > 0) {
            statusMsg.innerText = `Need ${needed} more player${needed !== 1 ? "s" : ""} to start.`;
            statusMsg.classList.remove("hidden");
        } else {
            statusMsg.classList.add("hidden");
        }
    }

    updateGamemodeOptions(players.length);
    renderBugFixerControls();
    renderProphuntControls();
    renderTerminationControls();
});

// ============================================
// GAME HUB — HOST SELECTS A GAME
// ============================================

function showGameSelect() {
    document.getElementById("hostSection").classList.add("hidden");
    document.getElementById("gameHub").classList.remove("hidden");
    document.getElementById("gameHubPlayerCount").innerText =
        `${lastPlayerCount} player${lastPlayerCount !== 1 ? "s" : ""} in lobby`;
    renderGameModeCards();
    socket.emit("host-entering-gamehub", { roomCode: currentRoomCode });
}

function renderGameModeCards() {
    const container = document.getElementById("gameModeCards");
    container.innerHTML = "";
    selectedGameMode = "";
    document.getElementById("gameHubStartBtn").classList.add("hidden");
    document.getElementById("gameHubSettings").classList.add("hidden");

    const mpModes = gamemodes.filter((m) => m.type !== "singleplayer");
    mpModes.forEach((mode) => {
        const card = document.createElement("div");
        card.className = "game-card";
        const meets = lastPlayerCount >= mode.minPlayers;
        if (!meets) card.classList.add("unavailable");
        card.innerHTML = `
            <div class="game-icon">${getGameIcon(mode.name)}</div>
            <div class="game-name">${mode.displayName || mode.name}</div>
            <div class="game-desc">${mode.description}</div>
            <div class="game-min">Min: ${mode.minPlayers} player${mode.minPlayers !== 1 ? "s" : ""}</div>`;
        if (meets) card.onclick = () => selectGameMode(mode);
        container.appendChild(card);
    });
}

function selectGameMode(mode) {
    document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
    const idx = gamemodes.indexOf(mode);
    const cards = document.querySelectorAll(".game-card");
    if (cards[idx]) cards[idx].classList.add("selected");

    selectedGameMode = mode.name;
    renderGameHubSettings(mode);
    document.getElementById("gameHubStartBtn").classList.remove("hidden");
    socket.emit("select-gamemode", { roomCode: currentRoomCode, gameMode: mode.name });
}

function renderGameHubSettings(mode) {
    const area = document.getElementById("gameHubSettings");
    area.classList.remove("hidden");

    if (mode.launchType === "redirect") {
        area.innerHTML = `<p>This is a standalone game. All players will be redirected to <strong>${mode.url}</strong> when launched.</p>`;
        return;
    }

    if (mode.name === "bugFixerGame") {
        area.innerHTML = `
            <h3>Bug Fixer Settings</h3>
            <label>Points to win:</label>
            <input id="bugFixerPointsToWinInput" type="number" min="1" value="5">
            <label>Player submit timer (seconds, 0 = off):</label>
            <input id="bugFixerSubmissionSecondsInput" type="number" min="0" value="0">
            <label>Decider pick timer (seconds, 0 = off):</label>
            <input id="bugFixerDeciderSecondsInput" type="number" min="0" value="0">
            <label>If decider times out:</label>
            <select id="bugFixerDeciderTimeoutAction">
                <option value="no-point">No point awarded</option>
                <option value="lowest-score">Award point to lowest-score player</option>
            </select>`;
    } else if (mode.name === "LogicCAH") {
        area.innerHTML = `
            <h3>Logic CAH Settings</h3>
            <label>Number of Rounds:</label>
            <select id="numRounds">
                <option value="1">1 Round</option>
                <option value="2" selected>2 Rounds</option>
                <option value="3">3 Rounds</option>
                <option value="5">5 Rounds</option>
            </select>
            <label>Time Limit (seconds):</label>
            <input id="timeLimit" type="number" value="30" min="10" max="300">
            <label>Prompts per Round:</label>
            <input id="numPrompts" type="number" value="2" min="1" max="5">`;
    } else if (mode.name === "programmerProphunt") {
        area.innerHTML = `
            <h3>Programmer Prophunt Settings</h3>
            <label>Number of Rounds:</label>
            <select id="numRounds">
                <option value="1">1 Round</option>
                <option value="2" selected>2 Rounds</option>
                <option value="3">3 Rounds</option>
                <option value="5">5 Rounds</option>
            </select>
            <label>Time Limit (seconds):</label>
            <input id="timeLimit" type="number" value="30" min="10" max="300">
            <label>Code Complexity:</label>
            <select id="complexity">
                <option value="easy">Easy</option>
                <option value="medium" selected>Medium</option>
                <option value="hard">Hard</option>
            </select>`;
    } else if (mode.name === "codeTyperMultiplayer") {
        area.innerHTML = `
            <h3>Code Typer Multiplayer Settings</h3>
            <p>Race against others to type the snippet the fastest.</p>`;
    } else {
        area.innerHTML = "";
    }
}

function launchSelectedGame() {
    const mode = gamemodes.find((m) => m.name === selectedGameMode);
    if (!mode || !currentRoomCode) return;

    if (mode.launchType === "redirect") {
        socket.emit("launch-redirect-game", { roomCode: currentRoomCode, url: mode.url });
        window.location.href = mode.url;
        return;
    }

    if (mode.name === "bugFixerGame") {
        startBugFixerGame();
    } else if (mode.name === "codeTyperMultiplayer") {
        startCodeTyperGame();
    } else if (mode.name === "programmerProphunt") {
        // Route through the dedicated start-prophunt path, settings live in the lobby area
        document.getElementById("gameHub").classList.add("hidden");
        document.getElementById("hostSection").classList.remove("hidden");
    } else if (mode.name === "LogicCAH") {
        const numRounds = parseInt(document.getElementById("numRounds").value);
        const timeLimit = parseInt(document.getElementById("timeLimit").value);
        const numPrompts = parseInt(document.getElementById("numPrompts").value);

        const url =
            `/logic-cah/index.html?roomCode=${encodeURIComponent(currentRoomCode)}` +
            `&name=${encodeURIComponent(playerName)}` +
            `&isHost=${isHost}` +
            `&numRounds=${numRounds}` +
            `&timeLimit=${timeLimit}` +
            `&numPrompts=${numPrompts}`;

        socket.emit("launch-redirect-game", { roomCode: currentRoomCode, url });
        window.location.href = url;
    } else {
        const numRounds = parseInt(document.getElementById("numRounds").value);
        const timeLimit = parseInt(document.getElementById("timeLimit").value);
        const config = { roomCode: currentRoomCode, gameMode: mode.name, numRounds, timeLimit };
        if (mode.name === "LogicCAH") {
            config.numPrompts = parseInt(document.getElementById("numPrompts").value);
        } else {
            const complexityInput = document.getElementById("complexity");
            if (complexityInput) {
                config.complexity = complexityInput.value;
            }
        }
        socket.emit("start-game", config);
        document.getElementById("gameHub").classList.add("hidden");
        document.getElementById("hostSection").classList.remove("hidden");
    }
}

function backToLobby() {
    document.getElementById("gameHub").classList.add("hidden");
    document.getElementById("hostSection").classList.remove("hidden");
    socket.emit("host-left-gamehub", { roomCode: currentRoomCode });
}

socket.on("host-selecting-game", () => {
    document.getElementById("hostSection").classList.add("hidden");
    document.getElementById("gameHubWaiting").classList.remove("hidden");
});

socket.on("host-left-gamehub", () => {
    document.getElementById("gameHubWaiting").classList.add("hidden");
    document.getElementById("hostSection").classList.remove("hidden");
});

socket.on("redirect-to-game", ({ url }) => {
    if (url.startsWith("/logic-cah/")) {
        const incoming = new URL(url, window.location.origin);

        const numRounds = incoming.searchParams.get("numRounds") || "2";
        const timeLimit = incoming.searchParams.get("timeLimit") || "30";
        const numPrompts = incoming.searchParams.get("numPrompts") || "2";

        const fixedUrl =
            `/logic-cah/index.html?roomCode=${encodeURIComponent(currentRoomCode)}` +
            `&name=${encodeURIComponent(playerName)}` +
            `&isHost=${isHost}` +
            `&numRounds=${encodeURIComponent(numRounds)}` +
            `&timeLimit=${encodeURIComponent(timeLimit)}` +
            `&numPrompts=${encodeURIComponent(numPrompts)}`;

        window.location.href = fixedUrl;
        return;
    }

    window.location.href = url;
});

// ============================================
// GAME MODE SELECTION (inline dropdown fallback)
// ============================================

function confirmGameSelect() {
    const gameMode = document.getElementById("gameSelect").value;
    const mode = gamemodes.find((entry) => entry.name === gameMode);

    if (!currentRoomCode) {
        return;
    }

    if (!mode || lastPlayerCount < mode.minPlayers) {
        alert("Not enough players for that game mode.");
        return;
    }

    socket.emit("select-gamemode", { roomCode: currentRoomCode, gameMode });
    document.getElementById("gameSelectArea").classList.add("hidden");
}

socket.on("gamemode-selected", (gameMode) => {
    selectedGameMode = gameMode;

    const selectedGameDisplay = document.getElementById("selectedGameDisplay");
    if (gameMode) {
        const mode = gamemodes.find((m) => m.name === gameMode);
        const displayName = mode ? mode.displayName || gameMode : gameMode;
        selectedGameDisplay.innerText = `Selected game: ${displayName}`;
        selectedGameDisplay.classList.remove("hidden");
    } else {
        selectedGameDisplay.classList.add("hidden");
    }

    // Update waiting screen message for non-host players
    if (!isHost) {
        const mode = gamemodes.find((m) => m.name === gameMode);
        const name = mode ? mode.displayName || gameMode : gameMode;
        const waitingMsg = document.getElementById("gameHubWaitingMsg");
        if (waitingMsg) {
            waitingMsg.innerText = `Host is considering: ${name}`;
        }
    }

    const bugFixerArea = document.getElementById("bugFixerArea");
    const codeTyperLobbyControls = document.getElementById("codeTyperLobbyControls");

    if (gameMode === "bugFixerGame") {
        bugFixerArea.classList.remove("hidden");
        document.getElementById("prophuntArea").classList.add("hidden");
        if (codeTyperLobbyControls) codeTyperLobbyControls.classList.add("hidden");
        prophuntState = null;
        renderBugFixerControls();
    } else if (gameMode === "codeTyperMultiplayer") {
        bugFixerArea.classList.add("hidden");
        document.getElementById("prophuntArea").classList.add("hidden");
        if (codeTyperLobbyControls) codeTyperLobbyControls.classList.remove("hidden");
        const startCodeTyperButton = document.getElementById("startCodeTyperButton");
        if (startCodeTyperButton) startCodeTyperButton.classList.toggle("hidden", !isHost);
        bugFixerState = null;
        bugFixerSelectedCards = [];
        prophuntState = null;
    } else if (gameMode === "programmerProphunt") {
        document.getElementById("prophuntArea").classList.remove("hidden");
        bugFixerArea.classList.add("hidden");
        if (codeTyperLobbyControls) codeTyperLobbyControls.classList.add("hidden");
        bugFixerState = null;
        bugFixerSelectedCards = [];
        renderProphuntControls();
    } else {
        bugFixerArea.classList.add("hidden");
        document.getElementById("prophuntArea").classList.add("hidden");
        if (codeTyperLobbyControls) codeTyperLobbyControls.classList.add("hidden");
        bugFixerState = null;
        bugFixerSelectedCards = [];
        prophuntState = null;
    }

    renderTerminationControls();
});

// ============================================
// BUG FIXER GAME
// ============================================

function startCodeTyperGame() {
    if (!currentRoomCode || selectedGameMode !== "codeTyperMultiplayer") {
        return;
    }

    socket.emit("start-codetyper-multiplayer", {
        roomCode: currentRoomCode,
    });

    document.getElementById("gameHub").classList.add("hidden");
    document.getElementById("hostSection").classList.remove("hidden");
}

function startBugFixerGame() {
    if (!currentRoomCode || selectedGameMode !== "bugFixerGame") {
        return;
    }

    const pointsInput = document.getElementById("bugFixerPointsToWinInput");
    const submissionSecondsInput = document.getElementById("bugFixerSubmissionSecondsInput");
    const deciderSecondsInput = document.getElementById("bugFixerDeciderSecondsInput");
    const deciderTimeoutAction = document.getElementById("bugFixerDeciderTimeoutAction");

    const pointsToWin = Number(pointsInput.value);
    const submissionSeconds = Number(submissionSecondsInput.value);
    const deciderSeconds = Number(deciderSecondsInput.value);

    if (!Number.isInteger(pointsToWin) || pointsToWin < 1) {
        alert("Points to win must be a whole number of at least 1.");
        return;
    }

    if (!Number.isInteger(submissionSeconds) || submissionSeconds < 0) {
        alert("Player submit timer must be a whole number of 0 or higher.");
        return;
    }

    if (!Number.isInteger(deciderSeconds) || deciderSeconds < 0) {
        alert("Decider timer must be a whole number of 0 or higher.");
        return;
    }

    socket.emit("start-bugfixer", {
        roomCode: currentRoomCode,
        pointsToWin,
        submissionSeconds,
        deciderSeconds,
        deciderTimeoutAction: deciderTimeoutAction.value === "lowest-score" ? "lowest-score" : "no-point",
    });

    // Close Game Hub and show lobby with bugfixer area
    document.getElementById("gameHub").classList.add("hidden");
    document.getElementById("hostSection").classList.remove("hidden");
}

function submitBugFixerCards() {
    if (!bugFixerState || !Array.isArray(bugFixerState.yourHand)) {
        return;
    }

    if (bugFixerSelectedCards.length !== bugFixerState.responsesRequired) {
        alert(`Select exactly ${bugFixerState.responsesRequired} card(s).`);
        return;
    }

    socket.emit("bugfixer-submit", {
        roomCode: currentRoomCode,
        chosenCards: [...bugFixerSelectedCards],
    });
}

function pickBugFixerWinner(submissionId) {
    socket.emit("bugfixer-pick-winner", {
        roomCode: currentRoomCode,
        submissionId,
    });
}

function terminateCurrentGame() {
    if (!currentRoomCode || !selectedGameMode || !isHost) {
        return;
    }
    socket.emit("terminate-game", { roomCode: currentRoomCode });
}

function startProphuntGame() {
    if (!currentRoomCode || selectedGameMode !== "programmerProphunt") {
        return;
    }

    const complexity = document.getElementById("prophuntComplexityInput").value;
    const roundSeconds = Number(document.getElementById("prophuntRoundSecondsInput").value);
    const rounds = Number(document.getElementById("prophuntRoundsInput").value);

    if (!["easy", "medium", "hard"].includes(complexity)) {
        alert("Complexity must be easy, medium, or hard.");
        return;
    }
    if (!Number.isInteger(roundSeconds) || roundSeconds < 5) {
        alert("Round timer must be at least 5 seconds.");
        return;
    }
    if (!Number.isInteger(rounds) || rounds < 1) {
        alert("Rounds must be at least 1.");
        return;
    }

    socket.emit("start-prophunt", {
        roomCode: currentRoomCode,
        complexity,
        roundSeconds,
        rounds,
    });
}

function applyProphuntEdit() {
    if (!prophuntState || !prophuntState.active) {
        return;
    }

    const lineRef = document.getElementById("prophuntLineSelect").value;
    const lineText = document.getElementById("prophuntLineTextInput").value;
    socket.emit("prophunt-edit-line", {
        roomCode: currentRoomCode,
        lineRef,
        lineText,
    });
}

function confirmProphuntHiderEdit() {
    if (!prophuntState || !prophuntState.active) {
        return;
    }

    socket.emit("prophunt-confirm-hider", { roomCode: currentRoomCode });
}

function confirmProphuntFinderGuess() {
    if (!prophuntState || !prophuntState.active) {
        return;
    }

    const lineRef = document.getElementById("prophuntFinderLineSelect").value;
    socket.emit("prophunt-confirm-finder", {
        roomCode: currentRoomCode,
        lineRef,
    });
}

function addBugFixerCard(cardText) {
    if (!bugFixerState || !bugFixerState.active || bugFixerState.yourSubmitted) {
        return;
    }

    if (bugFixerSelectedCards.length >= bugFixerState.responsesRequired) {
        return;
    }

    if (bugFixerSelectedCards.includes(cardText)) {
        return;
    }

    bugFixerSelectedCards.push(cardText);
    renderBugFixerState(bugFixerState);
}

function removeBugFixerCard(index) {
    if (index < 0 || index >= bugFixerSelectedCards.length) {
        return;
    }
    bugFixerSelectedCards.splice(index, 1);
    renderBugFixerState(bugFixerState);
}

function renderTerminationControls() {
    const terminateButton = document.getElementById("terminateGameButton");
    const canTerminate = Boolean(isHost && currentRoomCode && selectedGameMode);
    terminateButton.classList.toggle("hidden", !canTerminate);
}

function renderBugFixerControls() {
    const startButton = document.getElementById("startBugFixerButton");
    const submitButton = document.getElementById("bugFixerSubmitButton");
    const judgeArea = document.getElementById("bugFixerJudgeArea");

    if (selectedGameMode !== "bugFixerGame") {
        startButton.classList.add("hidden");
        submitButton.classList.add("hidden");
        judgeArea.classList.add("hidden");
        renderTerminationControls();
        return;
    }

    if (!bugFixerState) {
        startButton.classList.toggle("hidden", !isHost || lastPlayerCount < 3);
        submitButton.classList.add("hidden");
        judgeArea.classList.add("hidden");
        return;
    }

    startButton.classList.toggle("hidden", !(isHost && bugFixerState.canStart));

    const showSubmit =
        bugFixerState.active &&
        !bugFixerState.isDecider &&
        bugFixerState.phase === "submitting" &&
        !bugFixerState.yourSubmitted;
    submitButton.classList.toggle("hidden", !showSubmit);

    const showJudge =
        bugFixerState.active &&
        bugFixerState.isDecider &&
        (bugFixerState.phase === "judging" || bugFixerState.phase === "confirming");
    judgeArea.classList.toggle("hidden", !showJudge);

    renderTerminationControls();
}

function renderProphuntControls() {
    const startButton = document.getElementById("startProphuntButton");
    const hiderControls = document.getElementById("prophuntHiderControls");
    const finderControls = document.getElementById("prophuntFinderControls");

    if (selectedGameMode !== "programmerProphunt") {
        startButton.classList.add("hidden");
        hiderControls.classList.add("hidden");
        finderControls.classList.add("hidden");
        return;
    }

    if (!prophuntState) {
        startButton.classList.toggle("hidden", !isHost || lastPlayerCount < 4);
        hiderControls.classList.add("hidden");
        finderControls.classList.add("hidden");
        return;
    }

    startButton.classList.toggle("hidden", !(isHost && prophuntState.canStart));
    hiderControls.classList.toggle(
        "hidden",
        !(prophuntState.active && prophuntState.role === "hider" && prophuntState.phase === "hiding")
    );
    finderControls.classList.toggle(
        "hidden",
        !(prophuntState.active && prophuntState.role === "finder" && prophuntState.phase === "finding")
    );
}

function renderProphuntState(state) {
    prophuntState = state;

    const status = document.getElementById("prophuntStatus");
    const roundDisplay = document.getElementById("prophuntRoundDisplay");
    const phaseDisplay = document.getElementById("prophuntPhaseDisplay");
    const hidingTeamDisplay = document.getElementById("prophuntHidingTeamDisplay");
    const finderTeamDisplay = document.getElementById("prophuntFinderTeamDisplay");
    const teamAList = document.getElementById("prophuntTeamAList");
    const teamBList = document.getElementById("prophuntTeamBList");
    const codeBlock = document.getElementById("prophuntCodeBlock");
    const lineSelect = document.getElementById("prophuntLineSelect");
    const finderLineSelect = document.getElementById("prophuntFinderLineSelect");
    const lineTextInput = document.getElementById("prophuntLineTextInput");
    const scoreboard = document.getElementById("prophuntScoreboard");
    const lastResult = document.getElementById("prophuntLastResult");
    const complexityInput = document.getElementById("prophuntComplexityInput");
    const roundSecondsInput = document.getElementById("prophuntRoundSecondsInput");
    const roundsInput = document.getElementById("prophuntRoundsInput");

    status.innerText = state.message || "";
    roundDisplay.innerText = state.active ? `${state.roundNumber}/${state.totalRounds}` : "-";
    phaseDisplay.innerText = state.phase || "-";
    hidingTeamDisplay.innerText = state.hidingTeamName || "-";
    finderTeamDisplay.innerText = state.finderTeamName || "-";

    if (Array.isArray(state.teamA) && state.teamA.length > 0) {
        teamAList.innerText = state.teamA.join(", ");
    } else {
        teamAList.innerText = "-";
    }
    if (Array.isArray(state.teamB) && state.teamB.length > 0) {
        teamBList.innerText = state.teamB.join(", ");
    } else {
        teamBList.innerText = "-";
    }

    if (Array.isArray(state.visibleLines) && state.visibleLines.length > 0) {
        codeBlock.innerText = state.visibleLines.map((line) => `${line.number}. ${line.text}`).join("\n");
    } else {
        codeBlock.innerText = "Code is hidden for this phase.";
    }

    complexityInput.disabled = Boolean(state.active);
    roundSecondsInput.disabled = Boolean(state.active);
    roundsInput.disabled = Boolean(state.active);

    lineSelect.innerHTML = "";
    if (Array.isArray(state.editableLineOptions)) {
        state.editableLineOptions.forEach((option) => {
            const el = document.createElement("option");
            el.value = option.ref;
            el.textContent = option.label;
            lineSelect.appendChild(el);
        });
    }

    finderLineSelect.innerHTML = "";
    if (Array.isArray(state.finderLineOptions)) {
        state.finderLineOptions.forEach((option) => {
            const el = document.createElement("option");
            el.value = option.ref;
            el.textContent = option.label;
            finderLineSelect.appendChild(el);
        });
    }

    lineTextInput.value = state.yourDraftLine || "";

    scoreboard.innerHTML = "";
    if (state.scores) {
        ["A", "B"].forEach((team) => {
            const li = document.createElement("li");
            li.innerText = `Team ${team}: ${state.scores[team] || 0}`;
            scoreboard.appendChild(li);
        });
    }

    lastResult.innerText = state.lastResultMessage || "-";
    renderProphuntControls();
}

socket.on("prophunt-state", (state) => {
    if (selectedGameMode === "programmerProphunt") {
        document.getElementById("prophuntArea").classList.remove("hidden");
    }
    renderProphuntState(state);
});

socket.on("prophunt-error", (message) => {
    alert(message);
});

function renderBugFixerState(state) {
    bugFixerState = state;

    const status = document.getElementById("bugFixerStatus");
    const decider = document.getElementById("bugFixerDecider");
    const prompt = document.getElementById("bugFixerPrompt");
    const responsesRequired = document.getElementById("bugFixerResponsesRequired");
    const hand = document.getElementById("bugFixerHand");
    const selectedOrder = document.getElementById("bugFixerSelectedOrder");
    const submissions = document.getElementById("bugFixerSubmissions");
    const scoreboard = document.getElementById("bugFixerScoreboard");
    const revealList = document.getElementById("bugFixerRevealList");
    const pointsToWinInput = document.getElementById("bugFixerPointsToWinInput");
    const submissionSecondsInput = document.getElementById("bugFixerSubmissionSecondsInput");
    const deciderSecondsInput = document.getElementById("bugFixerDeciderSecondsInput");
    const deciderTimeoutAction = document.getElementById("bugFixerDeciderTimeoutAction");

    if (state.pointsToWin) {
        pointsToWinInput.value = String(state.pointsToWin);
    }

    if (state.timerSettings) {
        submissionSecondsInput.value = String(state.timerSettings.submissionSeconds || 0);
        deciderSecondsInput.value = String(state.timerSettings.deciderSeconds || 0);
        deciderTimeoutAction.value =
            state.timerSettings.deciderTimeoutAction === "lowest-score" ? "lowest-score" : "no-point";
    }

    pointsToWinInput.disabled = Boolean(state.active);
    submissionSecondsInput.disabled = Boolean(state.active);
    deciderSecondsInput.disabled = Boolean(state.active);
    deciderTimeoutAction.disabled = Boolean(state.active);

    status.innerText = state.message || "";
    if (state.lastResult && state.lastResult.message && (!state.active || state.phase === "confirming")) {
        status.innerText = state.lastResult.message;
    }

    decider.innerText = state.deciderName || "-";
    prompt.innerText = state.prompt || "-";
    responsesRequired.innerText = String(state.responsesRequired || 0);

    const currentHand = Array.isArray(state.yourHand) ? state.yourHand : [];
    bugFixerSelectedCards = bugFixerSelectedCards.filter((card) => currentHand.includes(card));

    hand.innerHTML = "";
    if (Array.isArray(state.yourHand) && state.yourHand.length > 0) {
        state.yourHand.forEach((cardText, index) => {
            const row = document.createElement("div");
            const label = document.createElement("label");
            label.append(`${index + 1}. ${cardText} `);

            const addButton = document.createElement("button");
            addButton.innerText = "Add";
            const alreadySelected = bugFixerSelectedCards.includes(cardText);
            const atLimit = bugFixerSelectedCards.length >= (state.responsesRequired || 1);
            addButton.disabled = alreadySelected || atLimit || state.yourSubmitted;
            addButton.onclick = () => addBugFixerCard(cardText);

            label.appendChild(addButton);
            row.appendChild(label);
            hand.appendChild(row);
        });
    } else if (state.active && !state.isDecider) {
        hand.innerText = state.yourSubmitted ? "Cards submitted." : "Waiting for hand.";
    }

    selectedOrder.innerHTML = "";
    if (bugFixerSelectedCards.length === 0) {
        selectedOrder.innerText = "No cards selected yet.";
    } else {
        bugFixerSelectedCards.forEach((cardText, index) => {
            const row = document.createElement("div");
            const removeButton = document.createElement("button");
            removeButton.innerText = "Remove";
            removeButton.disabled = state.yourSubmitted;
            removeButton.onclick = () => removeBugFixerCard(index);
            row.append(`${index + 1}. ${cardText} `);
            row.appendChild(removeButton);
            selectedOrder.appendChild(row);
        });
    }

    submissions.innerHTML = "";
    if (Array.isArray(state.submissionOptions) && state.submissionOptions.length > 0) {
        state.submissionOptions.forEach((entry) => {
            const row = document.createElement("div");
            const buttonLabel = state.phase === "confirming" ? "Switch to This" : "Pick";
            row.innerHTML = `<button onclick="pickBugFixerWinner(${entry.submissionId})">${buttonLabel}</button> ${entry.text}`;
            submissions.appendChild(row);
        });
    }

    scoreboard.innerHTML = "";
    if (Array.isArray(state.scores)) {
        const sorted = [...state.scores].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
        sorted.forEach((entry) => {
            const item = document.createElement("li");
            item.innerText = `${entry.name}: ${entry.score}`;
            scoreboard.appendChild(item);
        });
    }

    revealList.innerHTML = "";
    if (state.lastResult && Array.isArray(state.lastResult.revealedSubmissions)) {
        state.lastResult.revealedSubmissions.forEach((entry) => {
            const item = document.createElement("li");
            item.innerText = `${entry.playerName}: ${entry.text}`;
            revealList.appendChild(item);
        });
    }

    renderBugFixerControls();
}

socket.on("bugfixer-state", (state) => {
    if (selectedGameMode === "bugFixerGame") {
        document.getElementById("bugFixerArea").classList.remove("hidden");
    }
    renderBugFixerState(state);
});

socket.on("bugfixer-error", (message) => {
    alert(message);
});

socket.on("launch-codetyper", ({ roomCode }) => {
    const iframe = document.getElementById("codeTyperIframe");
    iframe.src = `/code-typer-multiplayer/?roomCode=${roomCode}&name=${encodeURIComponent(playerName)}&isHost=${isHost}&t=${Date.now()}`;
    document.getElementById("codeTyperArea").classList.remove("hidden");
});

socket.on("game-started", () => {
    document.getElementById("gameHub").classList.add("hidden");
    document.getElementById("hostSection").classList.remove("hidden");
});

socket.on("game-terminated", (payload) => {
    selectedGameMode = "";
    bugFixerState = null;
    bugFixerSelectedCards = [];
    prophuntState = null;

    document.getElementById("selectedGameDisplay").classList.add("hidden");
    document.getElementById("bugFixerArea").classList.add("hidden");
    document.getElementById("prophuntArea").classList.add("hidden");

    document.getElementById("codeTyperArea").classList.add("hidden");
    const codeTyperLobbyControls = document.getElementById("codeTyperLobbyControls");
    if (codeTyperLobbyControls) codeTyperLobbyControls.classList.add("hidden");
    renderTerminationControls();

    if (payload && payload.gameMode) {
        alert(`${payload.gameMode} was terminated by host ${payload.byHost}.`);
    }
});

socket.on("left-game", () => {
    // Player has left the game, redirect back to lobby
    window.location.href = "/";
});

// ============================================
// GAME MODE OPTIONS (inline dropdown)
// ============================================

function updateGamemodeOptions(playerCount) {
    const select = document.getElementById("gameSelect");
    const details = document.getElementById("gameDetails");
    if (!select || !details) {
        return;
    }

    select.innerHTML = "";
    const available = gamemodes.filter((mode) => playerCount >= mode.minPlayers);

    available.forEach((mode) => {
        const option = document.createElement("option");
        option.value = mode.name;
        option.textContent = mode.displayName || mode.name;
        select.appendChild(option);
    });

    if (available.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No available modes";
        select.appendChild(option);
        select.disabled = true;
        details.innerText = "";
        return;
    }

    select.disabled = false;
    updateGamemodeDetails(available[0]);
}

function updateGamemodeDetails(mode) {
    const details = document.getElementById("gameDetails");
    details.innerText = `${mode.description} (Min players: ${mode.minPlayers})`;
}

document.getElementById("gameSelect").addEventListener("change", (event) => {
    const selected = gamemodes.find((mode) => mode.name === event.target.value);
    if (selected) {
        updateGamemodeDetails(selected);
    }
});

// ============================================
// ERROR HANDLING
// ============================================

socket.on("error", (msg) => {
    console.error("Socket error:", msg);
    alert("Error: " + msg);
});

socket.on("disconnect", () => {
    bugFixerState = null;
    bugFixerSelectedCards = [];
    prophuntState = null;
    selectedGameMode = "";
});
