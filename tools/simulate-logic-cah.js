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
        gameStarted: null,
        latestShowAnswers: null,
        latestGameOver: null,
        latestSelectedReveal: null,
        errors: [],
    };

    socket.on("connect", () => {
        console.log(`[connect] ${name} (${socket.id})`);
    });

    socket.on("room-created", (payload) => {
        const roomCode = typeof payload === "string" ? payload : payload.roomCode;
        state.roomCode = String(roomCode || "");
    });

    socket.on("game-started", (payload) => {
        state.gameStarted = payload;
    });

    socket.on("show-answers", (payload) => {
        state.latestShowAnswers = payload;
    });

    socket.on("selected-player-revealed", (payload) => {
        state.latestSelectedReveal = payload;
    });

    socket.on("game-over", (payload) => {
        state.latestGameOver = payload;
    });

    socket.on("error", (message) => {
        state.errors.push(String(message || ""));
        console.log(`[error] ${name}: ${message}`);
    });

    return state;
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);

    const players = [createClient("CAH_A"), createClient("CAH_B"), createClient("CAH_C"), createClient("CAH_D")];

    try {
        const host = players[0];
        await delay(500);

        host.socket.emit("host-room", { name: host.name, visibility: "private" });
        await waitFor(() => Boolean(host.roomCode), 8000, "Host room not created");

        for (let i = 1; i < players.length; i += 1) {
            players[i].socket.emit("join-room", { roomCode: host.roomCode, name: players[i].name });
        }

        await delay(900);

        host.socket.emit("start-game", {
            roomCode: host.roomCode,
            gameMode: "LogicCAH",
            numRounds: 1,
            timeLimit: 30,
            numPrompts: 1,
        });

        await waitFor(
            () => players.every((player) => player.gameStarted && player.gameStarted.gameMode === "LogicCAH"),
            10000,
            "game-started was not received for all LogicCAH players"
        );

        const started = host.gameStarted;
        const deciderId = started.status && started.status.currentDecider ? started.status.currentDecider.id : "";
        if (!deciderId) {
            throw new Error("LogicCAH did not provide decider id");
        }

        const nonDeciders = players.filter((player) => player.socket.id !== deciderId);
        nonDeciders.forEach((player, idx) => {
            player.socket.emit("submit-answers", {
                roomCode: host.roomCode,
                answers: [`answer-${idx + 1}`],
            });
        });

        await waitFor(
            () =>
                players.every((player) => player.latestShowAnswers && Array.isArray(player.latestShowAnswers.answers)),
            10000,
            "show-answers was not received for all LogicCAH players"
        );

        const decider = players.find((player) => player.socket.id === deciderId);
        if (!decider) {
            throw new Error("Decider socket not found among players");
        }

        const answerOptions = decider.latestShowAnswers.answers;
        if (!Array.isArray(answerOptions) || answerOptions.length === 0) {
            throw new Error("Decider received no answer options");
        }

        decider.socket.emit("decider-select", {
            roomCode: host.roomCode,
            selectedPlayerId: answerOptions[0].playerId,
        });

        await waitFor(
            () => players.every((player) => player.latestSelectedReveal && player.latestGameOver),
            12000,
            "LogicCAH did not finish round/game after decider-select"
        );

        console.log("[simulation] LogicCAH simulation completed successfully.");
    } finally {
        players.forEach((player) => player.socket.disconnect());
    }
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
