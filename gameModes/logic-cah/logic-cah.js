/**
 * @file logic-cah.js
 * @description Core game logic for Logic Cards Against Humanity. Manages the full
 * game lifecycle: prompt drawing, round progression, answer collection,
 * decider selection, and scoring.
 */

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * LogicCAH — Logic Cards Against Humanity
 * A round-based party game where non-decider players answer prompts
 * and the rotating decider picks the response they like best.
 */

class LogicCAH {
    constructor(players, numRounds, timeLimit, numPrompts) {
        /** @type {Array<{id: string, name: string}>} Active player list. */
        this.players = players;
        this.numRounds = numRounds;
        /** Time limit in seconds per round. */
        this.timeLimit = timeLimit;
        this.numPrompts = numPrompts;

        /** @type {Object.<string, number>} Score map keyed by player ID. */
        this.scores = {};
        this.players.forEach((player) => {
            this.scores[player.id] = 0;
        });

        this.currentRound = 0;
        this.currentDeciderIndex = 0;
        /** @type {"WAITING_FOR_ANSWERS"|"SHOWING_ANSWERS"|"ROUND_COMPLETE"} */
        this.roundState = "WAITING_FOR_ANSWERS";
        /** @type {Object.<string, string[]>} Player answers keyed by player ID. */
        this.playerAnswers = {};
        this.selectedPlayerId = null;

        this.promptDeck = [];
        this.discardedPrompts = [];
        this.currentPrompts = [];

        this.loadPrompts();
        this.currentPrompts = this.drawPrompts(this.numPrompts);
    }

    /**
     * Loads and shuffles the prompt deck from cards.json.
     * @throws {Error} If cards.json is missing, unreadable, or malformed.
     */
    loadPrompts() {
        const cardsPath = path.join(__dirname, "cards.json");

        if (!fs.existsSync(cardsPath)) {
            throw new Error("cards.json file not found in logic-cah directory");
        }

        let data;
        try {
            data = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
        } catch {
            throw new Error("Error parsing cards.json file");
        }

        if (!Array.isArray(data.black_cards)) {
            throw new Error("Invalid cards.json format: 'black_cards' should be an array");
        }

        this.promptDeck = data.black_cards.map((prompt) => String(prompt).trim()).filter((prompt) => prompt.length > 0);

        if (this.promptDeck.length < this.numPrompts * this.numRounds) {
            throw new Error("Not enough prompts in the deck to support the number of rounds and prompts per round");
        }

        this.shuffleArray(this.promptDeck);
    }

    /**
     * Shuffles an array in-place using the Fisher-Yates algorithm.
     * @param {Array} array - The array to shuffle.
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    /**
     * Draws a single prompt from the deck. When the deck is exhausted,
     * recycles discarded prompts into a freshly shuffled deck.
     * @returns {string} A prompt string.
     */
    drawPrompt() {
        if (this.promptDeck.length === 0) {
            if (this.discardedPrompts.length === 0) {
                return "[No more prompts available]";
            }
            this.promptDeck = [...this.discardedPrompts];
            this.discardedPrompts = [];
            this.shuffleArray(this.promptDeck);
        }
        return this.promptDeck.pop();
    }

    /**
     * Draws `count` prompts from the deck.
     * @param {number} count - Number of prompts to draw.
     * @returns {string[]} Array of prompt strings.
     */
    drawPrompts(count) {
        const prompts = [];
        for (let i = 0; i < count; i++) {
            prompts.push(this.drawPrompt());
        }
        return prompts;
    }

    /**
     * Get the current decider
     */
    getCurrentDecider() {
        return this.players[this.currentDeciderIndex];
    }

    /**
     * Get all non-decider players
     */
    getNonDeciders() {
        return this.players.filter((_, idx) => idx !== this.currentDeciderIndex);
    }

    /**
     * Check if all non-deciders have submitted answers
     */
    allAnswersSubmitted() {
        const nonDeciders = this.getNonDeciders();
        return nonDeciders.every(
            (player) => this.playerAnswers[player.id] && this.playerAnswers[player.id].length === this.numPrompts
        );
    }

    /**
     * Records a player's submitted answers and advances the round state
     * if all non-deciders have submitted.
     * @param {string} playerId - The submitting player's socket ID.
     * @param {string[]} answers - One answer string per active prompt.
     * @returns {{ success: true, allSubmitted: boolean }}
     * @throws {Error} If the phase, player, or answer format is invalid.
     */
    submitAnswers(playerId, answers) {
        if (this.roundState !== "WAITING_FOR_ANSWERS") {
            throw new Error("Answers cannot be submitted at this time");
        }

        const player = this.players.find((player) => player.id === playerId);
        if (!player) throw new Error("Player not found");
        if (playerId === this.getCurrentDecider().id) throw new Error("The decider cannot submit answers");
        if (!Array.isArray(answers)) throw new Error("Answers must be an array");
        if (answers.length !== this.numPrompts) {
            throw new Error(`Expected ${this.numPrompts} answers, got ${answers.length}`);
        }

        const cleanedAnswers = answers.map((answer) => String(answer).trim());
        if (cleanedAnswers.some((answer) => answer.length === 0)) {
            throw new Error("Answers cannot be blank");
        }

        this.playerAnswers[playerId] = cleanedAnswers;

        if (this.allAnswersSubmitted()) {
            this.roundState = "SHOWING_ANSWERS";
        }

        return { success: true, allSubmitted: this.allAnswersSubmitted() };
    }

