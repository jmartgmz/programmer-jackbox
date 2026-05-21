/**
 * @file flexbox-spider.js
 * @description Frontend game logic for "Flexbox Spider". Manages CSS parsing,
 * target validation, and visual rendering of the spider web challenges.
 */

let levels = typeof window !== "undefined" && window.levels ? window.levels : [];
let currentLevelIndex = 0;

if (typeof fetch !== "undefined") {
    fetch("/flexbox-spider/levels.json")
        .then((res) => res.json())
        .then((data) => {
            levels = data;
            loadLevel(0);
        });
}

const webContainer = document.getElementById("web-container") || document.createElement("div");
const targetContainer = document.getElementById("target-container") || document.createElement("div");
const spiderEl = document.getElementById("spider") || document.createElement("div");
const targetWebEl = document.getElementById("target-web") || document.createElement("div");
const cssInput = document.getElementById("css-input") || document.createElement("textarea");
const feedbackEl = document.getElementById("feedback") || document.createElement("div");
const nextBtn = document.getElementById("next-btn") || document.createElement("button");

/**
 * Loads a level by index: sets up the web container, target container,
 * spider/web elements, and resets the CSS input.
 * @param {number} index - Zero-based index of the level to load.
 */
function loadLevel(index) {
    currentLevelIndex = index;
    const level = levels[index];

    const levelLabel = document.getElementById("level-label");
    if (levelLabel) levelLabel.textContent = `Level ${index + 1} / ${levels.length}`;
    const levelDescription = document.getElementById("level-desc");
    if (levelDescription) levelDescription.textContent = level.description;
    const levelHint = document.getElementById("level-hint");
    if (levelHint) levelHint.textContent = "💡 Hint: " + level.hint;

    const selectorLabel = document.getElementById("css-selector-label");
    if (selectorLabel) selectorLabel.textContent = level.target === "spider" ? "#spider {" : "#web-container {";

    webContainer.style.cssText = "";
    targetContainer.style.cssText = "";
    spiderEl.style.cssText = "";
    targetWebEl.style.cssText = "";

    if (level.startCss) {
        for (const [prop, val] of Object.entries(level.startCss)) {
            webContainer.style[prop] = val;
            targetContainer.style[prop] = val;
        }
    }

    const expectedProp = camelCase(level.property);
    const expectedVal = level.answer;

    if (level.target === "spider") {
        targetWebEl.style[expectedProp] = expectedVal;
    } else {
        targetContainer.style[expectedProp] = expectedVal;
    }

    spiderEl.textContent = "🕷️";
    spiderEl.className = "spider-item";
    spiderEl.style.fontSize = "40px";

    targetWebEl.textContent = "🕸️";
    targetWebEl.className = "target-item";
    targetWebEl.style.fontSize = "40px";

    webContainer.innerHTML = "";
    targetContainer.innerHTML = "";

    if (level.answer.includes("space-")) {
        webContainer.appendChild(spiderEl);
        targetContainer.appendChild(targetWebEl);
        for (let i = 0; i < 2; i++) {
            const decoySpider = document.createElement("div");
            decoySpider.textContent = "🕷️";
            decoySpider.className = "spider-item";
            decoySpider.style.fontSize = "40px";
            webContainer.appendChild(decoySpider);

            const decoyTarget = document.createElement("div");
            decoyTarget.textContent = "🕸️";
            decoyTarget.className = "target-item";
            decoyTarget.style.fontSize = "40px";
            targetContainer.appendChild(decoyTarget);
        }
    } else if (level.answer === "wrap") {
        webContainer.appendChild(spiderEl);
        targetContainer.appendChild(targetWebEl);
        webContainer.style.width = "160px";
        targetContainer.style.width = "160px";
        spiderEl.style.minWidth = "100px";
        targetWebEl.style.minWidth = "100px";

        for (let i = 0; i < 2; i++) {
            const decoySpider = document.createElement("div");
            decoySpider.textContent = "🕷️";
            decoySpider.className = "spider-item";
            decoySpider.style.fontSize = "40px";
            decoySpider.style.minWidth = "100px";
            webContainer.appendChild(decoySpider);

            const decoyTarget = document.createElement("div");
            decoyTarget.textContent = "🕸️";
            decoyTarget.className = "target-item";
            decoyTarget.style.fontSize = "40px";
            decoyTarget.style.minWidth = "100px";
            targetContainer.appendChild(decoyTarget);
        }
    } else if (level.property === "order" || level.property === "align-self") {
        for (let i = 0; i < 2; i++) {
            const decoySpider = document.createElement("div");
            decoySpider.textContent = "🕷️";
            decoySpider.className = "spider-item";
            decoySpider.style.fontSize = "40px";
            decoySpider.style.opacity = "0.5";
            webContainer.appendChild(decoySpider);

            const decoyWeb = document.createElement("div");
            decoyWeb.textContent = "🕸️";
            decoyWeb.className = "target-item";
            decoyWeb.style.fontSize = "40px";
            decoyWeb.style.opacity = "0.5";
            targetContainer.appendChild(decoyWeb);
        }

        spiderEl.style.opacity = "1";
        targetWebEl.style.opacity = "1";
        webContainer.appendChild(spiderEl);
        targetContainer.appendChild(targetWebEl);

        for (let i = 0; i < 2; i++) {
            const decoySpider = document.createElement("div");
            decoySpider.textContent = "🕷️";
            decoySpider.className = "spider-item";
            decoySpider.style.fontSize = "40px";
            decoySpider.style.opacity = "0.5";
            webContainer.appendChild(decoySpider);

            const decoyWeb = document.createElement("div");
            decoyWeb.textContent = "🕸️";
            decoyWeb.className = "target-item";
            decoyWeb.style.fontSize = "40px";
            decoyWeb.style.opacity = "0.5";
            targetContainer.appendChild(decoyWeb);
        }
    } else {
        spiderEl.style.opacity = "1";
        targetWebEl.style.opacity = "1";
        spiderEl.style.minWidth = "60px";
        targetWebEl.style.minWidth = "60px";
        webContainer.appendChild(spiderEl);
        targetContainer.appendChild(targetWebEl);
    }

    cssInput.value = "";
    if (cssInput.focus) cssInput.focus();
    hideFeedback();
    nextBtn.classList.add("hidden");
}

