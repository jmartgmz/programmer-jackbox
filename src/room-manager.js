/**
 * @file room-manager.js
 * @description Manages the in-memory rooms registry and all room lifecycle operations:
 * creation, player removal, activity tracking, periodic janitor cleanup, and
 * public-room discovery for random matchmaking.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { shuffle, randomItem, normalizeName } = require("./utils");
const {
    ROOM_IDLE_TTL_MS,
    ROOM_SOFT_CLEANUP_TTL_MS,
    ROOM_JANITOR_INTERVAL_MS,
    CLEANUP_ARCHIVE_LIMIT,
} = require("./constants");

/**
 * In-memory registry of all active rooms, keyed by room code.
 * Shape: `{ [roomCode]: { host, players, selectedGame, visibility, bugFixer, prophunt, ... } }`
 * @type {Object.<string, Object>}
 */
const rooms = {};

/**
 * Rolling log of recent room cleanup and removal events, capped at CLEANUP_ARCHIVE_LIMIT entries.
 * @type {Array<Object>}
 */
const cleanupArchive = [];

/**
 * Appends an entry to the cleanup archive, capping its length at CLEANUP_ARCHIVE_LIMIT.
 * @param {Object} entry - Descriptive event object to archive.
 */
function appendCleanupArchive(entry) {
    cleanupArchive.push({ ...entry, at: Date.now() });
    if (cleanupArchive.length > CLEANUP_ARCHIVE_LIMIT) {
        cleanupArchive.splice(0, cleanupArchive.length - CLEANUP_ARCHIVE_LIMIT);
    }
}

/**
 * Clears all pending timer handles for a room's active game (Bug Fixer and Prophunt).
 * Safe to call with a null/undefined room.
 * @param {Object|null} room - The room object.
 */
function clearRoomTimers(room) {
    if (!room) return;
    if (room.bugFixer) {
        clearAllBugFixerTimers(room.bugFixer);
    }
    if (room.prophunt) {
        clearProphuntTimers(room.prophunt);
    }
}

/**
 * Clears all Bug Fixer timer handles stored on a bug fixer state object.
 * Delegated here to avoid a circular dependency with bug-fixer-service.
 * @param {Object} state - The bug fixer state object with a `timerHandles` map.
 */
function clearAllBugFixerTimers(state) {
    if (!state || !state.timerHandles) return;
    for (const key of Object.keys(state.timerHandles)) {
        if (state.timerHandles[key]) {
            clearTimeout(state.timerHandles[key]);
            state.timerHandles[key] = null;
        }
    }
}

/**
 * Clears the Prophunt phase timeout handle.
 * @param {Object} state - The prophunt state object.
 */
function clearProphuntTimers(state) {
    if (!state || !state.timerHandles) return;
    if (state.timerHandles.phaseTimeout) {
        clearTimeout(state.timerHandles.phaseTimeout);
        state.timerHandles.phaseTimeout = null;
    }
}

/**
 * Updates a room's last activity timestamp and reason.
 * @param {Object|null} room - The room object to touch.
 * @param {string} [reason="activity"] - Human-readable label for the activity.
 */
function touchRoom(room, reason = "activity") {
    if (!room) return;
    room.lastActivityAt = Date.now();
    room.lastActivityReason = reason;
}

/**
 * Updates the last activity timestamp for a room looked up by its code.
 * No-op if the room does not exist.
 * @param {string} roomCode - The room code to look up.
 * @param {string} [reason="activity"] - Human-readable label for the activity.
 */
function touchRoomByCode(roomCode, reason = "activity") {
    const room = rooms[roomCode];
    if (!room) return;
    touchRoom(room, reason);
}

/**
 * Returns true if a room currently has an active game in progress.
 * @param {Object|null} room - The room object.
 * @returns {boolean}
 */
function isRoomGameActive(room) {
    if (!room) return false;
    if (room.bugFixer && room.bugFixer.active) return true;
    if (room.prophunt && room.prophunt.active) return true;
    if (room.gameState === "PLAYING") return true;
    return false;
}

/**
 * Prunes stale player data from transient game caches within a room,
 * and soft-clears lobby game state if the room has been idle long enough.
 * @param {string} roomCode - The code of the room to prune.
 */
function pruneRoomTransientData(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const validPlayerIds = new Set((room.players || []).map((player) => player.id));

    if (room.codeTyperMultiplayer && room.codeTyperMultiplayer.players) {
        Object.keys(room.codeTyperMultiplayer.players).forEach((id) => {
            if (!validPlayerIds.has(id)) {
                delete room.codeTyperMultiplayer.players[id];
            }
        });

        if (Object.keys(room.codeTyperMultiplayer.players).length === 0) {
            delete room.codeTyperMultiplayer;
            appendCleanupArchive({ roomCode, action: "pruned-codetyper-cache" });
        }
    }

    const idleMs = Date.now() - (room.lastActivityAt || Date.now());
    if (idleMs >= ROOM_SOFT_CLEANUP_TTL_MS && !isRoomGameActive(room)) {
        if (room.gameState === "LOBBY" || !room.selectedGame) {
            room.game = null;
            room.gameMode = null;
            if (!room.selectedGame) {
                room.bugFixer = null;
                room.prophunt = null;
            }
        }
    }
}

