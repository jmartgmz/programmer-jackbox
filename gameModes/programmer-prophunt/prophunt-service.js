/**
 * @file prophunt-service.js
 * @description Server-side game logic for Programmer Prophunt — a team-based hide-and-seek
 * game where one team secretly inserts code lines into a real snippet, and the other team
 * must identify which lines were written by the hiders.
 *
 * This module is a factory: call `createProphuntService(io, rooms)` to get a bound
 * service object whose methods operate on the shared rooms registry.
 */

"use strict";

const { shuffle, randomItem, sanitizeNonNegativeInt } = require("../../src/utils");
const { PROPHUNT_MIN_PLAYERS } = require("../../src/constants");

/**
 * Curated code snippets used as the base for each Prophunt round, categorized by complexity.
 * @type {{ easy: string[][], medium: string[][], hard: string[][] }}
 */
const fs = require("fs");
const path = require("path");

function loadProphuntSnippets() {
    try {
        const filePath = path.join(__dirname, "snippets.json");
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (e) {
        console.error("Failed to load prophunt snippets.json", e);
        return { easy: [], medium: [], hard: [] };
    }
}

const PROPHUNT_SNIPPETS = loadProphuntSnippets();

/**
 * Factory function that creates and returns a bound Prophunt service.
 * @param {import("socket.io").Server} io - The Socket.IO server instance.
 * @param {Object} rooms - Shared rooms registry from room-manager.
 * @returns {Object} Prophunt service with all game lifecycle methods.
 */
function createProphuntService(io, rooms) {
    /**
     * Returns the display name for a team ID ("A" or "B").
     * @param {string} teamId - "A" or "B".
     * @returns {string} "Team A" or "Team B".
     */
    function getProphuntTeamName(teamId) {
        return teamId === "A" ? "Team A" : "Team B";
    }

    /**
     * Returns the team ID ("A" or "B") that a player belongs to, or null if not found.
     * @param {Object} state - The prophunt state object.
     * @param {string} playerId - The socket ID to look up.
     * @returns {"A"|"B"|null}
     */
    function getPlayerTeam(state, playerId) {
        if (!state || !state.teams) return null;
        if (state.teams.A.includes(playerId)) return "A";
        if (state.teams.B.includes(playerId)) return "B";
        return null;
    }

    /**
     * Looks up a player's display name in a room by socket ID.
     * @param {Object} room - The room object.
     * @param {string} playerId - The socket ID.
     * @returns {string} The player name, or "Unknown".
     */
    function getPlayerName(room, playerId) {
        const player = room.players.find((entry) => entry.id === playerId);
        return player ? player.name : "Unknown";
    }

    /**
     * Creates the base code lines for a round from a randomly selected snippet
     * at the given complexity level.
     * @param {string} complexity - "easy", "medium", or "hard".
     * @returns {Array<{ref: string, text: string}>} Array of line objects with stable ref IDs.
     */
    function createProphuntBaseLines(complexity) {
        const key = ["easy", "medium", "hard"].includes(complexity) ? complexity : "easy";
        const snippet = randomItem(PROPHUNT_SNIPPETS[key]) || PROPHUNT_SNIPPETS.easy[0];
        return snippet.map((text, index) => ({ ref: `B:${index + 1}`, text }));
    }

    /**
     * Composes the final visible code listing by overlaying hider-modified lines
     * onto the base snippet. New hider lines are appended after the base lines.
     * @param {Object} room - The room object.
     * @param {Object} state - The prophunt state object.
     * @returns {Array<{ref: string, text: string, ownerPlayerId: string|null, isNew: boolean}>}
     */
    function buildProphuntComposedLines(room, state) {
        // First map all hider overrides by their target reference ID.
        // This allows us to quickly apply O(1) lookups when merging overrides with the base code.
        const assignmentsByRef = {};
        Object.entries(state.hiderAssignments || {}).forEach(([playerId, assignment]) => {
            if (!assignment) return;
            assignmentsByRef[assignment.lineRef] = { ...assignment, playerId };
        });

        // Reconstruct the base snippet, substituting out any lines that hiders decided to edit.
        const baseLines = (state.baseLines || []).map((base) => {
            const override = assignmentsByRef[base.ref];
            return {
                ref: base.ref,
                text: override ? override.text : base.text,
                ownerPlayerId: override ? override.playerId : null,
                isNew: false,
            };
        });

        // Any hider assignments mapped to "new" (i.e. their lineRef isn't an existing base line)
        // are appended sequentially at the end. We sort them consistently by player name
        // to ensure the line order remains deterministic for all connected clients.
        const newLines = Object.entries(assignmentsByRef)
            .filter(([, assignment]) => assignment.isNew)
            .sort((a, b) => getPlayerName(room, a[1].playerId).localeCompare(getPlayerName(room, b[1].playerId)))
            .map(([, assignment]) => ({
                ref: assignment.lineRef,
                text: assignment.text,
                ownerPlayerId: assignment.playerId,
                isNew: true,
            }));

        return [...baseLines, ...newLines];
    }

    /**
     * Builds the list of line options a hider can assign themselves to during the hiding phase.
     * Lines already taken by other hiders are excluded, and a "Create new line" option is always included.
     * @param {Object} room - The room object.
     * @param {Object} state - The prophunt state object.
     * @param {string} playerId - The hider's socket ID.
     * @returns {Array<{ref: string, label: string}>}
     */
    function buildProphuntLineOptions(room, state, playerId) {
        const currentRef = state.hiderAssignments[playerId] ? state.hiderAssignments[playerId].lineRef : null;
        const options = [];

        (state.baseLines || []).forEach((line, index) => {
            const takenByOther = Object.entries(state.hiderAssignments || {}).some(
                ([otherPlayerId, assignment]) =>
                    otherPlayerId !== playerId && assignment && assignment.lineRef === line.ref
            );
            if (!takenByOther || currentRef === line.ref) {
                options.push({ ref: line.ref, label: `Line ${index + 1}` });
            }
        });

        options.push({ ref: "NEW_LINE", label: "Create new line" });
        return options;
    }

    /**
     * Builds the per-player Prophunt state payload for a specific player.
     * Hiders only see the code during the hiding phase; finders see it in the finding phase.
     * @param {Object} room - The room object.
     * @param {string} playerId - The socket ID of the recipient.
     * @returns {Object} State payload tailored for this player's role.
     */
    function buildProphuntPayloadForPlayer(room, playerId) {
        const state = room.prophunt;
        const canStart =
            room.selectedGame === "programmerProphunt" &&
            room.host === playerId &&
            room.players.length >= PROPHUNT_MIN_PLAYERS &&
            room.players.length % 2 === 0;

        if (!state || !state.active) {
            return {
                active: false,
                canStart,
                message:
                    room.players.length < PROPHUNT_MIN_PLAYERS
                        ? `Need at least ${PROPHUNT_MIN_PLAYERS} players to start Programmer Prophunt.`
                        : room.players.length % 2 !== 0
                          ? "Programmer Prophunt needs an even number of players."
                          : "Programmer Prophunt is ready.",
                teamA: [],
                teamB: [],
                scores: state && state.scores ? state.scores : { A: 0, B: 0 },
                lastResultMessage: state && state.lastResultMessage ? state.lastResultMessage : "",
            };
        }

        const playerTeam = getPlayerTeam(state, playerId);
        const role =
            state.phase === "hiding"
                ? playerTeam === state.hidingTeam
                    ? "hider"
                    : "finder"
                : state.phase === "finding"
                  ? playerTeam === state.finderTeam
                      ? "finder"
                      : "hider"
                  : "observer";

        const composedLines = buildProphuntComposedLines(room, state);
        const shouldShowCode = state.phase !== "hiding" || role === "hider";
        const visibleLines = shouldShowCode
            ? composedLines.map((line, index) => ({
                  number: index + 1,
                  ref: line.ref,
                  text: line.text,
              }))
            : [];

        const finderLineOptions =
            state.phase === "finding" && role === "finder"
                ? composedLines.map((line, index) => ({
                      ref: line.ref,
                      label: `Line ${index + 1}`,
                  }))
                : [];

        const yourAssignment = state.hiderAssignments[playerId] || null;

        return {
            active: true,
            canStart,
            message: state.message || "",
            phase: state.phase,
            roundNumber: state.roundNumber,
            totalRounds: state.totalRounds,
            role,
            hidingTeamName: getProphuntTeamName(state.hidingTeam),
            finderTeamName: getProphuntTeamName(state.finderTeam),
            teamA: state.teams.A.map((id) => getPlayerName(room, id)),
            teamB: state.teams.B.map((id) => getPlayerName(room, id)),
            visibleLines,
            editableLineOptions:
                state.phase === "hiding" && role === "hider" ? buildProphuntLineOptions(room, state, playerId) : [],
            finderLineOptions,
            yourDraftLine: yourAssignment ? yourAssignment.text : "",
            scores: state.scores,
            lastResultMessage: state.lastResultMessage || "",
            deadlineTs: state.deadlineTs || null,
            serverNowTs: Date.now(),
        };
    }

    /**
     * Emits the current Prophunt state to every player in the room, with per-player payloads.
     * @param {string} roomCode - The room code.
     */
    function emitProphuntState(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "programmerProphunt") return;

        room.players.forEach((player) => {
            io.to(player.id).emit("prophunt-state", buildProphuntPayloadForPlayer(room, player.id));
        });
    }

    /**
     * Clears the Prophunt phase timeout handle from the state.
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
     * Transitions the round into the hiding phase: selects a base snippet,
     * initializes hider assignment tracking, and starts the phase timer.
     * @param {string} roomCode - The room code.
     */
    function startProphuntHidingPhase(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "programmerProphunt" || !room.prophunt || !room.prophunt.active) return;

        const state = room.prophunt;
        clearProphuntTimers(state);

        state.phase = "hiding";
        state.message = `Round ${state.roundNumber}: ${getProphuntTeamName(state.hidingTeam)} is hiding.`;
        state.baseLines = createProphuntBaseLines(state.settings.complexity);
        state.hiderAssignments = {};
        state.finderGuesses = {};
        state.deadlineTs = Date.now() + state.settings.roundSeconds * 1000;

        state.timerHandles.phaseTimeout = setTimeout(() => {
            finishProphuntHidingPhase(roomCode, true);
        }, state.settings.roundSeconds * 1000);

        emitProphuntState(roomCode);
    }

    /**
     * Ends the hiding phase: penalizes hiders who didn't confirm their assignment,
     * then transitions to the finding phase with a new timer.
     * @param {string} roomCode - The room code.
     * @param {boolean} [fromTimeout=false] - True if triggered by the phase timer expiring.
     */
    function finishProphuntHidingPhase(roomCode, fromTimeout = false) {
        const room = rooms[roomCode];
        if (!room || !room.prophunt || !room.prophunt.active || room.prophunt.phase !== "hiding") return;

        const state = room.prophunt;
        clearProphuntTimers(state);

        const hiders = state.teams[state.hidingTeam];
        let penalties = 0;
        hiders.forEach((playerId) => {
            const assignment = state.hiderAssignments[playerId];
            if (!assignment || !assignment.confirmed) {
                penalties += 1;
                delete state.hiderAssignments[playerId];
            }
        });

        if (fromTimeout && penalties > 0) {
            state.scores[state.hidingTeam] -= penalties;
        }

        state.phase = "finding";
        state.message = `${getProphuntTeamName(state.finderTeam)} is finding suspicious lines.`;
        state.deadlineTs = Date.now() + state.settings.roundSeconds * 1000;

        state.timerHandles.phaseTimeout = setTimeout(() => {
            finalizeProphuntRound(roomCode, true);
        }, state.settings.roundSeconds * 1000);

        emitProphuntState(roomCode);
    }

    /**
     * Finalizes a Prophunt round: scores correct guesses and hidden lines,
     * penalizes finders who timed out, and either ends the game or starts
     * the next round with swapped teams.
     * @param {string} roomCode - The room code.
     * @param {boolean} [fromTimeout=false] - True if triggered by the phase timer expiring.
     */
    function finalizeProphuntRound(roomCode, fromTimeout = false) {
        const room = rooms[roomCode];
        if (!room || !room.prophunt || !room.prophunt.active || room.prophunt.phase !== "finding") return;

        const state = room.prophunt;
        clearProphuntTimers(state);

        const finders = state.teams[state.finderTeam];
        let finderPenalty = 0;
        finders.forEach((playerId) => {
            const guess = state.finderGuesses[playerId];
            if (!guess || !guess.confirmed) finderPenalty += 1;
        });
        if (fromTimeout && finderPenalty > 0) {
            state.scores[state.finderTeam] -= finderPenalty;
        }

        const hiderByLine = {};
        Object.entries(state.hiderAssignments || {}).forEach(([playerId, assignment]) => {
            if (assignment) hiderByLine[assignment.lineRef] = playerId;
        });

        let finderPoints = 0;
        const calledOutHiders = new Set();
        Object.values(state.finderGuesses || {}).forEach((guess) => {
            if (!guess || !guess.confirmed) return;
            const calledHider = hiderByLine[guess.lineRef];
            if (calledHider) {
                finderPoints += 1;
                calledOutHiders.add(calledHider);
            }
        });

        const hiderIds = Object.keys(state.hiderAssignments || {});
        const hiddenCount = hiderIds.filter((id) => !calledOutHiders.has(id)).length;

        state.scores[state.finderTeam] += finderPoints;
        state.scores[state.hidingTeam] += hiddenCount;

        state.lastResultMessage =
            `${getProphuntTeamName(state.finderTeam)} earned ${finderPoints} point(s); ` +
            `${getProphuntTeamName(state.hidingTeam)} earned ${hiddenCount} point(s).` +
            (finderPenalty > 0
                ? ` ${getProphuntTeamName(state.finderTeam)} also lost ${finderPenalty} point(s) from timeouts.`
                : "");

        if (state.roundNumber >= state.totalRounds) {
            state.active = false;
            state.phase = "finished";
            state.message = `Programmer Prophunt finished. Team A: ${state.scores.A}, Team B: ${state.scores.B}.`;
            state.deadlineTs = null;
            emitProphuntState(roomCode);
            return;
        }

        state.roundNumber += 1;
        state.hidingTeam = state.hidingTeam === "A" ? "B" : "A";
        state.finderTeam = state.hidingTeam === "A" ? "B" : "A";
        startProphuntHidingPhase(roomCode);
    }

    /**
     * Validates settings and initializes a new Prophunt game for a room,
     * splitting players into two teams and starting the first hiding phase.
     * @param {string} roomCode - The room code.
     * @param {Object} payload - Settings from the host (complexity, roundSeconds, rounds).
     * @returns {string|null} An error message string, or null on success.
     */
    function initializeProphunt(roomCode, payload) {
        const room = rooms[roomCode];
        if (!room) return "Room not found.";

        if (room.players.length < PROPHUNT_MIN_PLAYERS) {
            return `Need at least ${PROPHUNT_MIN_PLAYERS} players to start Programmer Prophunt.`;
        }
        if (room.players.length % 2 !== 0) {
            return "Programmer Prophunt requires an even number of players.";
        }

        const complexity = ["easy", "medium", "hard"].includes(payload && payload.complexity)
            ? payload.complexity
            : "easy";
        const roundSeconds = sanitizeNonNegativeInt(payload && payload.roundSeconds, 45);
        const totalRounds = sanitizeNonNegativeInt(payload && payload.rounds, 3);

        if (roundSeconds < 5) return "Round timer must be at least 5 seconds.";
        if (totalRounds < 1) return "Rounds must be at least 1.";

        if (room.prophunt) {
            clearProphuntTimers(room.prophunt);
        }

        const shuffledPlayerIds = shuffle(room.players.map((player) => player.id));
        const half = shuffledPlayerIds.length / 2;

        room.prophunt = {
            active: true,
            settings: { complexity, roundSeconds },
            totalRounds,
            roundNumber: 1,
            teams: {
                A: shuffledPlayerIds.slice(0, half),
                B: shuffledPlayerIds.slice(half),
            },
            scores: { A: 0, B: 0 },
            hidingTeam: "A",
            finderTeam: "B",
            phase: "hiding",
            baseLines: [],
            hiderAssignments: {},
            finderGuesses: {},
            message: "",
            lastResultMessage: "",
            deadlineTs: null,
            timerHandles: { phaseTimeout: null },
        };

        startProphuntHidingPhase(roomCode);
        return null;
    }

    return {
        clearProphuntTimers,
        emitProphuntState,
        buildProphuntPayloadForPlayer,
        startProphuntHidingPhase,
        finishProphuntHidingPhase,
        finalizeProphuntRound,
        initializeProphunt,
        getPlayerTeam,
        buildProphuntComposedLines,
        buildProphuntLineOptions,
        getPlayerName,
    };
}

module.exports = { createProphuntService };
