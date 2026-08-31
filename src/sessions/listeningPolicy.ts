/**
 * How many qualifying tutor turns pass between comprehension checks —
 * deterministic and cheap, so triggering a check never needs its own LLM
 * decision call.
 */
const CHECK_INTERVAL_TURNS = 3;

export function shouldTriggerCheck(qualifyingTurnsSinceLastCheck: number): boolean {
  return (
    qualifyingTurnsSinceLastCheck > 0 &&
    qualifyingTurnsSinceLastCheck % CHECK_INTERVAL_TURNS === 0
  );
}
