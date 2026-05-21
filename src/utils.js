/**
 * @file utils.js
 * @description Shared pure utility functions used by room management and game services.
 * All functions in this module are stateless and have no side effects.
 */

"use strict";

/**
 * Normalizes a player name to a lowercase, trimmed string for duplicate-name checks.
 * @param {*} name - Raw name value (may be any type).
 * @returns {string} Lowercase, trimmed string, or empty string if input is falsy.
 */
function normalizeName(name) {
    return String(name || "")
        .trim()
        .toLowerCase();
}

/**
 * Returns a new array that is a shuffled copy of the input, using the Fisher-Yates algorithm.
 * The original array is not mutated.
 * @template T
 * @param {T[]} array - The array to shuffle.
 * @returns {T[]} A new shuffled array.
 */
function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Returns a new array of `count` unique randomly sampled items from `array`.
 * Returns an empty array if `count` exceeds the array length.
 * @template T
 * @param {T[]} array - The source array to sample from.
 * @param {number} count - Number of unique items to return.
 * @returns {T[]} Array of `count` unique items, or [] if count > array.length.
 */
function sampleUnique(array, count) {
    if (count > array.length) {
        return [];
    }
    return shuffle(array).slice(0, count);
}

/**
 * Returns a single random item from an array.
 * @template T
 * @param {T[]} array - The source array.
 * @returns {T|null} A random element, or null if the array is empty or not an array.
 */
function randomItem(array) {
    if (!Array.isArray(array) || array.length === 0) {
        return null;
    }
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Parses a value as a non-negative integer, returning a fallback if invalid.
 * @param {*} value - The value to parse.
 * @param {number} [fallback=0] - Value returned when `value` is not a valid non-negative integer.
 * @returns {number} The parsed integer, or `fallback`.
 */
function sanitizeNonNegativeInt(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

module.exports = {
    normalizeName,
    shuffle,
    sampleUnique,
    randomItem,
    sanitizeNonNegativeInt,
};
