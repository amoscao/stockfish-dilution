export const MAIA_ELO_LEVELS = Object.freeze([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);

export const RAMPFISH_DEFAULT_START_ELO = 1100;
export const RAMPFISH_DEFAULT_END_ELO = 1900;
export const RAMPFISH_DEFAULT_TURN_N = 20;
export const RAMPFISH_MIN_TURN_N = 1;
export const RAMPFISH_MAX_TURN_N = 200;

export function clampTurnN(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return RAMPFISH_DEFAULT_TURN_N;
  }

  return Math.max(RAMPFISH_MIN_TURN_N, Math.min(RAMPFISH_MAX_TURN_N, Math.round(parsed)));
}

export function computeRampProgress(engineTurnIndex, turnN) {
  const clampedTurnN = clampTurnN(turnN);
  const turn = Number(engineTurnIndex);

  if (!Number.isFinite(turn) || turn <= 0) {
    return 0;
  }

  if (clampedTurnN === 1) {
    return turn >= 1 ? 1 : 0;
  }

  if (turn <= 1) {
    return 0;
  }

  if (turn >= clampedTurnN) {
    return 1;
  }

  return (turn - 1) / (clampedTurnN - 1);
}

export function interpolateElo(startElo, endElo, progress) {
  const from = Number(startElo);
  const to = Number(endElo);
  const p = Number(progress);

  const safeFrom = Number.isFinite(from) ? from : RAMPFISH_DEFAULT_START_ELO;
  const safeTo = Number.isFinite(to) ? to : RAMPFISH_DEFAULT_END_ELO;
  const safeProgress = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;

  return Math.round(safeFrom + (safeTo - safeFrom) * safeProgress);
}

export function nearestSupportedMaiaElo(elo) {
  const parsed = Number(elo);
  if (!Number.isFinite(parsed)) {
    return RAMPFISH_DEFAULT_START_ELO;
  }

  let nearest = MAIA_ELO_LEVELS[0];
  let bestDistance = Math.abs(parsed - nearest);
  for (let i = 1; i < MAIA_ELO_LEVELS.length; i += 1) {
    const candidate = MAIA_ELO_LEVELS[i];
    const distance = Math.abs(parsed - candidate);
    if (distance < bestDistance) {
      nearest = candidate;
      bestDistance = distance;
    }
  }

  return nearest;
}
