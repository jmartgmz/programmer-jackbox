const { io } = require("socket.io-client");

const SERVER_URL = process.env.SIM_SERVER_URL || process.env.SERVER_URL || "http://localhost:3000";
const SOCKET_PATH = process.env.SIM_SOCKET_PATH || process.env.SOCKET_PATH || "/socket.io";
const PLAYER_NAMES = ["PropSimA", "PropSimB", "PropSimC", "PropSimD"];

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, message) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) {
            return;
        }
        await delay(100);
    }
    throw new Error(message);
}

function makePlayer(name) {
    const socket = io(SERVER_URL, {
        path: SOCKET_PATH,
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: false,
        timeout: 10000,
    });
    const player = {
        name,
        socket,
        roomCode: "",
        latestState: null,
        errors: [],
        isHost: false,
    };

    socket.on("connect", () => {
        console.log(`[connect] ${name} (${socket.id})`);
    });

    socket.on("room-created", (payload) => {
        const roomCode = typeof payload === "string" ? payload : payload.roomCode;
        player.roomCode = roomCode;
        player.isHost = Boolean(payload && payload.isHost);
        console.log(`[room-created] ${name} in ${roomCode}, host=${player.isHost}`);
    });

    socket.on("prophunt-state", (state) => {
        player.latestState = state;
    });

    socket.on("prophunt-error", (message) => {
        player.errors.push(String(message || ""));
        console.log(`[prophunt-error] ${name}: ${message}`);
    });

    socket.on("join-error", (message) => {
        player.errors.push(String(message || ""));
        console.log(`[join-error] ${name}: ${message}`);
    });

    return player;
}

function stateOf(player) {
    return player.latestState || {};
}

async function expectErrorAfter(player, fn, contains, timeoutMs = 5000) {
    const before = player.errors.length;
    fn();
    await waitFor(
        () => player.errors.length > before,
        timeoutMs,
        `${player.name} expected an error containing '${contains}'`
    );

    const message = player.errors[player.errors.length - 1] || "";
    if (!message.toLowerCase().includes(contains.toLowerCase())) {
        throw new Error(`${player.name} expected error containing '${contains}', got '${message}'`);
    }
}

async function main() {
    console.log(`[simulation] target=${SERVER_URL}, path=${SOCKET_PATH}`);
    const players = PLAYER_NAMES.map(makePlayer);
    try {
        const host = players[0];

        await delay(500);

        host.socket.emit("host-room", { name: host.name, visibility: "private" });
        await waitFor(() => Boolean(host.roomCode), 8000, "Host room was not created");

        const roomCode = host.roomCode;
        for (let i = 1; i < players.length; i += 1) {
            players[i].socket.emit("join-room", { roomCode, name: players[i].name });
        }

        await delay(800);
        host.socket.emit("select-gamemode", { roomCode, gameMode: "programmerProphunt" });
        await delay(300);

        host.socket.emit("start-prophunt", {
            roomCode,
            complexity: "easy",
            roundSeconds: 30,
            rounds: 1,
        });

        await waitFor(
            () => players.every((player) => stateOf(player).active && stateOf(player).phase === "hiding"),
            8000,
            "Did not reach hiding phase"
        );

        const hiders = players.filter((player) => stateOf(player).role === "hider");
        const finders = players.filter((player) => stateOf(player).role === "finder");

        if (hiders.length !== 2 || finders.length !== 2) {
            throw new Error(`Expected 2 hiders and 2 finders, got hiders=${hiders.length}, finders=${finders.length}`);
        }

        const hiderA = hiders[0];
        const hiderB = hiders[1];
        const finderA = finders[0];
        const finderB = finders[1];

        console.log(`[roles] hiders: ${hiderA.name}, ${hiderB.name}; finders: ${finderA.name}, ${finderB.name}`);

        await expectErrorAfter(
            finderA,
            () =>
                finderA.socket.emit("prophunt-edit-line", { roomCode, lineRef: "B:1", lineText: "const nope = true;" }),
            "Only the hiding team can edit"
        );

        await expectErrorAfter(
            hiderA,
            () => hiderA.socket.emit("prophunt-confirm-hider", { roomCode }),
            "Apply one line edit before confirming"
        );

        const hiderABaseRef = stateOf(hiderA).editableLineOptions.find((opt) => opt.ref !== "NEW_LINE").ref;
        hiderA.socket.emit("prophunt-edit-line", {
            roomCode,
            lineRef: hiderABaseRef,
            lineText: "  // hider A touched this line",
        });

        await delay(300);

        await expectErrorAfter(
            hiderB,
            () =>
                hiderB.socket.emit("prophunt-edit-line", {
                    roomCode,
                    lineRef: hiderABaseRef,
                    lineText: "  // illegal collision",
                }),
            "already controls that line"
        );

        await expectErrorAfter(
            hiderA,
            () => hiderA.socket.emit("prophunt-edit-line", { roomCode, lineRef: "B:999", lineText: "bad" }),
            "Invalid line target"
        );

        await expectErrorAfter(
            hiderA,
            () => hiderA.socket.emit("prophunt-edit-line", { roomCode, lineRef: "NEW_LINE", lineText: "   " }),
            "cannot be empty"
        );

        hiderB.socket.emit("prophunt-edit-line", {
            roomCode,
            lineRef: "NEW_LINE",
            lineText: "  const hiddenFlag = true;",
        });

        await delay(250);

        hiderA.socket.emit("prophunt-confirm-hider", { roomCode });
        hiderB.socket.emit("prophunt-confirm-hider", { roomCode });

        await waitFor(
            () => players.every((player) => stateOf(player).active && stateOf(player).phase === "finding"),
            8000,
            "Did not reach finding phase"
        );

        const finderOptions = stateOf(finderA).finderLineOptions;
        if (!Array.isArray(finderOptions) || finderOptions.length < 2) {
            throw new Error("Need at least 2 visible lines for finder uniqueness test");
        }

        const firstGuess = finderOptions[0].ref;
        const secondGuess = finderOptions[1].ref;

        finderA.socket.emit("prophunt-confirm-finder", { roomCode, lineRef: firstGuess });
        await delay(250);

        await expectErrorAfter(
            finderB,
            () => finderB.socket.emit("prophunt-confirm-finder", { roomCode, lineRef: firstGuess }),
            "already selected that line"
        );

        await expectErrorAfter(
            finderA,
            () => finderA.socket.emit("prophunt-confirm-finder", { roomCode, lineRef: secondGuess }),
            "already confirmed your guess"
        );

        finderB.socket.emit("prophunt-confirm-finder", { roomCode, lineRef: secondGuess });

        await waitFor(
            () =>
                players.every((player) => {
                    const state = stateOf(player);
                    return !state.active && Boolean(state.lastResultMessage);
                }),
            10000,
            "Game did not finish after finder confirmations"
        );

        const result = stateOf(host).lastResultMessage || "";
        console.log(`[result] ${result}`);

        console.log("[simulation] Programmer Prophunt bug-sequence simulation completed successfully.");
    } finally {
        players.forEach((player) => player.socket.disconnect());
    }
}

main().catch((err) => {
    console.error(`[simulation] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
});
