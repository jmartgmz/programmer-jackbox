const { io } = require("socket.io-client");

const SERVER_URL = process.env.SIM_SERVER_URL || process.env.SERVER_URL || "http://localhost:3000";
const SOCKET_PATH = process.env.SIM_SOCKET_PATH || process.env.SOCKET_PATH || "/socket.io";

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, timeoutMessage) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) {
            return;
        }
        await delay(100);
    }
    throw new Error(timeoutMessage);
}

function createClient(name) {
    const socket = io(SERVER_URL, {
        path: SOCKET_PATH,
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: false,
        timeout: 10000,
    });

    const state = {
        name,
        socket,
        roomCode: "",
        selectedGame: "",
        visibility: "",
        updatePlayersCount: 0,
        errors: [],
    };

    socket.on("connect", () => {
        console.log(`[connect] ${name} (${socket.id})`);
    });

    socket.on("room-created", (payload) => {
        const data = typeof payload === "string" ? { roomCode: payload } : payload || {};
        state.roomCode = String(data.roomCode || "");
        state.selectedGame = String(data.selectedGame || "");
        state.visibility = String(data.visibility || "");
        console.log(
            `[room-created] ${name} room=${state.roomCode} visibility=${state.visibility} selectedGame=${state.selectedGame}`
        );
    });

    socket.on("gamemode-selected", (gameMode) => {
        state.selectedGame = String(gameMode || "");
    });

    socket.on("update-players", (payload) => {
        const players = payload && payload.players ? payload.players : [];
        state.updatePlayersCount = Array.isArray(players) ? players.length : 0;
    });

    socket.on("join-error", (message) => {
        state.errors.push(String(message || ""));
        console.log(`[join-error] ${name}: ${message}`);
    });

    return state;
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);

    const runTag = Date.now().toString(36).slice(-6);
    const a = createClient(`MatchA_${runTag}`);
    const b = createClient(`MatchB_${runTag}`);

    try {
        await delay(500);

        const preferred = ["bugFixerGame", "programmerProphunt"];
        a.socket.emit("join-random-room", { name: a.name, preferredGameModes: preferred });

        await waitFor(() => Boolean(a.roomCode), 8000, "First random player did not get a room");
        if (a.visibility !== "public") {
            throw new Error(`Expected public room visibility, got '${a.visibility}'`);
        }

        b.socket.emit("join-random-room", { name: b.name, preferredGameModes: preferred });

        await waitFor(() => Boolean(b.roomCode), 8000, "Second random player did not get a room");
        if (a.roomCode !== b.roomCode) {
            throw new Error(`Expected both random players in same room, got ${a.roomCode} and ${b.roomCode}`);
        }

        await waitFor(
            () => a.updatePlayersCount === 2 && b.updatePlayersCount === 2,
            8000,
            "Random lobby did not reach 2 players"
        );

        if (!preferred.includes(a.selectedGame) || !preferred.includes(b.selectedGame)) {
            throw new Error(`Selected game not in preferred list. A='${a.selectedGame}' B='${b.selectedGame}'`);
        }

        console.log("[simulation] Random matchmaking simulation completed successfully.");
    } finally {
        [a, b].forEach((client) => client.socket.disconnect());
    }
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
