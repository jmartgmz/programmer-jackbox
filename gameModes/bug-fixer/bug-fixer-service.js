/**
 * @file bug-fixer-service.js
 * @description Server-side game logic for Bug Fixer — the Cards Against Humanity-style
 * game where non-decider players submit solution cards in response to a bug prompt,
 * and the round decider picks the winning submission.
 *
 * This module is a factory: call `createBugFixerService(io, rooms)` to get a bound
 * service object whose methods operate on the shared rooms registry.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { shuffle, sampleUnique, randomItem, sanitizeNonNegativeInt } = require("../../src/utils");
const { BUG_FIXER_MIN_PLAYERS, BUG_FIXER_HAND_SIZE, BUG_FIXER_FINALIZE_DELAY_MS } = require("../../src/constants");

/**
 * Loads bug prompt and solution card data from the game mode's JSON files.
 * @returns {{ prompts: Object[], solutions: Object[] }}
 */
function loadBugFixerData() {
    const gameDir = path.join(__dirname);
    const promptsPath = path.join(gameDir, "bug-prompts.json");
    const solutionsPath = path.join(gameDir, "solution-cards.json");

    let prompts = [];
    let solutions = [];

    try {
        prompts = JSON.parse(fs.readFileSync(promptsPath, "utf8"));
    } catch {
        prompts = [];
    }

    try {
        solutions = JSON.parse(fs.readFileSync(solutionsPath, "utf8"));
    } catch {
        solutions = [];
    }

    return {
        prompts: Array.isArray(prompts) ? prompts : [],
        solutions: Array.isArray(solutions) ? solutions : [],
    };
}

/**
 * Counts the number of fill-in-the-blank slots (`_____`) in a prompt string.
 * @param {string} prompt - The prompt text to scan.
 * @returns {number} The number of five-underscore blank sequences found.
 */
function countPromptBlanks(prompt) {
    const matches = String(prompt || "").match(/_{5}/g);
    return matches ? matches.length : 0;
}

/**
 * Clears a specific named timer handle on a Bug Fixer state object.
 * @param {Object} state - The bug fixer state containing a `timerHandles` map.
 * @param {string} key - The timer key to clear (e.g. "submissionTimeout").
 */
function clearBugFixerTimer(state, key) {
    if (!state || !state.timerHandles || !state.timerHandles[key]) return;
    clearTimeout(state.timerHandles[key]);
    state.timerHandles[key] = null;
}

/**
 * Clears all three Bug Fixer timer handles (submission, decider, finalize).
 * @param {Object} state - The bug fixer state object.
 */
function clearAllBugFixerTimers(state) {
    clearBugFixerTimer(state, "submissionTimeout");
    clearBugFixerTimer(state, "deciderTimeout");
    clearBugFixerTimer(state, "finalizeTimeout");
}

/**
 * Factory function that creates and returns a bound Bug Fixer service.
 * @param {import("socket.io").Server} io - The Socket.IO server instance.
 * @param {Object} rooms - Shared rooms registry from room-manager.
 * @returns {Object} Bug Fixer service with all game lifecycle methods.
 */
