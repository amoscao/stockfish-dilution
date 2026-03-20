import { describe, expect, test } from 'vitest';
import {
  CLAPBACK_DEFAULT_FINAL_MOVE,
  CLAPBACK_PROFILES,
  CLAPBACK_TARGET_CP_MAX,
  CLAPBACK_TARGET_CP_MIN,
  clampClapbackFinalMove,
  computeClapbackProgress,
  computeClapbackTargetEvalCp,
  interpolateClapbackProfile,
  isPostClapbackPhase
} from '../src/clapbackfish.js';

describe('clapbackfish helpers', () => {
  test('clampClapbackFinalMove uses default on invalid values', () => {
    expect(clampClapbackFinalMove(undefined)).toBe(CLAPBACK_DEFAULT_FINAL_MOVE);
    expect(clampClapbackFinalMove('')).toBe(1);
    expect(clampClapbackFinalMove('abc')).toBe(CLAPBACK_DEFAULT_FINAL_MOVE);
  });

  test('clampClapbackFinalMove enforces min and rounds', () => {
    expect(clampClapbackFinalMove(0)).toBe(1);
    expect(clampClapbackFinalMove(-2)).toBe(1);
    expect(clampClapbackFinalMove(7.7)).toBe(8);
  });

  test('computeClapbackProgress handles endpoints and midpoint', () => {
    expect(computeClapbackProgress(1, 40)).toBe(0);
    expect(computeClapbackProgress(40, 40)).toBe(1);
    expect(computeClapbackProgress(80, 40)).toBe(1);
    expect(computeClapbackProgress(20.5, 40)).toBeCloseTo(0.5, 6);
  });

  test('interpolateClapbackProfile first/mid/final', () => {
    const first = interpolateClapbackProfile({
      engineTurnIndex: 1,
      finalMove: 40
    });
    const mid = interpolateClapbackProfile({
      engineTurnIndex: 20.5,
      finalMove: 40
    });
    const last = interpolateClapbackProfile({
      engineTurnIndex: 40,
      finalMove: 40
    });

    expect(first).toEqual({ ...CLAPBACK_PROFILES.MIN, progress: 0 });
    expect(mid).toEqual({ skillLevel: 10, depth: 21, movetimeMs: 775, progress: 0.5 });
    expect(last).toEqual({ ...CLAPBACK_PROFILES.MAX, progress: 1 });
  });

  test('interpolateClapbackProfile saturation after final turn', () => {
    const after = interpolateClapbackProfile({
      engineTurnIndex: 120,
      finalMove: 40
    });

    expect(after).toEqual({ ...CLAPBACK_PROFILES.MAX, progress: 1 });
  });

  test('clapback profile values are monotonic increasing across turns', () => {
    let lastUp = interpolateClapbackProfile({
      engineTurnIndex: 1,
      finalMove: 40
    });

    for (let turn = 2; turn <= 60; turn += 1) {
      const up = interpolateClapbackProfile({
        engineTurnIndex: turn,
        finalMove: 40
      });

      expect(up.skillLevel).toBeGreaterThanOrEqual(lastUp.skillLevel);
      expect(up.depth).toBeGreaterThanOrEqual(lastUp.depth);
      expect(up.movetimeMs).toBeGreaterThanOrEqual(lastUp.movetimeMs);

      lastUp = up;
    }
  });

  test('target eval drifts from -2000cp to +2000cp', () => {
    expect(computeClapbackTargetEvalCp({ engineTurnIndex: 1, finalMove: 40 })).toBe(
      CLAPBACK_TARGET_CP_MIN
    );
    expect(computeClapbackTargetEvalCp({ engineTurnIndex: 40, finalMove: 40 })).toBe(
      CLAPBACK_TARGET_CP_MAX
    );
    expect(computeClapbackTargetEvalCp({ engineTurnIndex: 20.5, finalMove: 40 })).toBe(0);
  });

  test('post-clapback phase starts strictly after final move', () => {
    expect(isPostClapbackPhase(40, 40)).toBe(false);
    expect(isPostClapbackPhase(41, 40)).toBe(true);
    expect(isPostClapbackPhase(2, 1)).toBe(true);
    expect(isPostClapbackPhase(1, 1)).toBe(false);
  });
});
