/**
 * @file escape-the-loop.js
 * @description Frontend game logic for "Escape the Loop". Provides the drag-and-drop
 * block programming interface and handles the AST parsing and execution to navigate the robot.
 */

document.addEventListener("DOMContentLoaded", () => {
    const gameLevels = typeof module !== "undefined" ? require("./levels.js") : window.levels;

    const GRID_CELL_SIZE_PX = 50; // CSS width/height of a grid cell
    const GRID_CELL_OFFSET_PX = 54; // Grid cell size including gap/margin

    let currentLevelIndex = 0;
    let bot = { x: 0, y: 0, dir: 0 };
    let isRunning = false;
    let isLevelComplete = false;

    // UI Elements
    const gridContainer = document.getElementById("grid-container");
    const gameStatus = document.getElementById("game-status");
    const levelIndicator = document.getElementById("level-indicator");
    const scriptContainer = document.getElementById("script-container");
    const btnRun = document.getElementById("btn-run");
    const btnClear = document.getElementById("btn-clear");

    const DIR_MAP = {
        0: { dx: 0, dy: -1 },
        90: { dx: 1, dy: 0 },
        180: { dx: 0, dy: 1 },
        270: { dx: -1, dy: 0 },
    };

    // --- Initialization ---
    /**
     * Initializes and renders a specific game level, resetting the robot's position and the UI state.
     * @param {number} index - The zero-based index of the level to load.
     */
    function loadLevel(index) {
        const level = gameLevels[index];
        if (!level) {
            console.error("Level not found:", index);
            return;
        }

        const levelLabel = document.getElementById("level-indicator");
        if (levelLabel) levelLabel.textContent = `Level ${level.id}`;

        const dirMapStr = { up: 0, right: 90, down: 180, left: 270 };
        bot.x = level.start.x;
        bot.y = level.start.y;
        bot.dir = dirMapStr[level.start.dir] || 0;

        renderGrid(level);
        updateBotVisual(false);
        gameStatus.textContent = "Awaiting commands...";
        gameStatus.style.color = "var(--accent-blue)";
        isLevelComplete = false;
        btnRun.textContent = "Run Script";
    }

    /**
     * Rebuilds the DOM grid based on the current level's dimensions, walls, and exit placement.
     * @param {Object} level - The level configuration object.
     */
    function renderGrid(level) {
        gridContainer.style.gridTemplateColumns = `repeat(${level.cols}, ${GRID_CELL_SIZE_PX}px)`;
        gridContainer.style.gridTemplateRows = `repeat(${level.rows}, ${GRID_CELL_SIZE_PX}px)`;
        gridContainer.innerHTML = "";

        for (let y = 0; y < level.rows; y++) {
            for (let x = 0; x < level.cols; x++) {
                const cell = document.createElement("div");
                cell.classList.add("cell");
                cell.dataset.x = x;
                cell.dataset.y = y;

                if (level.walls.some((w) => w.x === x && w.y === y)) {
                    cell.classList.add("wall");
                } else if (level.exit.x === x && level.exit.y === y) {
                    cell.classList.add("door");
                    cell.textContent = "🚪";
                }

                gridContainer.appendChild(cell);
            }
        }

        const botEl = document.createElement("div");
        botEl.classList.add("robot");
        botEl.id = "robot";
        gridContainer.appendChild(botEl);
    }

    function updateBotVisual(animate = true) {
        const botEl = document.getElementById("robot");
        if (!botEl) return;

        if (!animate) {
            botEl.style.transition = "none";
            void botEl.offsetWidth; // force reflow
        } else {
            botEl.style.transition = "all 0.3s ease";
        }
        botEl.style.transform = `translate(${bot.x * GRID_CELL_OFFSET_PX}px, ${bot.y * GRID_CELL_OFFSET_PX}px) rotate(${bot.dir}deg)`;
    }

    // --- Drag & Drop Engine ---
    let draggedEle = null;
    let isTemplate = false;

    /**
     * Makes an element draggable, attaching dragstart/dragend handlers.
     * Clones the element if it is dragged from the toolbox.
     * @param {HTMLElement} element - The block element to make draggable.
     */
    function setupDraggable(element) {
        element.setAttribute("draggable", "true");
        element.addEventListener("dragstart", (e) => {
            if (isRunning) {
                e.preventDefault();
                return;
            }
            draggedEle = element;
            isTemplate = element.closest(".toolbox") !== null;
            setTimeout(() => element.classList.add("dragging"), 0);
            e.dataTransfer.effectAllowed = isTemplate ? "copy" : "move";
            e.dataTransfer.setData("text/plain", element.dataset.type);
        });
        element.addEventListener("dragend", () => {
            element.classList.remove("dragging");
            draggedEle = null;
        });
    }

    /**
     * Sets up a drag-and-drop target zone that accepts block elements.
     * Prevents nested loops and handles both copy (from toolbox) and move actions.
     * @param {HTMLElement} zone - The dropzone container element.
     */
    function setupDropzone(zone) {
        zone.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = isTemplate ? "copy" : "move";
            zone.classList.add("drag-over");
        });
        zone.addEventListener("dragleave", () => {
            zone.classList.remove("drag-over");
        });
        zone.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove("drag-over");
            if (!draggedEle) return;

            if (zone.classList.contains("loop-body") && draggedEle.dataset.type === "loop") {
                gameStatus.textContent = "Nested loops not supported!";
                setTimeout(() => {
                    gameStatus.textContent = "Awaiting commands...";
                }, 2000);
                return;
            }

            if (isTemplate) {
                const clone = draggedEle.cloneNode(true);
                clone.classList.remove("dragging");
                setupDraggable(clone);
                const innerZone = clone.querySelector(".dropzone");
                if (innerZone) setupDropzone(innerZone);
                addDeleteBtn(clone);
                zone.appendChild(clone);
            } else {
                if (draggedEle.contains(zone)) return;
                zone.appendChild(draggedEle);
            }
        });
    }

    /**
     * Appends a delete (×) button to a block element.
     * For loop blocks, the button is added to the loop header.
     * @param {HTMLElement} block - The block element to add the button to.
     */
    function addDeleteBtn(block) {
        const deleteButton = document.createElement("span");
        deleteButton.innerHTML = " &times;";
        deleteButton.style.cursor = "pointer";
        deleteButton.style.marginLeft = "auto";
        deleteButton.style.color = "#fff";
        deleteButton.style.fontWeight = "bold";
        deleteButton.onclick = () => block.remove();

        if (block.dataset.type === "loop") {
            const header = block.querySelector(".loop-header");
            header.appendChild(deleteButton);
        } else {
            block.style.display = "flex";
            block.style.alignItems = "center";
            block.appendChild(deleteButton);
        }
    }

    function clearScript() {
        if (isRunning) return;
        scriptContainer.innerHTML = "";
    }

    // --- Game Logic Engine ---
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function runScript() {
        if (isRunning) return;

        if (isLevelComplete) {
            if (currentLevelIndex < gameLevels.length - 1) {
                currentLevelIndex++;
                clearScript();
                loadLevel(currentLevelIndex);
            }
            return;
        }

        const cmds = parseCommands(scriptContainer);
        if (cmds.length === 0) {
            gameStatus.textContent = "Please add commands first.";
            return;
        }

        isRunning = true;
        btnRun.disabled = true;
        btnClear.disabled = true;
        gameStatus.style.color = "var(--text-main)";

        // Reset bot position
        loadLevel(currentLevelIndex);
        await sleep(400);

        let success = false;
        let crashed = false;
        const level = gameLevels[currentLevelIndex];

        for (const cmd of cmds) {
            if (crashed) break;

            gameStatus.textContent = `Executing: ${cmd.type}()`;

            if (cmd.type === "forward") {
                const normalizedDir = ((bot.dir % 360) + 360) % 360;
                const d = DIR_MAP[normalizedDir];
                const nx = bot.x + d.dx;
                const ny = bot.y + d.dy;

                if (nx < 0 || nx >= level.cols || ny < 0 || ny >= level.rows) {
                    crashed = true;
                    gameStatus.textContent = "CRASH! Out of bounds.";
                } else if (level.walls.some((w) => w.x === nx && w.y === ny)) {
                    crashed = true;
                    gameStatus.textContent = "CRASH! Hit a wall.";
                } else {
                    bot.x = nx;
                    bot.y = ny;
                }
            } else if (cmd.type === "turnLeft") {
                bot.dir -= 90;
            } else if (cmd.type === "turnRight") {
                bot.dir += 90;
            }

            updateBotVisual(true);
            await sleep(600);

            if (crashed) break;

            if (bot.x === level.exit.x && bot.y === level.exit.y) {
                success = true;
                break;
            }
        }

        if (success) {
            if (currentLevelIndex < gameLevels.length - 1) {
                gameStatus.textContent = "SUCCESS! Area Clear. Ready for next phase.";
                gameStatus.style.color = "var(--accent-green)";
                btnRun.textContent = "Next Level";
                isLevelComplete = true;
            } else {
                gameStatus.textContent = "SUCCESS! You Escaped the Grand Factory!";
                gameStatus.style.color = "var(--accent-green)";
            }
        } else if (!crashed) {
            gameStatus.textContent = "FAILED: End of execution reached.";
            gameStatus.style.color = "var(--accent-red)";
        } else {
            gameStatus.style.color = "var(--accent-red)";
        }

        isRunning = false;
        btnRun.disabled = false;
        btnClear.disabled = false;
    }

    /**
     * Recursively parses the DOM elements of the script container into a flat array of executable commands.
     * @param {HTMLElement} container - The DOM container holding the command blocks.
     * @returns {Array<{type: string}>} A flattened array of command objects.
     */
    function parseCommands(container) {
        const results = [];
        for (const c of container.children) {
            if (!c.classList.contains("block")) continue;
            const type = c.dataset.type;

            // Loop blocks are unrolled into a flat array of commands instantly.
            // This simplifies the execution engine (runScript) which only needs to process
            // a single 1D array of instructions sequentially, avoiding the need for a call stack.
            if (type === "loop") {
                const countInput = c.querySelector(".loop-count");
                const iters = parseInt(countInput.value) || 2;
                const body = c.querySelector(".loop-body");

                // Recursively parse the loop body so nested loops (if allowed in future)
                // flatten down correctly.
                const innerCmds = parseCommands(body);

                // Flatten the loop execution by duplicating the inner commands `iters` times
                for (let i = 0; i < iters; i++) {
                    results.push(...innerCmds);
                }
            } else {
                results.push({ type });
            }
        }
        return results;
    }

    // --- Wire up event listeners ---
    btnRun.addEventListener("click", runScript);
    btnClear.addEventListener("click", clearScript);

    document.querySelectorAll(".block").forEach(setupDraggable);
    document.querySelectorAll(".dropzone").forEach(setupDropzone);

    // --- Kick off the game ---
    loadLevel(0);
}); // end DOMContentLoaded

// Node.js export shim for test runner
if (typeof module !== "undefined") {
    const _levels = require("./levels.js");
    module.exports = {
        parseCommands: (() => {
            // Re-expose for tests — stub, real impl runs in browser context
            /**
             * Test stub implementation for parseCommands.
             * @param {Object} container - Stubbed container object.
             * @returns {Array<{type: string}>}
             */
            function parseCommands(container) {
                const results = [];
                for (const c of container.children) {
                    if (!c.classList.contains("block")) continue;
                    const type = c.dataset.type;
                    if (type === "loop") {
                        const countInput = c.querySelector(".loop-count");
                        const iters = parseInt(countInput.value) || 2;
                        const body = c.querySelector(".loop-body");
                        const innerCmds = parseCommands(body);
                        for (let i = 0; i < iters; i++) results.push(...innerCmds);
                    } else {
                        results.push({ type });
                    }
                }
                return results;
            }
            return parseCommands;
        })(),
        levels: _levels,
    };
}
