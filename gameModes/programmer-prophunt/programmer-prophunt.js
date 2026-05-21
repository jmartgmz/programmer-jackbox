/**
 * @file programmer-prophunt.js
 * @description ProgrammerProphunt - Code Hiding and Finding Game
 * Core game engine for Programmer Prophunt. Manages round states, roles, and scoring.
 */

class ProgrammerProphunt {
    constructor(players, numRounds, timeLimit, complexity) {
        this.players = players; // Array of player objects with { id, name }
        this.numRounds = numRounds;
        this.timeLimit = timeLimit; // in seconds
        this.complexity = complexity; // "easy", "medium", "hard"

        // Split players into two teams
        this.team1 = []; // Hiders in first round, Finders in second
        this.team2 = [];
        this.splitTeams();

        this.scores = {};
        this.players.forEach((p) => {
            this.scores[p.id] = 0;
        });

        this.currentRound = 0;
        this.currentPhase = "HIDERS_WRITING"; // HIDERS_WRITING, FINDERS_SELECTING, ROUND_COMPLETE
        this.codeBlock = this.generateInitialCode();
        this.hiderLines = {}; // { playerId: "line of code" }
        this.finderSelections = {}; // { playerId: selectedHiderId }
        this.roundResults = null;
        this.isTeam1Hiding = true; // Track which team is hiding
    }

    /**
     * Split players into two equal teams
     */
    splitTeams() {
        const shuffled = [...this.players].sort(() => Math.random() - 0.5);
        const midpoint = Math.ceil(shuffled.length / 2);

        this.team1 = shuffled.slice(0, midpoint);
        this.team2 = shuffled.slice(midpoint);
    }

    /**
     * Generate initial code block based on complexity
     */
    generateInitialCode() {
        try {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.join(__dirname, "snippets.json");
            const snippets = JSON.parse(fs.readFileSync(filePath, "utf8"));

            const levelSnippets = snippets[this.complexity] || snippets.medium || [];
            if (levelSnippets.length === 0) return "function fallback() { return true; }";

            // Pick a random snippet from the list and join it into a string
            const snippetArray = levelSnippets[Math.floor(Math.random() * levelSnippets.length)];
            return snippetArray.join("\n");
        } catch (e) {
            console.error("Failed to load prophunt snippets in engine", e);
            return "function fallback() { return true; }";
        }
    }

    /**
     * Get the current hiding team
     */
    getHidingTeam() {
        return this.isTeam1Hiding ? this.team1 : this.team2;
    }

    /**
     * Get the current finding team
     */
    getFindingTeam() {
        return this.isTeam1Hiding ? this.team2 : this.team1;
    }

    /**
     * Check if all hiders have submitted their lines
     */
    allHidersSubmitted() {
        const hidingTeam = this.getHidingTeam();
        return hidingTeam.every((player) => this.hiderLines[player.id]);
    }

    /**
     * Check if all finders have made their selections
     */
    allFindersSubmitted() {
        const findingTeam = this.getFindingTeam();
        return findingTeam.every((player) => this.finderSelections[player.id]);
    }

    /**
     * Hider submits a new line of code
     * @param {string} playerId - Hider's player ID
     * @param {string} codeLine - The line they're adding
     */
    submitHiderLine(playerId, codeLine) {
        if (this.currentPhase !== "HIDERS_WRITING") {
            throw new Error("Hiders cannot submit lines at this time");
        }

        const hidingTeam = this.getHidingTeam();
        const player = hidingTeam.find((p) => p.id === playerId);
        if (!player) {
            throw new Error("Player is not on the hiding team");
        }

        if (this.hiderLines[playerId]) {
            throw new Error("Player has already submitted a line");
        }

        if (!codeLine || codeLine.trim().length === 0) {
            throw new Error("Code line cannot be empty");
        }

        this.hiderLines[playerId] = codeLine;

        // If all hiders have submitted, update code block and move to finder phase
        if (this.allHidersSubmitted()) {
            this.updateCodeBlock();
            this.currentPhase = "FINDERS_SELECTING";
        }

        return {
            success: true,
            allSubmitted: this.allHidersSubmitted(),
        };
    }

    /**
     * Update the code block with all hider lines
     */
    updateCodeBlock() {
        const hidingTeam = this.getHidingTeam();
        const newLines = hidingTeam.map((player) => this.hiderLines[player.id]);
        this.codeBlock += "\n" + newLines.join("\n");
    }

    /**
     * Get the current code block for finders
     */
    getCodeBlock() {
        if (this.currentPhase !== "FINDERS_SELECTING") {
            throw new Error("Code block is not ready to be shown");
        }
        return this.codeBlock;
    }

    /**
     * Get all hider lines anonymously for finders to select from
     */
    getAnonymousHiderLines() {
        if (this.currentPhase !== "FINDERS_SELECTING") {
            throw new Error("Hider lines are not ready to be shown");
        }

        const hidingTeam = this.getHidingTeam();
        return hidingTeam.map((player) => ({
            hiderId: player.id,
            lineNumber: Object.keys(this.hiderLines).indexOf(player.id) + 1,
        }));
    }