    /**
     * Returns an anonymized, shuffled array of non-decider submissions
     * for the decider to evaluate.
     * @returns {Array<{playerId: string, answers: string[]}>}
     * @throws {Error} If called outside the SHOWING_ANSWERS phase.
     */
    getAnonymousAnswers() {
        if (this.roundState !== "SHOWING_ANSWERS") {
            throw new Error("Answers are not ready to be shown");
        }

        const nonDeciders = this.getNonDeciders().map((player) => ({
            playerId: player.id,
            answers: this.playerAnswers[player.id],
        }));

        this.shuffleArray(nonDeciders);
        return nonDeciders;
    }

    /**
     * Records the decider's choice of winning answer set and awards a point.
     * @param {string} selectedPlayerId - Socket ID of the player whose answer won.
     * @returns {{ success: true, selectedPlayer: string, pointAwarded: true }}
     * @throws {Error} If called outside SHOWING_ANSWERS phase or with an invalid player.
     */
    deciderSelectsAnswers(selectedPlayerId) {
        if (this.roundState !== "SHOWING_ANSWERS") {
            throw new Error("Cannot select answers at this time");
        }

        const player = this.players.find((player) => player.id === selectedPlayerId);
        if (!player) throw new Error("Player not found");
        if (selectedPlayerId === this.getCurrentDecider().id) {
            throw new Error("Decider cannot select their own answers");
        }

        this.selectedPlayerId = selectedPlayerId;
        this.scores[selectedPlayerId]++;

        return { success: true, selectedPlayer: player.name, pointAwarded: true };
    }

    /**
     * Returns the selected player's name and their current score for reveal.
     * @returns {{ selectedPlayerName: string, points: number }}
     * @throws {Error} If no player has been selected yet.
     */
    revealSelectedPlayer() {
        if (!this.selectedPlayerId) {
            throw new Error("No player has been selected yet");
        }
        const selectedPlayer = this.players.find((player) => player.id === this.selectedPlayerId);
        return {
            selectedPlayerName: selectedPlayer.name,
            points: this.scores[this.selectedPlayerId],
        };
    }

    /**
     * Completes the current round: discards prompts, advances the decider index,
     * resets per-round state, and draws new prompts for the next round.
     * @returns {{ roundComplete: true, nextRound: number, nextDecider: Object, prompts: string[] }}
     */
    completeRound() {
        this.discardedPrompts.push(...this.currentPrompts);
        this.currentRound++;
        this.currentDeciderIndex = (this.currentDeciderIndex + 1) % this.players.length;
        this.playerAnswers = {};
        this.selectedPlayerId = null;
        this.roundState = "WAITING_FOR_ANSWERS";

        if (!this.isGameOver()) {
            this.currentPrompts = this.drawPrompts(this.numPrompts);
        }

        return {
            roundComplete: true,
            nextRound: this.currentRound,
            nextDecider: this.getCurrentDecider(),
            prompts: this.currentPrompts,
        };
    }

    /**
     * Returns true if all rounds have been completed.
     * @returns {boolean}
     */
    isGameOver() {
        return this.currentRound >= this.numRounds;
    }

    /**
     * Returns the final sorted standings. Must only be called after the game ends.
     * @returns {Array<{name: string, score: number}>}
     * @throws {Error} If the game is still in progress.
     */
    getFinalScores() {
        if (!this.isGameOver()) throw new Error("Game is not over yet");
        return this.players
            .map((player) => ({ name: player.name, score: this.scores[player.id] }))
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Removes a player by socket ID from all game state. Adjusts the decider index
     * if needed to keep the rotation valid.
     * @param {string} playerId - Socket ID of the player to remove.
     * @returns {boolean} True if the player was found and removed, false otherwise.
     */
    removePlayer(playerId) {
        const playerIndex = this.players.findIndex((player) => player.id === playerId);
        if (playerIndex === -1) return false;

        this.players.splice(playerIndex, 1);
        delete this.scores[playerId];
        delete this.playerAnswers[playerId];

        if (this.currentDeciderIndex >= this.players.length) {
            this.currentDeciderIndex = 0;
        }

        if (this.players.length > 0 && this.getCurrentDecider().id === playerId) {
            this.currentDeciderIndex = (this.currentDeciderIndex + 1) % this.players.length;
        }

        return true;
    }

    /**
     * Returns the full current game status object for broadcasting to clients.
     * @returns {Object} Current game status snapshot.
     */
    getGameStatus() {
        return {
            currentRound: this.currentRound,
            totalRounds: this.numRounds,
            currentDecider: this.getCurrentDecider(),
            roundState: this.roundState,
            scores: this.players.map((player) => ({
                playerId: player.id,
                name: player.name,
                score: this.scores[player.id],
            })),
            isGameOver: this.isGameOver(),
            numPrompts: this.numPrompts,
            currentPrompts: this.currentPrompts,
            timeLimit: this.timeLimit,
        };
    }
}

module.exports = LogicCAH;
