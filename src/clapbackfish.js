export const CLAPBACK_DEFAULT_FINAL_MOVE = 40;
export const CLAPBACK_MIN_FINAL_MOVE = 1;
export const CLAPBACK_TARGET_CP_MIN = -2000;
export const CLAPBACK_TARGET_CP_MAX = 2000;

export const CLAPBACK_PROFILES = {
  MIN: {
    skillLevel: 0,
    depth: 1,
    movetimeMs: 50
  },
  MAX: {
    skillLevel: 20,
    depth: 40,
    movetimeMs: 1500
  }
};

export function clampClapbackFinalMove(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return CLAPBACK_DEFAULT_FINAL_MOVE;
  }
  return Math.max(CLAPBACK_MIN_FINAL_MOVE, Math.round(parsed));
}

export function computeClapbackProgress(engineTurnIndex, finalMove) {
  const clampedFinalMove = clampClapbackFinalMove(finalMove);
  const turn = Number(engineTurnIndex);

  if (!Number.isFinite(turn) || turn <= 1 || clampedFinalMove <= 1) {
    return turn >= clampedFinalMove ? 1 : 0;
  }

  if (turn >= clampedFinalMove) {
    return 1;
  }

  return (turn - 1) / (clampedFinalMove - 1);
}

function lerpRounded(start, end, progress) {
  return Math.round(start + (end - start) * progress);
}

export function interpolateClapbackProfile({ engineTurnIndex, finalMove }) {
  const progress = computeClapbackProgress(engineTurnIndex, finalMove);

  return {
    skillLevel: lerpRounded(
      CLAPBACK_PROFILES.MIN.skillLevel,
      CLAPBACK_PROFILES.MAX.skillLevel,
      progress
    ),
    depth: lerpRounded(CLAPBACK_PROFILES.MIN.depth, CLAPBACK_PROFILES.MAX.depth, progress),
    movetimeMs: lerpRounded(
      CLAPBACK_PROFILES.MIN.movetimeMs,
      CLAPBACK_PROFILES.MAX.movetimeMs,
      progress
    ),
    progress
  };
}

export function computeClapbackTargetEvalCp({ engineTurnIndex, finalMove }) {
  const progress = computeClapbackProgress(engineTurnIndex, finalMove);
  return lerpRounded(CLAPBACK_TARGET_CP_MIN, CLAPBACK_TARGET_CP_MAX, progress);
}

export function isPostClapbackPhase(engineTurnIndex, finalMove) {
  const turn = Number(engineTurnIndex);
  if (!Number.isFinite(turn)) {
    return false;
  }
  return turn > clampClapbackFinalMove(finalMove);
}
