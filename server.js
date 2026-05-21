/**
 * @file server.js
 * @description Application entry point. Configures Express static routes, initialises
 * Socket.IO, wires up all socket event handlers, and starts the HTTP server.
 *
 * Game-specific logic lives in each game mode's service module:
 *   - gameModes/bug-fixer/bug-fixer-service.js
 *   - gameModes/programmer-prophunt/prophunt-service.js
 *
 * Shared infrastructure lives in src/:
 *   - src/constants.js
 *   - src/utils.js
 *   - src/room-manager.js
 */

"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const LogicCAH = require("./gameModes/logic-cah/logic-cah.js");
const ProgrammerProphunt = require("./gameModes/programmer-prophunt/programmer-prophunt.js");

const { createBugFixerService } = require("./gameModes/bug-fixer/bug-fixer-service.js");
const { createProphuntService } = require("./gameModes/programmer-prophunt/prophunt-service.js");

const {
    rooms,
    loadGameModes,
    createRoom,
    touchRoom,
    touchRoomByCode,
    clearAllBugFixerTimers,
    clearProphuntTimers,
    emitRoomUpdate,
    removeSocketFromRooms,
    runRoomJanitor,
    getPreferredGameModes,
    findAvailablePublicRoomsByGames,
} = require("./src/room-manager.js");

const { normalizeName, randomItem } = require("./src/utils.js");
const constants = require("./src/constants.js");
const { ROOM_JANITOR_INTERVAL_MS } = constants;

// ─── Express & Socket.IO Setup ───────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Static file routes — each game mode serves its own directory.
app.use(express.static("public"));
app.use("/code-typer", express.static("gameModes/code-typer"));
app.use("/code-typer-multiplayer", express.static("gameModes/code-typer-multiplayer"));
app.use("/flexbox-spider", express.static("gameModes/flexbox-spider"));
app.use("/escape-the-loop", express.static("gameModes/escape-the-loop"));
app.use("/logic-cah", express.static("gameModes/logic-cah"));

// ─── Game Services ────────────────────────────────────────────────────────────

/** @type {ReturnType<createBugFixerService>} */
const bugFixerService = createBugFixerService(io, rooms);

/** @type {ReturnType<createProphuntService>} */
const prophuntService = createProphuntService(io, rooms);

// ─── Game Mode Registry ───────────────────────────────────────────────────────

const gameModesData = loadGameModes(__dirname);
const validGameModeNames = new Set(gameModesData.map((entry) => entry && entry.name).filter(Boolean));

// ─── Room Janitor ─────────────────────────────────────────────────────────────

setInterval(runRoomJanitor, ROOM_JANITOR_INTERVAL_MS);

// ─── Socket.IO Handlers ───────────────────────────────────────────────────────

