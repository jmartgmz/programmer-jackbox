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
        launchRoomCode: "",
        selectedGame: "",
        latestProgressMap: null,
        latestSnippet: null,
        errors: [],
    };

    socket.on("connect", () => {
        console.log(`[connect] ${name} (${socket.id})`);
    });

    socket.on("room-created", (payload) => {
        const roomCode = typeof payload === "string" ? payload : payload.roomCode;
        state.roomCode = String(roomCode || "");
    });

    socket.on("gamemode-selected", (gameMode) => {
        state.selectedGame = String(gameMode || "");
    });

    socket.on("launch-codetyper", ({ roomCode }) => {
        state.launchRoomCode = String(roomCode || "");
    });

    socket.on("codetyper-progress-update", (map) => {
        state.latestProgressMap = map;
    });

    socket.on("codetyper-set-snippet", (snippet) => {
        state.latestSnippet = snippet;
    });

    socket.on("join-error", (message) => {
        state.errors.push(String(message || ""));
        console.log(`[join-error] ${name}: ${message}`);
    });

    return state;
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);

    const host = createClient("TypeHost");
    const guest = createClient("TypeGuest");

    try {
        await delay(500);

        host.socket.emit("host-room", { name: host.name, visibility: "private" });
        await waitFor(() => Boolean(host.roomCode), 8000, "Host room not created");

        guest.socket.emit("join-room", { roomCode: host.roomCode, name: guest.name });
        await delay(700);

        host.socket.emit("select-gamemode", { roomCode: host.roomCode, gameMode: "codeTyperMultiplayer" });
        await waitFor(
            () => host.selectedGame === "codeTyperMultiplayer" && guest.selectedGame === "codeTyperMultiplayer",
            8000,
            "CodeTyper mode selection did not propagate"
        );

        host.socket.emit("start-codetyper-multiplayer", { roomCode: host.roomCode });
        await waitFor(
            () => host.launchRoomCode === host.roomCode && guest.launchRoomCode === host.roomCode,
            8000,
            "launch-codetyper event not received by both clients"
        );

        host.socket.emit("codetyper-rejoin-room", { roomCode: host.roomCode, name: host.name });
        guest.socket.emit("codetyper-rejoin-room", { roomCode: host.roomCode, name: guest.name });
        await delay(300);

        host.socket.emit("codetyper-progress", { roomCode: host.roomCode, progress: 32, wpm: 55 });
        guest.socket.emit("codetyper-progress", { roomCode: host.roomCode, progress: 41, wpm: 61 });

        await waitFor(
            () => {
                const map = host.latestProgressMap || guest.latestProgressMap;
                if (!map) return false;
                const ids = Object.keys(map);
                return ids.length >= 2;
            },
            8000,
            "Did not receive codetyper-progress-update with both players"
        );

        host.socket.emit("codetyper-finished", { roomCode: host.roomCode, time: 12.34 });
        guest.socket.emit("codetyper-finished", { roomCode: host.roomCode, time: 11.52 });
        await delay(300);

        const snippet = {
            language: "javascript",
            code: "const x = 42;",
        };
        host.socket.emit("codetyper-sync-snippet", { roomCode: host.roomCode, snippet });

        await waitFor(
            () => {
                const hostSnippet = host.latestSnippet;
                const guestSnippet = guest.latestSnippet;
                return (
                    hostSnippet &&
                    guestSnippet &&
                    hostSnippet.code === snippet.code &&
                    guestSnippet.code === snippet.code
                );
            },
            8000,
            "codetyper-set-snippet was not broadcast"
        );

        console.log("[simulation] CodeTyper multiplayer simulation completed successfully.");
    } finally {
        [host, guest].forEach((client) => client.socket.disconnect());
    }
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
