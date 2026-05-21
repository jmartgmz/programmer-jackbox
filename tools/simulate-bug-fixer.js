const { io } = require("socket.io-client");

const SERVER_URL = process.env.SIM_SERVER_URL || process.env.SERVER_URL || "http://localhost:3000";
const SOCKET_PATH = process.env.SIM_SOCKET_PATH || process.env.SOCKET_PATH || "/socket.io";
const PLAYER_NAMES = ["SimA", "SimB", "SimC", "SimD"];
const GAME_TO_WIN = 1;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);
    const players = PLAYER_NAMES.map((name) => ({
        name,
        socket: io(SERVER_URL, {
            path: SOCKET_PATH,
            transports: ["websocket", "polling"],
            forceNew: true,
            reconnection: false,
            timeout: 10000,
        }),
        roomCode: "",
        currentState: null,
        joined: false,
        isHost: false,
        lastRoundAction: new Map(),
        gameEnded: false,
    }));

    const submissionSentByRound = new Set();
    const switchSentByRound = new Set();

    const byId = new Map();
    players.forEach((player) => {
        player.socket.on("connect", () => {
            byId.set(player.socket.id, player);
            console.log(`[connect] ${player.name} (${player.socket.id})`);
        });

        player.socket.on("connect_error", (err) => {
            console.error(`[connect_error] ${player.name}: ${err.message}`);
        });

        player.socket.on("join-error", (message) => {
            console.error(`[join-error] ${player.name}: ${message}`);
        });

        player.socket.on("bugfixer-error", (message) => {
            console.error(`[bugfixer-error] ${player.name}: ${message}`);
        });

        player.socket.on("room-created", (payload) => {
            const roomCode = typeof payload === "string" ? payload : payload.roomCode;
            player.roomCode = roomCode;
            player.joined = true;
            player.isHost = Boolean(payload && payload.isHost);
            console.log(`[room-created] ${player.name} in ${roomCode}, host=${player.isHost}`);
        });

        player.socket.on("update-players", (payload) => {
            const playersInRoom = payload && payload.players ? payload.players : payload;
            if (Array.isArray(playersInRoom)) {
                console.log(`[update-players] ${player.name} sees ${playersInRoom.length} players`);
            }
        });

        player.socket.on("gamemode-selected", (gameMode) => {
            console.log(`[gamemode-selected] ${player.name}: ${gameMode}`);
        });

        player.socket.on("bugfixer-state", (state) => {
            player.currentState = state;
            if (!state.active && state.lastResult && /wins Bug Fixer/i.test(state.lastResult.message || "")) {
                player.gameEnded = true;
                console.log(`[game-ended] ${player.name} received winner message: ${state.lastResult.message}`);
                return;
            }

            if (!state.active) {
                return;
            }

            const roundKey = `${state.roundNumber}:${state.phase}`;
            if (!player.lastRoundAction.has(roundKey)) {
                player.lastRoundAction.set(roundKey, false);
            }

            if (state.phase === "submitting" && !state.isDecider && !state.yourSubmitted) {
                if (!Array.isArray(state.yourHand) || state.yourHand.length < state.responsesRequired) {
                    return;
                }
                const key = `${player.name}:${state.roundNumber}:submit`;
                if (submissionSentByRound.has(key)) {
                    return;
                }

                const chosenCards = state.yourHand.slice(0, state.responsesRequired);
                player.socket.emit("bugfixer-submit", {
                    roomCode: player.roomCode,
                    chosenCards,
                });
                submissionSentByRound.add(key);
                console.log(`[submit] ${player.name}: ${chosenCards.join(" | ")}`);
            }

            if ((state.phase === "judging" || state.phase === "confirming") && state.isDecider) {
                if (!Array.isArray(state.submissionOptions) || state.submissionOptions.length === 0) {
                    return;
                }

                if (state.phase === "judging") {
                    const pick = state.submissionOptions[0].submissionId;
                    player.socket.emit("bugfixer-pick-winner", {
                        roomCode: player.roomCode,
                        submissionId: pick,
                    });
                    console.log(`[pick] ${player.name}: submission ${pick}`);
                } else if (state.phase === "confirming" && !player.lastRoundAction.get(roundKey)) {
                    const switchKey = `${player.name}:${state.roundNumber}:switch`;
                    if (switchSentByRound.has(switchKey)) {
                        return;
                    }

                    if (state.submissionOptions.length > 1) {
                        const pick = state.submissionOptions[1].submissionId;
                        player.socket.emit("bugfixer-pick-winner", {
                            roomCode: player.roomCode,
                            submissionId: pick,
                        });
                        console.log(`[switch-pick] ${player.name}: submission ${pick}`);
                    }
                    switchSentByRound.add(switchKey);
                    player.lastRoundAction.set(roundKey, true);
                }
            }
        });
    });

    try {
        await delay(500);

        const host = players[0];
        host.socket.emit("host-room", { name: host.name, visibility: "private" });

        await waitFor(() => host.roomCode, 8000, "Host room was not created");
        const roomCode = host.roomCode;

        for (let i = 1; i < players.length; i += 1) {
            players[i].socket.emit("join-room", { roomCode, name: players[i].name });
        }

        await delay(1000);

        host.socket.emit("select-gamemode", { roomCode, gameMode: "bugFixerGame" });
        await delay(500);

        host.socket.emit("start-bugfixer", {
            roomCode,
            pointsToWin: GAME_TO_WIN,
            submissionSeconds: 3,
            deciderSeconds: 3,
            deciderTimeoutAction: "no-point",
        });

        console.log("[simulation] Game started. Waiting for completion...");
        await waitFor(() => players.every((player) => player.gameEnded), 90000, "Timed out waiting for game to finish");

        const finalState = host.currentState;
        if (finalState && Array.isArray(finalState.scores)) {
            const summary = finalState.scores.map((entry) => `${entry.name}:${entry.score}`).join(", ");
            console.log(`[simulation] Final scores: ${summary}`);
        }

        console.log("[simulation] Completed successfully.");
    } finally {
        players.forEach((player) => player.socket.disconnect());
    }
}

async function waitFor(predicate, timeoutMs, timeoutMessage) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) {
            return;
        }
        await delay(100);
    }
    throw new Error(timeoutMessage);
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