io.on("connection", (socket) => {
    // ── Lobby Chat ────────────────────────────────────────────────────────────

    socket.on("lobby-chat", ({ roomCode, name, message }) => {
        const room = rooms[roomCode];
        if (!room) return;
        socket.to(roomCode).emit("lobby-chat", { name, message });
    });

    socket.on("lobby-reaction", ({ roomCode, name, emoji }) => {
        const room = rooms[roomCode];
        if (!room) return;
        io.to(roomCode).emit("lobby-reaction", { name, emoji });
    });

    // ── Room Hosting ──────────────────────────────────────────────────────────

    socket.on("host-room", (payload) => {
        const rawName = typeof payload === "object" && payload !== null ? payload.name : payload;
        const visibility =
            typeof payload === "object" && payload !== null && payload.visibility === "public" ? "public" : "private";

        const trimmedName = String(rawName || "").trim();
        if (!trimmedName) {
            socket.emit("join-error", "Name is required.");
            return;
        }

        const roomCode = createRoom({
            hostId: socket.id,
            hostName: trimmedName,
            visibility,
            selectedGame: null,
        });

        socket.join(roomCode);
        touchRoomByCode(roomCode, "host-room");
        socket.emit("room-created", { roomCode, visibility, isHost: true });
        emitRoomUpdate(roomCode, io);
    });

    // ── Random Matchmaking ────────────────────────────────────────────────────

    socket.on("join-random-room", ({ name, preferredGameModes }) => {
        const trimmedName = String(name || "").trim();
        if (!trimmedName) {
            socket.emit("join-error", "Name is required.");
            return;
        }

        const preferred = getPreferredGameModes(preferredGameModes, validGameModeNames);
        if (preferred.length === 0) {
            socket.emit("join-error", "Select at least one valid game for random matchmaking.");
            return;
        }

        const availableRooms = findAvailablePublicRoomsByGames(preferred);
        let targetRoomCode = null;
        let targetRoom = null;
        let created = false;

        if (availableRooms.length > 0) {
            const byGame = {};
            availableRooms.forEach((entry) => {
                if (!byGame[entry.room.selectedGame]) byGame[entry.room.selectedGame] = [];
                byGame[entry.room.selectedGame].push(entry);
            });

            const selectedGame = randomItem(Object.keys(byGame));
            const roomEntry = randomItem(byGame[selectedGame]);
            targetRoomCode = roomEntry.roomCode;
            targetRoom = roomEntry.room;
        } else {
            const selectedGame = randomItem(preferred);
            targetRoomCode = createRoom({
                hostId: socket.id,
                hostName: trimmedName,
                visibility: "public",
                selectedGame,
            });
            targetRoom = rooms[targetRoomCode];
            created = true;
        }

        const isDuplicateName =
            !created && targetRoom.players.some((player) => normalizeName(player.name) === normalizeName(trimmedName));
        if (isDuplicateName) {
            socket.emit("join-error", "That name is already in this lobby. Choose a different name.");
            return;
        }

        if (!created) {
            targetRoom.players.push({ id: socket.id, name: trimmedName });
        }

        socket.join(targetRoomCode);
        touchRoomByCode(targetRoomCode, created ? "random-room-created" : "random-room-joined");

        socket.emit("room-created", {
            roomCode: targetRoomCode,
            visibility: "public",
            isHost: created,
            selectedGame: targetRoom.selectedGame,
        });

        emitRoomUpdate(targetRoomCode, io);
        io.to(targetRoomCode).emit("gamemode-selected", targetRoom.selectedGame);

        if (targetRoom.selectedGame === "bugFixerGame") {
            bugFixerService.emitBugFixerState(targetRoomCode);
        } else if (targetRoom.selectedGame === "programmerProphunt") {
            prophuntService.emitProphuntState(targetRoomCode);
        }
    });

    // ── Private Room Join ─────────────────────────────────────────────────────

    socket.on("join-room", ({ roomCode, name }) => {
        if (!rooms[roomCode]) {
            socket.emit("join-error", "Room does not exist");
            return;
        }

        const room = rooms[roomCode];
        if (room.visibility === "public") {
            socket.emit("join-error", "This is a public random lobby. Use random matchmaking to join public games.");
            return;
        }

        const normalizedName = normalizeName(name);
        if (!normalizedName) {
            socket.emit("join-error", "Name is required.");
            return;
        }

        const isDuplicate = room.players.some((player) => normalizeName(player.name) === normalizedName);
        if (isDuplicate) {
            socket.emit("join-error", "That name is already in this lobby. Choose a different name.");
            return;
        }

        if (room.selectedGame === "bugFixerGame" && room.bugFixer && room.bugFixer.active) {
            socket.emit("join-error", "Bug Fixer is already in progress. Please wait for the next game.");
            return;
        }
        if (room.selectedGame === "programmerProphunt" && room.prophunt && room.prophunt.active) {
            socket.emit("join-error", "Programmer Prophunt is already in progress. Please wait for the next game.");
            return;
        }

        room.players.push({ id: socket.id, name: String(name).trim() });
        socket.join(roomCode);
        touchRoom(room, "join-room");
        socket.emit("room-joined", { roomCode, hostId: room.host });

        emitRoomUpdate(roomCode, io);

        if (room.selectedGame) {
            socket.emit("gamemode-selected", room.selectedGame);
            if (room.selectedGame === "bugFixerGame") {
                bugFixerService.emitBugFixerState(roomCode);
            } else if (room.selectedGame === "programmerProphunt") {
                prophuntService.emitProphuntState(roomCode);
            }
        }
    });

    // ── Game Mode Selection ───────────────────────────────────────────────────

    socket.on("select-gamemode", ({ roomCode, gameMode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.visibility === "public") return;

        room.selectedGame = gameMode;
        touchRoom(room, "select-gamemode");

        if (room.bugFixer) clearAllBugFixerTimers(room.bugFixer);
        if (room.prophunt) clearProphuntTimers(room.prophunt);
        room.bugFixer = null;
        room.prophunt = null;

        io.to(roomCode).emit("gamemode-selected", gameMode);

        if (gameMode === "bugFixerGame") {
            bugFixerService.emitBugFixerState(roomCode);
        } else if (gameMode === "programmerProphunt") {
            prophuntService.emitProphuntState(roomCode);
        }
    });

    // ── Programmer Prophunt Handlers ──────────────────────────────────────────

    socket.on("start-prophunt", (payload) => {
        const roomCode = payload && payload.roomCode;
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.selectedGame !== "programmerProphunt") return;

        const error = prophuntService.initializeProphunt(roomCode, payload || {});
        if (error) {
            socket.emit("prophunt-error", error);
            return;
        }
        touchRoomByCode(roomCode, "start-prophunt");
    });

    socket.on("prophunt-edit-line", ({ roomCode, lineRef, lineText }) => {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "programmerProphunt" || !room.prophunt || !room.prophunt.active) return;

        const state = room.prophunt;
        if (state.phase !== "hiding") {
            socket.emit("prophunt-error", "You can only edit during the hiding phase.");
            return;
        }

        const playerTeam = prophuntService.getPlayerTeam(state, socket.id);
        if (playerTeam !== state.hidingTeam) {
            socket.emit("prophunt-error", "Only the hiding team can edit right now.");
            return;
        }

        const text = String(lineText || "");
        if (!text.trim()) {
            socket.emit("prophunt-error", "Line content cannot be empty.");
            return;
        }

        let targetRef = lineRef;
        let isNew = false;
        if (lineRef === "NEW_LINE") {
            targetRef = `N:${socket.id}`;
            isNew = true;
        } else {
            const exists = (state.baseLines || []).some((line) => line.ref === lineRef);
            if (!exists) {
                socket.emit("prophunt-error", "Invalid line target.");
                return;
            }
        }

        const takenByOther = Object.entries(state.hiderAssignments || {}).some(
            ([playerId, assignment]) => playerId !== socket.id && assignment && assignment.lineRef === targetRef
        );
        if (takenByOther) {
            socket.emit("prophunt-error", "Another hider already controls that line.");
            return;
        }

        state.hiderAssignments[socket.id] = { lineRef: targetRef, text, isNew, confirmed: false };
        touchRoomByCode(roomCode, "prophunt-edit-line");
        state.message = `${prophuntService.getPlayerName(room, socket.id)} updated their line.`;
        prophuntService.emitProphuntState(roomCode);
    });

    socket.on("prophunt-confirm-hider", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "programmerProphunt" || !room.prophunt || !room.prophunt.active) return;

        const state = room.prophunt;
        if (state.phase !== "hiding") return;
        if (prophuntService.getPlayerTeam(state, socket.id) !== state.hidingTeam) return;

        const assignment = state.hiderAssignments[socket.id];
        if (!assignment || !assignment.text.trim()) {
            socket.emit("prophunt-error", "Apply one line edit before confirming.");
            return;
        }

        assignment.confirmed = true;
        touchRoomByCode(roomCode, "prophunt-confirm-hider");

        const allConfirmed = state.teams[state.hidingTeam].every((playerId) => {
            const entry = state.hiderAssignments[playerId];
            return entry && entry.confirmed;
        });

        if (allConfirmed) {
            prophuntService.finishProphuntHidingPhase(roomCode, false);
            return;
        }

        prophuntService.emitProphuntState(roomCode);
    });

    socket.on("prophunt-confirm-finder", ({ roomCode, lineRef }) => {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "programmerProphunt" || !room.prophunt || !room.prophunt.active) return;

        const state = room.prophunt;
        if (state.phase !== "finding") return;
        if (prophuntService.getPlayerTeam(state, socket.id) !== state.finderTeam) return;

        if (state.finderGuesses[socket.id] && state.finderGuesses[socket.id].confirmed) {
            socket.emit("prophunt-error", "You already confirmed your guess for this round.");
            return;
        }

        const composed = prophuntService.buildProphuntComposedLines(room, state);
        if (!composed.some((line) => line.ref === lineRef)) {
            socket.emit("prophunt-error", "Choose a valid suspicious line.");
            return;
        }

        const takenByOtherFinder = Object.entries(state.finderGuesses).some(
            ([playerId, guess]) => playerId !== socket.id && guess && guess.confirmed && guess.lineRef === lineRef
        );
        if (takenByOtherFinder) {
            socket.emit("prophunt-error", "Another finder already selected that line.");
            return;
        }

        state.finderGuesses[socket.id] = { lineRef, confirmed: true };
        touchRoomByCode(roomCode, "prophunt-confirm-finder");

        const allFindersDone = state.teams[state.finderTeam].every((playerId) => {
            const guess = state.finderGuesses[playerId];
            return guess && guess.confirmed;
        });

        if (allFindersDone) {
            prophuntService.finalizeProphuntRound(roomCode, false);
            return;
        }

        prophuntService.emitProphuntState(roomCode);
    });

    // ── Bug Fixer Handlers ────────────────────────────────────────────────────

    socket.on("start-bugfixer", (payload) => {
        const roomCode = payload && payload.roomCode;
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.selectedGame !== "bugFixerGame") return;

        const error = bugFixerService.initializeBugFixer(roomCode, payload || {});
        if (error) {
            socket.emit("bugfixer-error", error);
            return;
        }
        touchRoomByCode(roomCode, "start-bugfixer");
    });

    socket.on("bugfixer-submit", ({ roomCode, chosenCards }) => {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "bugFixerGame" || !room.bugFixer || !room.bugFixer.active) return;

        const round = room.bugFixer.currentRound;
        if (!round || round.phase !== "submitting") return;
        if (socket.id === round.deciderId) return;

        const hand = room.bugFixer.hands[socket.id] || [];
        if (!Array.isArray(chosenCards) || chosenCards.length !== round.responsesRequired) {
            socket.emit("bugfixer-error", `Submit exactly ${round.responsesRequired} card(s).`);
            return;
        }

        const uniqueCards = [...new Set(chosenCards)];
        if (uniqueCards.length !== chosenCards.length) {
            socket.emit("bugfixer-error", "Do not submit duplicate cards.");
            return;
        }

        if (!chosenCards.every((card) => hand.includes(card))) {
            socket.emit("bugfixer-error", "Submission contains cards not in your hand.");
            return;
        }

        round.submissions[socket.id] = {
            playerId: socket.id,
            cards: chosenCards,
            text: chosenCards.join(" | "),
        };
        touchRoomByCode(roomCode, "bugfixer-submit");

        const nonDeciderCount = room.players.length - 1;
        if (Object.keys(round.submissions).length >= nonDeciderCount) {
            bugFixerService.enterJudgingPhase(roomCode);
            return;
        }

        bugFixerService.emitBugFixerState(roomCode);
    });

    socket.on("bugfixer-pick-winner", ({ roomCode, submissionId }) => {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "bugFixerGame" || !room.bugFixer || !room.bugFixer.active) return;

        const round = room.bugFixer.currentRound;
        if (!round || (round.phase !== "judging" && round.phase !== "confirming") || round.deciderId !== socket.id)
            return;

        const picked = round.submissionOptions.find((option) => option.submissionId === submissionId);
        if (!picked) {
            socket.emit("bugfixer-error", "Invalid winner selection.");
            return;
        }

        bugFixerService.clearBugFixerTimer(room.bugFixer, "deciderTimeout");
        bugFixerService.clearBugFixerTimer(room.bugFixer, "finalizeTimeout");

        round.phase = "confirming";
        round.pendingWinnerPlayerId = picked.playerId;
        round.pendingWinnerSubmissionId = picked.submissionId;
        round.finalizeDeadlineAt = Date.now() + constants.BUG_FIXER_FINALIZE_DELAY_MS;
        touchRoomByCode(roomCode, "bugfixer-pick-winner");

        room.bugFixer.timerHandles.finalizeTimeout = setTimeout(() => {
            bugFixerService.finalizeBugFixerRound(roomCode, {
                winnerPlayerId: picked.playerId,
                reason: "decider-picked",
            });
        }, constants.BUG_FIXER_FINALIZE_DELAY_MS);

        room.bugFixer.lastResult = {
            message: `${bugFixerService.buildBugFixerPayloadForPlayer(room, round.deciderId).deciderName} selected a winner. Finalizing in 10 seconds (selection can still be changed).`,
            revealedSubmissions: [],
        };

        bugFixerService.emitBugFixerState(roomCode);
    });

    // ── Game Termination ──────────────────────────────────────────────────────

    socket.on("terminate-game", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || !room.selectedGame) return;

        const terminatedGame = room.selectedGame;
        if (room.bugFixer) clearAllBugFixerTimers(room.bugFixer);
        if (room.prophunt) clearProphuntTimers(room.prophunt);

        room.selectedGame = null;
        room.bugFixer = null;
        room.prophunt = null;
        room.game = null;
        room.gameMode = null;
        room.gameState = "LOBBY";
        touchRoom(room, "terminate-game");

        io.to(roomCode).emit("game-terminated", {
            gameMode: terminatedGame,
            byHost: room.players.find((player) => player.id === socket.id)?.name || "Host",
        });
    });

    // ── Legacy Game Handlers (LogicCAH / ProgrammerProphunt class-based) ──────

    socket.on("leave-game", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || !room.game || !room.gameMode) return;

        if (typeof room.game.removePlayer === "function") {
            room.game.removePlayer(socket.id);
        }

        if (room.gameMode === "LogicCAH") {
            io.to(roomCode).emit("game-started", {
                gameMode: "LogicCAH",
                gameState: room.gameState,
                status: room.game.getGameStatus(),
            });
        } else if (room.gameMode === "ProgrammerProphunt") {
            io.to(roomCode).emit("game-started", {
                gameMode: "ProgrammerProphunt",
                gameState: room.gameState,
                status: room.game.getGameStatus(),
            });
        }

        socket.emit("left-game");
    });

    socket.on("start-game", ({ roomCode, gameMode, numRounds, timeLimit, complexity, numPrompts }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) {
            socket.emit("error", "Not authorized to start game");
            return;
        }

        if (room.players.length < 2) {
            socket.emit("error", "Need at least 2 players to start");
            return;
        }

        if (gameMode === "LogicCAH") {
            room.game = new LogicCAH(room.players, numRounds, timeLimit, numPrompts);
        } else if (gameMode === "ProgrammerProphunt") {
            room.game = new ProgrammerProphunt(room.players, numRounds, timeLimit, complexity);
        } else {
            socket.emit("error", "Invalid game mode");
            return;
        }

        room.gameMode = gameMode;
        room.gameState = "PLAYING";

        io.to(roomCode).emit("game-started", {
            gameMode,
            gameState: room.gameState,
            status: room.game.getGameStatus(),
        });
    });

    socket.on("logiccah-rejoin-room", ({ roomCode, name, isHost }) => {
        const room = rooms[roomCode];
        if (!room) return;

        socket.join(roomCode);

        if (isHost) room.host = socket.id;

        let player = room.players.find((p) => p.name === name);
        if (!player) {
            room.players.push({ id: socket.id, name });
        } else {
            const oldId = player.id;
            player.id = socket.id;
            if (room.host === oldId) room.host = socket.id;
        }

        if (room.game && Array.isArray(room.game.players)) {
            const gamePlayer = room.game.players.find((p) => p.name === name);
            if (gamePlayer) gamePlayer.id = socket.id;
        }

        if (room.game && room.gameMode === "LogicCAH") {
            socket.emit("game-started", {
                gameMode: "LogicCAH",
                gameState: room.gameState,
                status: room.game.getGameStatus(),
            });
        }
    });

    socket.on("submit-answers", ({ roomCode, answers }) => {
        const room = rooms[roomCode];
        if (!room || !room.game || room.gameMode !== "LogicCAH") return;

        try {
            const result = room.game.submitAnswers(socket.id, answers);

            io.to(roomCode).emit("answers-submitted", {
                success: true,
                allSubmitted: result.allSubmitted,
                playerId: socket.id,
            });

            if (result.allSubmitted) {
                io.to(roomCode).emit("show-answers", {
                    answers: room.game.getAnonymousAnswers(),
                    deciderName: room.game.getCurrentDecider().name,
                });
            }
        } catch (error) {
            socket.emit("error", error.message);
        }
    });

    socket.on("decider-select", ({ roomCode, selectedPlayerId }) => {
        const room = rooms[roomCode];
        if (!room || !room.game || room.gameMode !== "LogicCAH") return;

        try {
            room.game.deciderSelectsAnswers(selectedPlayerId);
            const revealed = room.game.revealSelectedPlayer();

            io.to(roomCode).emit("selected-player-revealed", {
                selectedPlayerName: revealed.selectedPlayerName,
                points: revealed.points,
            });

            setTimeout(() => {
                room.game.completeRound();
                if (room.game.isGameOver()) {
                    io.to(roomCode).emit("game-over", { finalScores: room.game.getFinalScores() });
                    room.gameState = "LOBBY";
                } else {
                    io.to(roomCode).emit("round-completed", { status: room.game.getGameStatus() });
                }
            }, 3000);
        } catch (error) {
            socket.emit("error", error.message);
        }
    });

    socket.on("submit-hider-line", ({ roomCode, codeLine }) => {
        const room = rooms[roomCode];
        if (!room || !room.game || room.gameMode !== "ProgrammerProphunt") return;

        try {
            const result = room.game.submitHiderLine(socket.id, codeLine);

            io.to(roomCode).emit("hider-line-submitted", {
                success: true,
                allSubmitted: result.allSubmitted,
                playerId: socket.id,
            });

            if (result.allSubmitted) {
                io.to(roomCode).emit("show-code-and-finders", {
                    codeBlock: room.game.getCodeBlock(),
                    finderNames: room.game.getFindingTeam().map((p) => p.name),
                });
            }
        } catch (error) {
            socket.emit("error", error.message);
        }
    });

    socket.on("finder-select", ({ roomCode, selectedHiderId }) => {
        const room = rooms[roomCode];
        if (!room || !room.game || room.gameMode !== "ProgrammerProphunt") return;

        try {
            room.game.finderSelectsHider(socket.id, selectedHiderId);

            io.to(roomCode).emit("finder-selection-made", {
                success: true,
                allSubmitted: room.game.allFindersSubmitted(),
                playerId: socket.id,
            });

            if (room.game.allFindersSubmitted()) {
                const results = room.game.getRoundResults();
                const hiderNames = room.game.getHidingTeam().map((h) => ({ id: h.id, name: h.name }));

                io.to(roomCode).emit("round-results", {
                    findersScore: results.findersScore,
                    hidersScore: results.hidersScore,
                    correctlyIdentified: results.correctlyIdentified.map(
                        (id) => hiderNames.find((h) => h.id === id).name
                    ),
                    notIdentified: results.notIdentified.map((id) => hiderNames.find((h) => h.id === id).name),
                    scores: room.game.scores,
                });

                setTimeout(() => {
                    room.game.completeRound();
                    if (room.game.isGameOver()) {
                        io.to(roomCode).emit("game-over", { finalScores: room.game.getFinalScores() });
                        room.gameState = "LOBBY";
                    } else {
                        io.to(roomCode).emit("round-completed", { status: room.game.getGameStatus() });
                    }
                }, 3000);
            }
        } catch (error) {
            socket.emit("error", error.message);
        }
    });

    // ── Game Hub Navigation ───────────────────────────────────────────────────

    socket.on("host-entering-gamehub", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        touchRoom(room, "host-entering-gamehub");
        socket.to(roomCode).emit("host-selecting-game");
    });

    socket.on("host-left-gamehub", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        touchRoom(room, "host-left-gamehub");
        socket.to(roomCode).emit("host-left-gamehub");
    });

    socket.on("launch-redirect-game", ({ roomCode, url }) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id) return;
        const allowedPrefixes = ["/code-typer/", "/flexbox-spider/", "/logic-cah/"];
        if (!allowedPrefixes.some((prefix) => url.startsWith(prefix))) return;
        touchRoom(room, "launch-redirect-game");
        socket.to(roomCode).emit("redirect-to-game", { url });
    });

    // ── Code Typer Multiplayer ────────────────────────────────────────────────

    socket.on("start-codetyper-multiplayer", (payload) => {
        const roomCode = payload && payload.roomCode;
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.selectedGame !== "codeTyperMultiplayer") return;

        touchRoom(room, "start-codetyper-multiplayer");
        io.to(roomCode).emit("launch-codetyper", { roomCode });
    });

    socket.on("codetyper-rejoin-room", ({ roomCode, name }) => {
        const room = rooms[roomCode];
        if (!room) return;
        socket.join(roomCode);
        if (!room.codeTyperMultiplayer) {
            room.codeTyperMultiplayer = { players: {} };
        }
        room.codeTyperMultiplayer.players[socket.id] = {
            name,
            isFinished: false,
            progress: 0,
            wpm: 0,
        };
        touchRoom(room, "codetyper-rejoin-room");
    });

    socket.on("codetyper-progress", ({ roomCode, progress, wpm }) => {
        const room = rooms[roomCode];
        if (!room || !room.codeTyperMultiplayer || !room.codeTyperMultiplayer.players[socket.id]) return;

        room.codeTyperMultiplayer.players[socket.id].progress = progress;
        room.codeTyperMultiplayer.players[socket.id].wpm = wpm;
        touchRoom(room, "codetyper-progress");
        io.to(roomCode).emit("codetyper-progress-update", room.codeTyperMultiplayer.players);
    });

    socket.on("codetyper-finished", ({ roomCode, time }) => {
        const room = rooms[roomCode];
        if (!room || !room.codeTyperMultiplayer || !room.codeTyperMultiplayer.players[socket.id]) return;

        room.codeTyperMultiplayer.players[socket.id].isFinished = true;
        room.codeTyperMultiplayer.players[socket.id].time = time;
        touchRoom(room, "codetyper-finished");
        io.to(roomCode).emit("codetyper-progress-update", room.codeTyperMultiplayer.players);
    });

    socket.on("codetyper-sync-snippet", ({ roomCode, snippet }) => {
        const room = rooms[roomCode];
        if (!room) return;
        touchRoom(room, "codetyper-sync-snippet");
        io.to(roomCode).emit("codetyper-set-snippet", snippet);
    });

    // ── Disconnect / Cleanup ──────────────────────────────────────────────────

    socket.on("client-cleanup", ({ roomCode }) => {
        if (roomCode && rooms[roomCode]) {
            touchRoomByCode(roomCode, "client-cleanup");
        }
        removeSocketFromRooms(
            socket.id,
            "client-cleanup",
            io,
            bugFixerService.emitBugFixerState,
            bugFixerService.startNextBugFixerRound,
            bugFixerService.ensureBugFixerPlayerState,
            prophuntService.emitProphuntState,
            constants
        );
    });

    socket.on("disconnect", () => {
        removeSocketFromRooms(
            socket.id,
            "disconnect",
            io,
            bugFixerService.emitBugFixerState,
            bugFixerService.startNextBugFixerRound,
            bugFixerService.ensureBugFixerPlayerState,
            prophuntService.emitProphuntState,
            constants
        );
    });
});

// ─── Server Start ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    let hostIp = "<your-ip>";
    try {
        const _os = require("os");
        const interfaces = _os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === "IPv4" && !iface.internal) {
                    hostIp = iface.address;
                    break;
                }
            }
            if (hostIp !== "<your-ip>") break;
        }
    } catch (e) {
        // Fallback to placeholder if something goes wrong
    }

    console.log(`Server running on port ${PORT}`);
    console.log(`Localhost: http://localhost:${PORT}`);
    console.log(`Accessible from local network: http://${hostIp}:${PORT}`);
});