function createBugFixerService(io, rooms) {
    const bugFixerData = loadBugFixerData();

    /** @returns {string[]} All valid solution card response strings. */
    function getSolutionResponses() {
        return bugFixerData.solutions.map((entry) => entry.response).filter(Boolean);
    }

    /**
     * Draws solution cards to fill a hand up to `targetSize`, avoiding duplicates already in hand.
     * @param {string[]} currentHand - The player's existing hand.
     * @param {number} targetSize - Desired hand size.
     * @returns {string[]} The updated hand.
     */
    function drawCardsForHand(currentHand, targetSize) {
        const responses = getSolutionResponses();
        const hand = Array.isArray(currentHand) ? [...currentHand] : [];

        while (hand.length < targetSize) {
            const available = responses.filter((card) => !hand.includes(card));
            if (available.length === 0) break;
            hand.push(available[Math.floor(Math.random() * available.length)]);
        }

        return hand;
    }

    /**
     * Looks up a player's display name within a room by socket ID.
     * @param {Object} room - The room object.
     * @param {string} playerId - The socket ID to look up.
     * @returns {string} The player's name, or "Unknown" if not found.
     */
    function getPlayerName(room, playerId) {
        const player = room.players.find((entry) => entry.id === playerId);
        return player ? player.name : "Unknown";
    }

    /**
     * Builds the scoreboard array for a bug fixer state, sorted by player order.
     * @param {Object} room - The room object.
     * @param {Object} state - The bug fixer state with a `scores` map.
     * @returns {Array<{id: string, name: string, score: number}>}
     */
    function buildBugFixerScores(room, state) {
        return room.players.map((player) => ({
            id: player.id,
            name: player.name,
            score: state && state.scores[player.id] ? state.scores[player.id] : 0,
        }));
    }

    /**
     * Reconciles the bug fixer player state: removes stale player entries and
     * initializes scores/hands for any new players.
     * @param {Object} room - The room object.
     */
    function ensureBugFixerPlayerState(room) {
        if (!room.bugFixer) return;

        if (!room.bugFixer.scores) room.bugFixer.scores = {};
        if (!room.bugFixer.hands) room.bugFixer.hands = {};

        const validIds = room.players.map((player) => player.id);

        Object.keys(room.bugFixer.scores)
            .filter((id) => !validIds.includes(id))
            .forEach((id) => delete room.bugFixer.scores[id]);

        Object.keys(room.bugFixer.hands)
            .filter((id) => !validIds.includes(id))
            .forEach((id) => delete room.bugFixer.hands[id]);

        room.players.forEach((player) => {
            if (typeof room.bugFixer.scores[player.id] !== "number") {
                room.bugFixer.scores[player.id] = 0;
            }
            room.bugFixer.hands[player.id] = drawCardsForHand(room.bugFixer.hands[player.id], BUG_FIXER_HAND_SIZE);
        });
    }

    /**
     * Selects a random prompt card from the loaded data.
     * @returns {Object|null} A prompt card object, or null if none are available.
     */
    function nextPrompt() {
        const prompts = bugFixerData.prompts;
        if (prompts.length === 0) return null;
        return randomItem(prompts);
    }

    /**
     * Ensures the decider rotation order is valid for the current player list.
     * Resets to a new shuffled order if the order is stale or missing players.
     * @param {Object} room - The room object.
     */
    function ensureDeciderOrder(room) {
        const state = room.bugFixer;
        const playerIds = room.players.map((player) => player.id);

        const isOrderInvalid =
            !Array.isArray(state.deciderOrder) ||
            state.deciderOrder.length !== playerIds.length ||
            state.deciderOrder.some((id) => !playerIds.includes(id));

        if (isOrderInvalid) {
            state.deciderOrder = shuffle(playerIds);
            state.deciderIndex = 0;
        }
    }

    /**
     * Picks a random subset of cards from a hand for auto-submission.
     * @param {string[]} hand - The player's hand.
     * @param {number} count - Number of cards to pick.
     * @returns {string[]} The selected cards.
     */
    function pickRandomCardsFromHand(hand, count) {
        const safeHand = Array.isArray(hand) ? [...hand] : [];
        const wanted = Math.max(1, count);
        if (safeHand.length <= wanted) return safeHand;
        return sampleUnique(safeHand, wanted);
    }

    /**
     * Builds a shuffled array of anonymized submission options for the decider.
     * @param {Object} round - The current round object.
     * @returns {Array<{submissionId: number, playerId: string, text: string}>}
     */
    function buildSubmissionOptions(round) {
        const shuffled = shuffle(Object.values(round.submissions));
        return shuffled.map((submission, index) => ({
            submissionId: index + 1,
            playerId: submission.playerId,
            text: submission.text,
        }));
    }

    /**
     * Returns the player IDs of all non-decider players in the current round.
     * @param {Object} room - The room object.
     * @param {Object} round - The current round object.
     * @returns {string[]}
     */
    function getNonDeciderPlayerIds(room, round) {
        return room.players.map((player) => player.id).filter((id) => id !== round.deciderId);
    }

    /**
     * Selects the non-decider player with the lowest current score (random tiebreak).
     * Used for the decider-timeout "lowest-score" action.
     * @param {Object} room - The room object.
     * @param {Object} round - The current round object.
     * @returns {string|null} The chosen player's socket ID, or null.
     */
    function chooseLowestScorePlayerId(room, round) {
        const eligible = getNonDeciderPlayerIds(room, round);
        if (eligible.length === 0) return null;

        const lowestScore = Math.min(...eligible.map((id) => room.bugFixer.scores[id] || 0));
        const tied = eligible.filter((id) => (room.bugFixer.scores[id] || 0) === lowestScore);
        return randomItem(tied);
    }

    /**
     * Replenishes each submitting player's hand back to BUG_FIXER_HAND_SIZE after a round ends.
     * @param {Object} room - The room object.
     * @param {Object} round - The completed round object.
     */
    function replenishHandsAfterRound(room, round) {
        Object.values(round.submissions).forEach((submission) => {
            const remaining = [...(room.bugFixer.hands[submission.playerId] || [])];
            submission.cards.forEach((card) => {
                const removeAt = remaining.indexOf(card);
                if (removeAt !== -1) remaining.splice(removeAt, 1);
            });
            room.bugFixer.hands[submission.playerId] = drawCardsForHand(remaining, BUG_FIXER_HAND_SIZE);
        });
    }

    /**
     * Builds the per-player Bug Fixer state payload to emit to a specific player.
     * Hides other players' submission identities and only shows the decider
     * the anonymized submission options.
     * @param {Object} room - The room object.
     * @param {string} playerId - The socket ID of the player receiving this payload.
     * @returns {Object} The state payload for this player.
     */
    function buildBugFixerPayloadForPlayer(room, playerId) {
        const state = room.bugFixer;
        const canStart =
            room.selectedGame === "bugFixerGame" &&
            room.host === playerId &&
            room.players.length >= BUG_FIXER_MIN_PLAYERS;

        if (!state || !state.active || !state.currentRound) {
            return {
                active: false,
                canStart,
                message:
                    room.players.length < BUG_FIXER_MIN_PLAYERS
                        ? `Need at least ${BUG_FIXER_MIN_PLAYERS} players to start Bug Fixer.`
                        : "Bug Fixer is ready.",
                pointsToWin: state && state.pointsToWin ? state.pointsToWin : null,
                timerSettings: state && state.settings ? state.settings : null,
                scores: buildBugFixerScores(room, state || { scores: {} }),
                lastResult: state ? state.lastResult : null,
            };
        }

        const round = state.currentRound;
        const isDecider = round.deciderId === playerId;
        const submissionsNeeded = room.players.length - 1;
        const submittedCount = Object.keys(round.submissions).length;

        let message = "";
        if (round.phase === "submitting") {
            message = `Waiting for submissions (${submittedCount}/${submissionsNeeded}).`;
        } else if (round.phase === "judging") {
            message = isDecider ? "Choose a winner." : "Decider is choosing a winner.";
        } else if (round.phase === "confirming") {
            message = isDecider
                ? "Winner selected. You can still change it before finalization."
                : "Decider locked a choice. Finalizing shortly.";
        }

        return {
            active: true,
            canStart,
            message,
            roundNumber: state.roundNumber,
            phase: round.phase,
            prompt: round.prompt,
            responsesRequired: round.responsesRequired,
            pointsToWin: state.pointsToWin,
            timerSettings: state.settings,
            deciderId: round.deciderId,
            deciderName: getPlayerName(room, round.deciderId),
            isDecider,
            yourHand: isDecider ? [] : state.hands[playerId] || [],
            yourSubmitted: Boolean(round.submissions[playerId]),
            submissionsNeeded,
            submittedCount,
            submissionOptions:
                isDecider && (round.phase === "judging" || round.phase === "confirming")
                    ? round.submissionOptions.map((option) => ({
                          submissionId: option.submissionId,
                          text: option.text,
                      }))
                    : [],
            submissionDeadlineTs: round.submissionDeadlineAt || null,
            deciderDeadlineTs: round.deciderDeadlineAt || null,
            finalizeDeadlineTs: round.finalizeDeadlineAt || null,
            pendingWinnerSubmissionId: isDecider ? round.pendingWinnerSubmissionId || null : null,
            serverNowTs: Date.now(),
            scores: buildBugFixerScores(room, state),
            lastResult: state.lastResult,
        };
    }

    /**
     * Emits the current Bug Fixer state to every player in the room, with per-player payloads.
     * @param {string} roomCode - The room code.
     */
    function emitBugFixerState(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "bugFixerGame") return;

        room.players.forEach((player) => {
            io.to(player.id).emit("bugfixer-state", buildBugFixerPayloadForPlayer(room, player.id));
        });
    }

    /**
     * Auto-submits random cards on behalf of any players who have not submitted
     * before the submission timer expires, then advances to the judging phase.
     * @param {string} roomCode - The room code.
     */
    function autoSubmitMissingPlayers(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.bugFixer || !room.bugFixer.currentRound || !room.bugFixer.active) return;

        const round = room.bugFixer.currentRound;
        if (round.phase !== "submitting") return;

        getNonDeciderPlayerIds(room, round).forEach((playerId) => {
            if (round.submissions[playerId]) return;

            const hand = room.bugFixer.hands[playerId] || [];
            const pickedCards = pickRandomCardsFromHand(hand, round.responsesRequired);
            round.submissions[playerId] = {
                playerId,
                cards: pickedCards,
                text: pickedCards.join(" | "),
            };
        });

        enterJudgingPhase(roomCode);
    }

    /**
     * Transitions the current round from the submission phase to the judging phase.
     * Sets up the decider timer if configured.
     * @param {string} roomCode - The room code.
     */
    function enterJudgingPhase(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.bugFixer || !room.bugFixer.currentRound) return;

        const state = room.bugFixer;
        const round = state.currentRound;

        round.phase = "judging";
        round.submissionOptions = buildSubmissionOptions(round);
        round.deciderDeadlineAt = null;
        round.finalizeDeadlineAt = null;
        round.pendingWinnerPlayerId = null;
        round.pendingWinnerSubmissionId = null;

        clearBugFixerTimer(state, "submissionTimeout");
        clearBugFixerTimer(state, "finalizeTimeout");
        clearBugFixerTimer(state, "deciderTimeout");

        const deciderSeconds = sanitizeNonNegativeInt(state.settings && state.settings.deciderSeconds, 0);

        if (deciderSeconds > 0) {
            round.deciderDeadlineAt = Date.now() + deciderSeconds * 1000;
            state.timerHandles.deciderTimeout = setTimeout(() => {
                const liveRoom = rooms[roomCode];
                if (!liveRoom || !liveRoom.bugFixer || !liveRoom.bugFixer.active || !liveRoom.bugFixer.currentRound)
                    return;

                const liveRound = liveRoom.bugFixer.currentRound;
                if (liveRound.phase !== "judging" && liveRound.phase !== "confirming") return;

                let timedOutWinnerId = null;
                if (liveRoom.bugFixer.settings && liveRoom.bugFixer.settings.deciderTimeoutAction === "lowest-score") {
                    timedOutWinnerId = chooseLowestScorePlayerId(liveRoom, liveRound);
                }

                finalizeBugFixerRound(roomCode, {
                    winnerPlayerId: timedOutWinnerId,
                    reason: timedOutWinnerId ? "decider-timeout-lowest" : "decider-timeout-none",
                });
            }, deciderSeconds * 1000);
        }

        emitBugFixerState(roomCode);
    }

    /**
     * Finalizes the current Bug Fixer round: awards points, replenishes hands,
     * records the result, and either ends the game or starts the next round.
     * @param {string} roomCode - The room code.
     * @param {Object} [options={}]
     * @param {string|null} [options.winnerPlayerId=null] - Socket ID of the winning player, or null.
     * @param {string} [options.reason="decider-picked"] - Reason label for the finalization.
     */
    function finalizeBugFixerRound(roomCode, { winnerPlayerId = null, reason = "decider-picked" } = {}) {
        const room = rooms[roomCode];
        if (
            !room ||
            room.selectedGame !== "bugFixerGame" ||
            !room.bugFixer ||
            !room.bugFixer.active ||
            !room.bugFixer.currentRound
        )
            return;

        const state = room.bugFixer;
        const round = state.currentRound;

        clearAllBugFixerTimers(state);

        if (winnerPlayerId) {
            if (!state.scores[winnerPlayerId]) state.scores[winnerPlayerId] = 0;
            state.scores[winnerPlayerId] += 1;
        }

        replenishHandsAfterRound(room, round);

        const revealedSubmissions = (round.submissionOptions || []).map((option) => ({
            playerName: getPlayerName(room, option.playerId),
            text: option.text,
        }));

        if (!winnerPlayerId) {
            state.lastResult = {
                message:
                    reason === "decider-timeout-none"
                        ? `${getPlayerName(room, round.deciderId)} timed out. No point awarded this round.`
                        : "No point awarded this round.",
                revealedSubmissions,
            };
        } else if (reason === "decider-timeout-lowest") {
            state.lastResult = {
                message: `${getPlayerName(room, round.deciderId)} timed out. Point awarded to lowest-score player ${getPlayerName(room, winnerPlayerId)}.`,
                revealedSubmissions,
            };
        } else {
            state.lastResult = {
                message: `${getPlayerName(room, round.deciderId)} picked ${getPlayerName(room, winnerPlayerId)}.`,
                revealedSubmissions,
            };
        }

        if (winnerPlayerId && state.scores[winnerPlayerId] >= state.pointsToWin) {
            state.active = false;
            state.currentRound = null;
            state.lastResult = {
                message: `${getPlayerName(room, winnerPlayerId)} wins Bug Fixer (${state.scores[winnerPlayerId]} points)!`,
                revealedSubmissions,
            };
            emitBugFixerState(roomCode);
            return;
        }

        startNextBugFixerRound(roomCode);
    }

    /**
     * Starts the next Bug Fixer round by selecting a decider, drawing a prompt,
     * and initializing the round state. Aborts if there are too few players.
     * @param {string} roomCode - The room code.
     */
    function startNextBugFixerRound(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.selectedGame !== "bugFixerGame" || !room.bugFixer || !room.bugFixer.active) return;

        if (room.players.length < BUG_FIXER_MIN_PLAYERS) {
            room.bugFixer.active = false;
            room.bugFixer.currentRound = null;
            room.bugFixer.lastResult = {
                message: `Need at least ${BUG_FIXER_MIN_PLAYERS} players to continue.`,
            };
            emitBugFixerState(roomCode);
            return;
        }

        ensureBugFixerPlayerState(room);
        ensureDeciderOrder(room);

        const state = room.bugFixer;
        clearAllBugFixerTimers(state);

        if (state.deciderIndex >= state.deciderOrder.length) {
            state.deciderIndex = 0;
        }

        const deciderId = state.deciderOrder[state.deciderIndex];
        state.deciderIndex += 1;

        const promptCard = nextPrompt();
        if (!promptCard) {
            state.active = false;
            state.currentRound = null;
            state.lastResult = { message: "No prompt cards are available." };
            emitBugFixerState(roomCode);
            return;
        }

        const promptText = String(promptCard.prompt || "");
        const explicitResponses = Number(promptCard.responses) || 1;
        const blankCount = countPromptBlanks(promptText);
        const responsesRequired = Math.max(1, blankCount || explicitResponses);

        state.roundNumber += 1;
        state.currentRound = {
            phase: "submitting",
            deciderId,
            prompt: promptText,
            responsesRequired,
            submissions: {},
            submissionOptions: [],
            pendingWinnerPlayerId: null,
            pendingWinnerSubmissionId: null,
            submissionDeadlineAt: null,
            deciderDeadlineAt: null,
            finalizeDeadlineAt: null,
        };

        const submitSeconds = sanitizeNonNegativeInt(state.settings && state.settings.submissionSeconds, 0);
        if (submitSeconds > 0) {
            state.currentRound.submissionDeadlineAt = Date.now() + submitSeconds * 1000;
            state.timerHandles.submissionTimeout = setTimeout(() => {
                autoSubmitMissingPlayers(roomCode);
            }, submitSeconds * 1000);
        }

        emitBugFixerState(roomCode);
    }

    /**
     * Validates settings and initializes a new Bug Fixer game for a room,
     * resetting all state and starting the first round.
     * @param {string} roomCode - The room code.
     * @param {Object} payload - Settings from the host (pointsToWin, timers, etc.).
     * @returns {string|null} An error message string, or null on success.
     */
    function initializeBugFixer(roomCode, payload) {
        const room = rooms[roomCode];
        if (!room) return "Room not found.";

        if (room.players.length < BUG_FIXER_MIN_PLAYERS) {
            return `Need at least ${BUG_FIXER_MIN_PLAYERS} players to start Bug Fixer.`;
        }

        const promptCount = bugFixerData.prompts.length;
        const solutionCount = bugFixerData.solutions.filter((entry) => entry.response).length;
        if (promptCount === 0 || solutionCount < BUG_FIXER_HAND_SIZE) {
            return "Bug Fixer data is incomplete. Check prompt and solution card JSON files.";
        }

        const targetPoints = Number(payload && payload.pointsToWin);
        if (!Number.isInteger(targetPoints) || targetPoints < 1) {
            return "Points to win must be a whole number of at least 1.";
        }

        const submissionSeconds = sanitizeNonNegativeInt(payload && payload.submissionSeconds, 0);
        const deciderSeconds = sanitizeNonNegativeInt(payload && payload.deciderSeconds, 0);
        const timeoutAction = payload && payload.deciderTimeoutAction === "lowest-score" ? "lowest-score" : "no-point";

        const scores = {};
        const hands = {};
        room.players.forEach((player) => {
            scores[player.id] = 0;
            hands[player.id] = drawCardsForHand([], BUG_FIXER_HAND_SIZE);
        });

        if (room.bugFixer) {
            clearAllBugFixerTimers(room.bugFixer);
        }

        room.bugFixer = {
            active: true,
            pointsToWin: targetPoints,
            settings: { submissionSeconds, deciderSeconds, deciderTimeoutAction: timeoutAction },
            scores,
            hands,
            deciderOrder: [],
            deciderIndex: 0,
            roundNumber: 0,
            currentRound: null,
            lastResult: null,
            timerHandles: {
                submissionTimeout: null,
                deciderTimeout: null,
                finalizeTimeout: null,
            },
        };

        startNextBugFixerRound(roomCode);
        return null;
    }

    return {
        clearAllBugFixerTimers,
        ensureBugFixerPlayerState,
        emitBugFixerState,
        startNextBugFixerRound,
        finalizeBugFixerRound,
        enterJudgingPhase,
        autoSubmitMissingPlayers,
        initializeBugFixer,
        clearBugFixerTimer,
        getNonDeciderPlayerIds,
        buildBugFixerPayloadForPlayer,
    };
}

module.exports = { createBugFixerService };
