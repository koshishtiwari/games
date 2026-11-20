// Timing constants (PROTOCOL.md section 1). Env overrides exist for tests only.
const DEFAULTS = {
  WINDOW_MS: 5000,
  TURN_MS: 25000,
  REVEAL_MS: 8000,
  GRACE_MS: 25000,
  QUEUE_FILL_MS: 8000,
  FREE_SOLO_MS: 20000,
  NO_MATCH_MS: 60000,
  START_WAIT_MS: 10000, // wait for humans to connect to the room before dealing starts
  DEAL_MS: 2500, // deal animation before the first turn
  OVER_CLOSE_MS: 10000,
};
export const MIN_HUMANS = 2;
export const SEATS = 5;
export const FEES = [0, 10, 50];

export function cfg(env) {
  const c = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = Number(env && env[k]);
    c[k] = Number.isFinite(v) && v > 0 ? v : DEFAULTS[k];
  }
  // bot reaction delays are scaled down when the window is shortened for tests
  c.BOT_SCALE = Math.min(1, c.WINDOW_MS / DEFAULTS.WINDOW_MS);
  return c;
}
