/**
 * @file constants.js
 * @description Shared server-side constants used across game services, room management, and socket handlers.
 */

"use strict";

/** Milliseconds a player has to rejoin a room after disconnecting (CAH rejoin grace period). */
const ROOM_REJOIN_GRACE_MS = 5000;

/** Minimum number of players required to start a Bug Fixer game. */
const BUG_FIXER_MIN_PLAYERS = 3;

/** Number of solution cards dealt to each player's hand. */
const BUG_FIXER_HAND_SIZE = 5;

/**
 * Milliseconds the decider has after selecting a winner before the round auto-finalizes.
 * This window allows the decider to change their pick.
 */
const BUG_FIXER_FINALIZE_DELAY_MS = 10000;

/** Minimum number of players required to start a Programmer Prophunt game. */
const PROPHUNT_MIN_PLAYERS = 4;

/** Milliseconds of inactivity after which an idle room is deleted by the janitor. */
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Milliseconds of inactivity after which transient (non-essential) room data
 * is pruned during soft cleanup, even if the room is still alive.
 */
const ROOM_SOFT_CLEANUP_TTL_MS = 10 * 60 * 1000;

/** Interval in milliseconds at which the room janitor runs its cleanup pass. */
const ROOM_JANITOR_INTERVAL_MS = 60 * 1000;

/** Maximum number of entries retained in the in-memory cleanup archive log. */
const CLEANUP_ARCHIVE_LIMIT = 200;

module.exports = {
    ROOM_REJOIN_GRACE_MS,
    BUG_FIXER_MIN_PLAYERS,
    BUG_FIXER_HAND_SIZE,
    BUG_FIXER_FINALIZE_DELAY_MS,
    PROPHUNT_MIN_PLAYERS,
    ROOM_IDLE_TTL_MS,
    ROOM_SOFT_CLEANUP_TTL_MS,
    ROOM_JANITOR_INTERVAL_MS,
    CLEANUP_ARCHIVE_LIMIT,
};