/**
 * Parses the CSS input, applies it to the appropriate target, and checks correctness.
 */
function applyCSS() {
    const level = levels[currentLevelIndex];
    const raw = cssInput.value.trim();

    if (!raw) {
        showFeedback("❌ Enter a CSS property first!", "wrong");
        return;
    }

    const parsed = parseCSS(raw);

    if (Object.keys(parsed).length === 0) {
        showFeedback("❌ Couldn't parse that CSS. Try: " + level.property + ": " + level.answer + ";", "wrong");
        return;
    }

    const target = level.target === "spider" ? spiderEl : webContainer;
    for (const [prop, val] of Object.entries(parsed)) {
        target.style[prop] = val;
    }

    const expectedProp = camelCase(level.property);
    const expectedVal = level.answer.trim().toLowerCase();
    const appliedVal = (parsed[expectedProp] || "").trim().toLowerCase();

    if (appliedVal === expectedVal) {
        showFeedback("✅ Correct! The spider found its web!", "correct");
        nextBtn.classList.remove("hidden");
    } else {
        showFeedback(`❌ Not quite. Try: ${level.property}: ${level.answer};`, "wrong");
    }
}

/**
 * Advances to the next level, or calls `finishGame()` if on the last level.
 */
function nextLevel() {
    if (currentLevelIndex + 1 >= levels.length) {
        finishGame();
    } else {
        loadLevel(currentLevelIndex + 1);
    }
}

/**
 * Shows the completion screen after the player finishes all levels.
 */
function finishGame() {
    document.getElementById("res-levels").textContent = levels.length + " / " + levels.length;
    document.getElementById("game-screen").classList.add("hidden");
    document.getElementById("result-screen").classList.remove("hidden");
}

/**
 * Resets the game from the result screen back to level 1.
 */
function restartGame() {
    document.getElementById("game-screen").classList.remove("hidden");
    document.getElementById("result-screen").classList.add("hidden");
    loadLevel(0);
}

/**
 * Displays a feedback message in the feedback element.
 * @param {string} msg - The message to display.
 * @param {"correct"|"wrong"} type - CSS class for styling.
 */
function showFeedback(msg, type) {
    feedbackEl.textContent = msg;
    feedbackEl.className = type;
    feedbackEl.classList.remove("hidden");
}

/**
 * Hides the feedback element.
 */
function hideFeedback() {
    feedbackEl.textContent = "";
    feedbackEl.className = "hidden";
}

/**
 * Parses a CSS text block ("prop: value; prop2: value2;") into a camelCase keyed object.
 * @param {string} text - Raw CSS text from the user input.
 * @returns {Object.<string, string>} Parsed declarations.
 */
function parseCSS(text) {
    const result = {};
    const declarations = text
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    for (const decl of declarations) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const prop = decl.slice(0, colonIdx).trim();
        const val = decl.slice(colonIdx + 1).trim();
        if (prop && val) {
            result[camelCase(prop)] = val;
        }
    }
    return result;
}

/**
 * Converts a kebab-case CSS property string to camelCase for use with `element.style`.
 * @param {string} str - kebab-case string, e.g. "justify-content".
 * @returns {string} camelCase string, e.g. "justifyContent".
 */
function camelCase(str) {
    return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

if (typeof module !== "undefined" && module.exports) {
    window.applyCSS = applyCSS;
    window.nextLevel = nextLevel;
    window.restartGame = restartGame;
    module.exports = {
        loadLevel,
        applyCSS,
        nextLevel,
        finishGame,
        restartGame,
        showFeedback,
        hideFeedback,
        parseCSS,
        camelCase,
    };
}

// Allow Enter key in textarea to trigger Apply
cssInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        applyCSS();
    }
});
