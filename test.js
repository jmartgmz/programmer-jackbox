/**
 * @file test.js
 * @description Test runner for LogicCAH and ProgrammerProphunt game logic
 * Run with: node test.js
 */

const LogicCAH = require("./gameModes/logic-cah/logic-cah.js");
const ProgrammerProphunt = require("./gameModes/programmer-prophunt/programmer-prophunt.js");

// ============================================
// TEST SETUP
// ============================================

const testPlayers = [
    { id: "p1", name: "Alice" },
    { id: "p2", name: "Bob" },
    { id: "p3", name: "Charlie" },
    { id: "p4", name: "Diana" },
];

console.log("\n" + "=".repeat(60));
console.log("TESTING LOGICCAH GAME MODE");
console.log("=".repeat(60) + "\n");

// ============================================
// LOGICCAH TESTS
// ============================================

const logiccah = new LogicCAH(testPlayers, 2, 30, 2); // 2 rounds, 30 sec limit, 2 prompts

console.log("1. Initial game status:");
console.log(JSON.stringify(logiccah.getGameStatus(), null, 2));

console.log("\n2. Current decider:", logiccah.getCurrentDecider().name);
console.log(
    "   Non-deciders:",
    logiccah
        .getNonDeciders()
        .map((p) => p.name)
        .join(", ")
);

// Simulate players submitting answers
console.log("\n3. Submitting answers from players...");
try {
    logiccah.submitAnswers("p2", ["answer1_prompt1", "answer1_prompt2"]);
    console.log("   ✓ Bob submitted answers");

    logiccah.submitAnswers("p3", ["answer2_prompt1", "answer2_prompt2"]);
    console.log("   ✓ Charlie submitted answers");

    logiccah.submitAnswers("p4", ["answer3_prompt1", "answer3_prompt2"]);
    console.log("   ✓ Diana submitted answers");

    console.log("   All answers submitted:", logiccah.allAnswersSubmitted());
} catch (e) {
    console.error("   Error:", e.message);
}

// Show answers to decider
console.log("\n4. Anonymous answers for decider:");
const anonAnswers = logiccah.getAnonymousAnswers();
anonAnswers.forEach((ans, idx) => {
    const playerName = testPlayers.find((p) => p.id === ans.playerId).name;
    console.log(`   Option ${idx + 1} (${playerName}):`, ans.answers);
});

// Decider selects
console.log("\n5. Decider (Alice) selects best answer...");
try {
    const result = logiccah.deciderSelectsAnswers("p2");
    console.log(`   ✓ Selected: ${result.selectedPlayer}`);
    console.log(`   Points awarded: ${result.pointAwarded}`);
} catch (e) {
    console.error("   Error:", e.message);
}

// Reveal
console.log("\n6. Revealing selected player:");
const revealed = logiccah.revealSelectedPlayer();
console.log(`   Selected: ${revealed.selectedPlayerName}`);
console.log(`   Total points: ${revealed.points}`);

// Complete round
console.log("\n7. Completing round 1...");
const nextRound = logiccah.completeRound();
console.log(`   Next decider: ${nextRound.nextDecider.name}`);
console.log(`   Round: ${nextRound.nextRound}`);

// Check game status
console.log("\n8. Game status after round 1:");
console.log(JSON.stringify(logiccah.getGameStatus(), null, 2));

// Complete round 2
console.log("\n9. Completing round 2...");
logiccah.submitAnswers("p1", ["answer4_prompt1", "answer4_prompt2"]);
logiccah.submitAnswers("p3", ["answer5_prompt1", "answer5_prompt2"]);
logiccah.submitAnswers("p4", ["answer6_prompt1", "answer6_prompt2"]);
logiccah.deciderSelectsAnswers("p3");
logiccah.completeRound();

console.log("   Game over:", logiccah.isGameOver());
console.log("\n10. Final scores:");
console.log(JSON.stringify(logiccah.getFinalScores(), null, 2));

// ============================================
// PROGRAMMERPROPHUNT TESTS
// ============================================

console.log("\n\n" + "=".repeat(60));
console.log("TESTING PROGRAMMERPROPHUNT GAME MODE");
console.log("=".repeat(60) + "\n");

const prophunt = new ProgrammerProphunt(testPlayers, 1, 30, "easy");

console.log("1. Initial game status:");
const status1 = prophunt.getGameStatus();
console.log(`   Hiding team (Round 1): ${status1.hidingTeam.map((p) => p.name).join(", ")}`);
console.log(`   Finding team (Round 1): ${status1.findingTeam.map((p) => p.name).join(", ")}`);
console.log(`   Phase: ${status1.currentPhase}`);

console.log("\n2. Initial code block:");
console.log(prophunt.getCodeBlock ? prophunt.codeBlock : "   (Will be shown after hiders submit)");

// Hiders submit lines
console.log("\n3. Hiders submitting their lines...");
const hidingTeam = prophunt.getHidingTeam();
try {
    hidingTeam.forEach((player, idx) => {
        const line = `    // Suspicious line ${idx + 1} added by ${player.name}`;
        prophunt.submitHiderLine(player.id, line);
        console.log(`   ✓ ${player.name} submitted: "${line}"`);
    });
} catch (e) {
    console.error("   Error:", e.message);
}

console.log("\n4. Code block after hiders submit:");
console.log(prophunt.codeBlock);

console.log("\n5. Finders selecting hiders...");
const findingTeam = prophunt.getFindingTeam();
const hidersForSelection = hidingTeam;

try {
    findingTeam.forEach((finder, idx) => {
        const targetHider = hidersForSelection[idx];
        prophunt.finderSelectsHider(finder.id, targetHider.id);
        console.log(`   ✓ ${finder.name} selected ${targetHider.name}`);
    });
} catch (e) {
    console.error("   Error:", e.message);
}

console.log("\n6. Round results:");
const results = prophunt.getRoundResults();
console.log(`   Finders score: ${results.findersScore}`);
console.log(`   Hiders score: ${results.hidersScore}`);
console.log(
    `   Correctly identified: ${results.correctlyIdentified.map((id) => testPlayers.find((p) => p.id === id).name).join(", ")}`
);
console.log(
    `   Not identified: ${results.notIdentified.map((id) => testPlayers.find((p) => p.id === id).name).join(", ")}`
);

console.log("\n7. Current scores:");
Object.entries(prophunt.scores).forEach(([playerId, score]) => {
    const name = testPlayers.find((p) => p.id === playerId).name;
    console.log(`   ${name}: ${score}`);
});

console.log("\n8. Completing round 1...");
prophunt.completeRound();
const status2 = prophunt.getGameStatus();
console.log(`   Hiding team (Round 2): ${status2.hidingTeam.map((p) => p.name).join(", ")}`);
console.log(`   Finding team (Round 2): ${status2.findingTeam.map((p) => p.name).join(", ")}`);
console.log(`   Game over: ${status2.isGameOver}`);

console.log("\n9. Final scores:");
console.log(JSON.stringify(prophunt.getFinalScores(), null, 2));

console.log("\n" + "=".repeat(60));
console.log("ALL TESTS COMPLETED");
console.log("=".repeat(60) + "\n");
