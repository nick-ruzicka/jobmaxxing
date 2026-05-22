// The fallback "what is the user targeting" goal string, used when
// modes/_profile.md is absent. Single source for both the briefing generator
// (Node) and the dashboard chat route (TS). Pure template — each runtime
// supplies the comp-floor string from its own comp-floor module, so this stays
// dependency-free and identical across runtimes.

/**
 * @param {string} floorString - formatted comp floor, e.g. "$200K"
 * @returns {string} the goal-fallback narrative
 */
export function defaultGoalFallback(floorString) {
  return `GTM Engineer / RevOps roles, NYC area or remote, ${floorString}+ floor, Series B+ companies`;
}