    /**
     * Finder selects a hider they think is suspicious
     * @param {string} finderId - Finder's player ID
     * @param {string} selectedHiderId - ID of the hider they're selecting
     */
    finderSelectsHider(finderId, selectedHiderId) {
        if (this.currentPhase !== "FINDERS_SELECTING") {
            throw new Error("Finders cannot select at this time");
        }

        const findingTeam = this.getFindingTeam();
        const finder = findingTeam.find((p) => p.id === finderId);
        if (!finder) {
            throw new Error("Player is not on the finding team");
        }

        if (this.finderSelections[finderId]) {
            throw new Error("Finder has already made their selection");
        }

        const hidingTeam = this.getHidingTeam();
        if (!hidingTeam.find((p) => p.id === selectedHiderId)) {
            throw new Error("Selected player is not on the hiding team");
        }

        this.finderSelections[finderId] = selectedHiderId;

        // If all finders have selected, calculate round results
        if (this.allFindersSubmitted()) {
            this.calculateRoundResults();
            this.currentPhase = "ROUND_COMPLETE";
        }

        return {
            success: true,
            allSubmitted: this.allFindersSubmitted(),
        };
    }

    /**
     * Calculate scores for the round
     */
    calculateRoundResults() {
        const hidingTeam = this.getHidingTeam();
        const findingTeam = this.getFindingTeam();
        const finderSelections = Object.values(this.finderSelections);

        const correctIdentifications = new Set(finderSelections);
        const correctCount = correctIdentifications.size;

        // Finders get a point for each correctly identified hider
        findingTeam.forEach((finder) => {
            this.scores[finder.id] += correctCount;
        });

        // Hiders get a point for each team member NOT identified
        const notIdentified = hidingTeam.filter((hider) => !correctIdentifications.has(hider.id));
        notIdentified.forEach((hider) => {
            this.scores[hider.id] += 1;
        });

        this.roundResults = {
            findersScore: correctCount,
            hidersScore: notIdentified.length,
            correctlyIdentified: Array.from(correctIdentifications),
            notIdentified: notIdentified.map((h) => h.id),
        };
    }

    /**
     * Get round results (who was identified, points awarded)
     */
    getRoundResults() {
        if (!this.roundResults) {
            throw new Error("Round results are not available yet");
        }
        return this.roundResults;
    }

    /**
     * Complete current round and prepare for next
     */
    completeRound() {
        this.currentRound++;
        this.isTeam1Hiding = !this.isTeam1Hiding; // Swap roles
        this.hiderLines = {};
        this.finderSelections = {};
        this.roundResults = null;
        this.currentPhase = "HIDERS_WRITING";

        return {
            roundComplete: true,
            nextRound: this.currentRound,
            nextHidingTeam: this.getHidingTeam(),
        };
    }

    /**
     * Check if the game is over
     */
    isGameOver() {
        return this.currentRound >= this.numRounds;
    }

    /**
     * Get final scores
     */
    getFinalScores() {
        if (!this.isGameOver()) {
            throw new Error("Game is not over yet");
        }

        const standings = this.players
            .map((p) => ({
                name: p.name,
                team: this.team1.find((t) => t.id === p.id) ? "Team 1" : "Team 2",
                score: this.scores[p.id],
            }))
            .sort((a, b) => b.score - a.score);

        return standings;
    }

    /**
     * Remove a player from the game
     */
    removePlayer(playerId) {
        const playerIndex = this.players.findIndex((p) => p.id === playerId);
        if (playerIndex === -1) {
            return false; // Player not found
        }

        // Remove player from players array
        this.players.splice(playerIndex, 1);

        // Remove from teams
        this.team1 = this.team1.filter((p) => p.id !== playerId);
        this.team2 = this.team2.filter((p) => p.id !== playerId);

        // Remove from scores
        delete this.scores[playerId];

        // Remove from hiderLines if they were a hider
        delete this.hiderLines[playerId];

        // Remove from finderSelections if they were a finder
        delete this.finderSelections[playerId];

        // If teams become unbalanced, we might need to rebalance
        // For now, just ensure teams are as balanced as possible
        if (this.team1.length > this.team2.length + 1) {
            // Move one from team1 to team2
            const movedPlayer = this.team1.pop();
            if (movedPlayer) this.team2.push(movedPlayer);
        } else if (this.team2.length > this.team1.length + 1) {
            // Move one from team2 to team1
            const movedPlayer = this.team2.pop();
            if (movedPlayer) this.team1.push(movedPlayer);
        }

        return true;
    }

    /**
     * Get current game status
     */
    getGameStatus() {
        return {
            currentRound: this.currentRound,
            totalRounds: this.numRounds,
            hidingTeam: this.getHidingTeam(),
            findingTeam: this.getFindingTeam(),
            currentPhase: this.currentPhase,
            scores: this.scores,
            isGameOver: this.isGameOver(),
        };
    }
}

module.exports = ProgrammerProphunt;