/**
 * Removes a socket from all rooms it may be in, handling host reassignment,
 * game state cleanup, and empty-room deletion.
 * @param {string} socketId - The socket ID to remove.
 * @param {string} [reason="disconnect"] - The reason label for this removal.
 * @param {import("socket.io").Server} io - The Socket.IO server instance (for broadcasts).
 * @param {Function} emitBugFixerState - Service function to broadcast Bug Fixer state.
 * @param {Function} startNextBugFixerRound - Service function to start the next Bug Fixer round.
 * @param {Function} ensureBugFixerPlayerState - Service function to reconcile Bug Fixer player state.
 * @param {Function} emitProphuntState - Service function to broadcast Prophunt state.
 * @param {Object} constants - Game constants object.
 */
function removeSocketFromRooms(
    socketId,
    reason = "disconnect",
    io,
    emitBugFixerState,
    startNextBugFixerRound,
    ensureBugFixerPlayerState,
    emitProphuntState,
    constants
) {
    const { BUG_FIXER_MIN_PLAYERS, PROPHUNT_MIN_PLAYERS } = constants;

    for (const code in rooms) {
        const room = rooms[code];

        if (room.codeTyperMultiplayer && room.codeTyperMultiplayer.players[socketId]) {
            delete room.codeTyperMultiplayer.players[socketId];
            io.to(code).emit("codetyper-progress-update", room.codeTyperMultiplayer.players);
        }

        const index = room.players.findIndex((player) => player.id === socketId);

        if (index !== -1) {
            room.players.splice(index, 1);
            touchRoom(room, `player-${reason}`);

            if (room.players.length === 0) {
                clearRoomTimers(room);
                appendCleanupArchive({ roomCode: code, action: "removed-empty-room", reason });
                delete rooms[code];
            } else {
                if (room.host === socketId) {
                    room.host = room.players[0].id;
                }

                if (room.selectedGame === "bugFixerGame") {
                    if (room.bugFixer) {
                        clearAllBugFixerTimers(room.bugFixer);
                        ensureBugFixerPlayerState(room);
                    }

                    if (room.players.length < BUG_FIXER_MIN_PLAYERS) {
                        room.bugFixer = room.bugFixer || { scores: {}, hands: {}, roundNumber: 0 };
                        room.bugFixer.active = false;
                        room.bugFixer.currentRound = null;
                        room.bugFixer.lastResult = {
                            message: `Need at least ${BUG_FIXER_MIN_PLAYERS} players to continue.`,
                        };
                        emitBugFixerState(code);
                    } else if (room.bugFixer && room.bugFixer.active) {
                        startNextBugFixerRound(code);
                    } else {
                        emitBugFixerState(code);
                    }
                } else if (room.selectedGame === "programmerProphunt") {
                    if (room.prophunt) {
                        clearProphuntTimers(room.prophunt);
                    }

                    if (room.players.length < PROPHUNT_MIN_PLAYERS || room.players.length % 2 !== 0) {
                        room.prophunt = room.prophunt || {
                            scores: { A: 0, B: 0 },
                            timerHandles: { phaseTimeout: null },
                        };
                        room.prophunt.active = false;
                        room.prophunt.message = `Need at least ${PROPHUNT_MIN_PLAYERS} players and an even player count to continue.`;
                        room.prophunt.lastResultMessage = room.prophunt.message;
                        emitProphuntState(code);
                    } else if (room.prophunt && room.prophunt.active) {
                        room.prophunt.teams = {
                            A: room.prophunt.teams.A.filter((id) => room.players.some((player) => player.id === id)),
                            B: room.prophunt.teams.B.filter((id) => room.players.some((player) => player.id === id)),
                        };
                        emitProphuntState(code);
                    } else {
                        emitProphuntState(code);
                    }
                }

                emitRoomUpdate(code, io);
            }
        }
    }
}

/**
 * Periodic janitor that removes empty and idle rooms from the registry.
 * Intended to run on a setInterval timer.
 */
