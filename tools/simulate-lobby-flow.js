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
        isHost: false,
        errors: [],
        latestPlayersPayload: null,
        latestGameMode: "",
        latestTermination: null,
    };

    socket.on("connect", () => {
        console.log(`[connect] ${name} (${socket.id})`);
    });

    socket.on("room-created", (payload) => {
        const roomCode = typeof payload === "string" ? payload : payload.roomCode;
        state.roomCode = roomCode;
        state.isHost = Boolean(payload && payload.isHost);
        console.log(`[room-created] ${name} room=${roomCode} host=${state.isHost}`);
    });

    socket.on("update-players", (payload) => {
        state.latestPlayersPayload = payload;
    });

    socket.on("gamemode-selected", (gameMode) => {
        state.latestGameMode = String(gameMode || "");
    });

    socket.on("game-terminated", (payload) => {
        state.latestTermination = payload;
    });

    socket.on("join-error", (message) => {
        state.errors.push(String(message || ""));
        console.log(`[join-error] ${name}: ${message}`);
    });

    return state;
}

async function expectJoinError(client, action, contains, timeoutMs = 6000) {
    const before = client.errors.length;
    action();
    await waitFor(
        () => client.errors.length > before,
        timeoutMs,
        `${client.name} expected join-error containing '${contains}'`
    );
    const actual = client.errors[client.errors.length - 1] || "";
    if (!actual.toLowerCase().includes(contains.toLowerCase())) {
        throw new Error(`Expected join-error containing '${contains}', got '${actual}'`);
    }
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);

    const host = createClient("LobbyHost");
    const joiners = [createClient("LobbyJoinA"), createClient("LobbyJoinB"), createClient("LobbyJoinC")];
    const all = [host, ...joiners];

    const duplicateClient = createClient("LobbyJoinA");
    const badRoomClient = createClient("BadRoomJoiner");

    try {
        await delay(500);

        host.socket.emit("host-room", { name: host.name, visibility: "private" });
        await waitFor(() => Boolean(host.roomCode), 8000, "Host room was not created");

        const roomCode = host.roomCode;
        if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
            throw new Error(`Invalid room code format: ${roomCode}`);
        }
        console.log(`[assert] room code read successfully: ${roomCode}`);

        joiners.forEach((client) => {
            client.socket.emit("join-room", { roomCode, name: client.name });
        });

        await waitFor(
            () =>
                all.every((client) => {
                    const payload = client.latestPlayersPayload;
                    const players = payload && payload.players ? payload.players : [];
                    return Array.isArray(players) && players.length === 4;
                }),
            10000,
            "Not all clients observed 4 players in lobby"
        );

        console.log("[assert] all clients observed 4-player lobby");

        await expectJoinError(
            duplicateClient,
            () => duplicateClient.socket.emit("join-room", { roomCode, name: "LobbyJoinA" }),
            "already in this lobby"
        );

        await expectJoinError(
            badRoomClient,
            () => badRoomClient.socket.emit("join-room", { roomCode: "ZZZZZZ", name: badRoomClient.name }),
            "does not exist"
        );

        host.socket.emit("select-gamemode", { roomCode, gameMode: "bugFixerGame" });
        await waitFor(
            () => all.every((client) => client.latestGameMode === "bugFixerGame"),
            8000,
            "Not all clients received gamemode-selected=bugFixerGame"
        );
        console.log("[assert] mode selection propagated");

        host.socket.emit("terminate-game", { roomCode });
        await waitFor(
            () =>
                all.every((client) => client.latestTermination && client.latestTermination.gameMode === "bugFixerGame"),
            8000,
            "Not all clients received game-terminated event"
        );

        console.log("[simulation] Lobby lifecycle simulation completed successfully.");
    } finally {
        [duplicateClient, badRoomClient, ...all].forEach((client) => client.socket.disconnect());
    }
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