function runRoomJanitor() {
    const now = Date.now();

    // The janitor sweeps the room registry periodically to prevent memory leaks over time.
    // It is primarily responsible for ejecting completely abandoned rooms or wiping transient
    // data from rooms that are inactive (but structurally still alive).
    for (const roomCode of Object.keys(rooms)) {
        const room = rooms[roomCode];
        if (!room) continue;

        if (!room.lastActivityAt) {
            room.lastActivityAt = now;
        }

        // Soft cleanup: Removes heavyweight unneeded data from inactive rooms
        // (like previous round logs or cached game states) without tearing the room down entirely.
        pruneRoomTransientData(roomCode);

        // Case 1: Empty room. If everyone has disconnected, there's no reason to keep it around.
        if (!Array.isArray(room.players) || room.players.length === 0) {
            clearRoomTimers(room);
            appendCleanupArchive({ roomCode, action: "janitor-removed-empty-room" });
            delete rooms[roomCode];
            continue;
        }

        // Case 2: Room is actively playing a game.
        // We do *not* evict these, even if no explicit message was sent recently,
        // because users might be thinking/playing for an extended time.
        if (isRoomGameActive(room)) continue;

        // Case 3: Stale lobby. The room has players but hasn't launched any game
        // for longer than the maximum idle threshold (ROOM_IDLE_TTL_MS). Boot it out.
        const idleMs = now - room.lastActivityAt;
        if (idleMs >= ROOM_IDLE_TTL_MS) {
            clearRoomTimers(room);
            appendCleanupArchive({ roomCode, action: "janitor-removed-idle-room", idleMs });
            delete rooms[roomCode];
        }
    }
}

/**
 * Generates a random 6-character uppercase alphanumeric room code.
 * @returns {string} A room code, e.g. "X7KQ2A".
 */
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Creates a new room and adds it to the registry.
 * @param {Object} options
 * @param {string} options.hostId - Socket ID of the player hosting the room.
 * @param {string} options.hostName - Display name of the host.
 * @param {string} [options.visibility="private"] - "public" or "private".
 * @param {string|null} [options.selectedGame=null] - Pre-selected game mode name, if any.
 * @returns {string} The generated room code for the new room.
 */
function createRoom({ hostId, hostName, visibility = "private", selectedGame = null }) {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
        host: hostId,
        players: [{ id: hostId, name: hostName }],
        selectedGame,
        visibility,
        bugFixer: null,
        prophunt: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        lastActivityReason: "room-created",
    };
    return roomCode;
}

/**
 * Filters a list of preferred game mode names to only those that are valid and registered.
 * @param {string[]} preferredGameModes - Raw array of game mode name strings from the client.
 * @param {Set<string>} validGameModeNames - Set of valid game mode name strings from gamemodes.json.
 * @returns {string[]} Unique, valid game mode names.
 */
function getPreferredGameModes(preferredGameModes, validGameModeNames) {
    if (!Array.isArray(preferredGameModes)) return [];
    const unique = [...new Set(preferredGameModes.map((entry) => String(entry || "").trim()).filter(Boolean))];
    return unique.filter((game) => validGameModeNames.has(game));
}

/**
 * Finds all public rooms that are waiting (not active) and match one of the preferred games.
 * @param {string[]} preferredGames - List of preferred game mode names.
 * @returns {Array<{roomCode: string, room: Object}>} Matching room entries.
 */
function findAvailablePublicRoomsByGames(preferredGames) {
    const preferred = new Set(preferredGames);
    return Object.entries(rooms)
        .filter(([, room]) => {
            if (!room || room.visibility !== "public") return false;
            if (!room.selectedGame || !preferred.has(room.selectedGame)) return false;
            if (room.selectedGame === "bugFixerGame" && room.bugFixer && room.bugFixer.active) return false;
            if (room.selectedGame === "programmerProphunt" && room.prophunt && room.prophunt.active) return false;
            return true;
        })
        .map(([roomCode, room]) => ({ roomCode, room }));
}

/**
 * Emits a player-list update to all clients in a room, and refreshes the room's activity timestamp.
 * @param {string} roomCode - The room code to broadcast to.
 * @param {import("socket.io").Server} io - The Socket.IO server instance.
 */
function emitRoomUpdate(roomCode, io) {
    const room = rooms[roomCode];
    if (!room) return;

    touchRoom(room, "emit-room-update");

    io.to(roomCode).emit("update-players", {
        players: room.players,
        hostId: room.host,
        visibility: room.visibility || "private",
    });
}

/**
 * Loads game mode definitions from `public/gamemodes.json`.
 * @param {string} projectRoot - Absolute path to the project root directory.
 * @returns {Object[]} Array of game mode objects, or empty array on failure.
 */
function loadGameModes(projectRoot) {
    const gameModesPath = path.join(projectRoot, "public", "gamemodes.json");
    try {
        const raw = JSON.parse(fs.readFileSync(gameModesPath, "utf8"));
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

module.exports = {
    rooms,
    cleanupArchive,
    appendCleanupArchive,
    clearRoomTimers,
    clearAllBugFixerTimers,
    clearProphuntTimers,
    touchRoom,
    touchRoomByCode,
    isRoomGameActive,
    pruneRoomTransientData,
    removeSocketFromRooms,
    runRoomJanitor,
    generateRoomCode,
    createRoom,
    getPreferredGameModes,
    findAvailablePublicRoomsByGames,
    emitRoomUpdate,
    loadGameModes,
};
