import { describe, expect, test } from 'vitest';
import {
  MAIA_ELO_LEVELS,
  RAMPFISH_DEFAULT_END_ELO,
  RAMPFISH_DEFAULT_START_ELO,
  RAMPFISH_DEFAULT_TURN_N,
  clampTurnN,
  computeRampProgress,
  interpolateElo,
  nearestSupportedMaiaElo
} from '../src/rampfish.js';

describe('rampfish helpers', () => {
  test('clampTurnN enforces defaults and bounds', () => {
    expect(clampTurnN(undefined)).toBe(RAMPFISH_DEFAULT_TURN_N);
    expect(clampTurnN('abc')).toBe(RAMPFISH_DEFAULT_TURN_N);
    expect(clampTurnN(0)).toBe(1);
    expect(clampTurnN(201)).toBe(200);
  });

  test('computeRampProgress ramps up from turn 1 to N', () => {
    expect(computeRampProgress(1, 20)).toBe(0);
    expect(computeRampProgress(20, 20)).toBe(1);
    expect(computeRampProgress(10.5, 20)).toBeCloseTo(0.5, 6);
  });

  test('computeRampProgress ramps down equally via interpolation', () => {
    const progress = computeRampProgress(11, 21);
    const elo = interpolateElo(1900, 1100, progress);
    expect(progress).toBe(0.5);
    expect(elo).toBe(1500);
  });

  test('N=1 starts at full progress on the first AI turn', () => {
    expect(computeRampProgress(1, 1)).toBe(1);
    expect(computeRampProgress(5, 1)).toBe(1);
  });

  test('computeRampProgress clamps before and after N', () => {
    expect(computeRampProgress(-2, 20)).toBe(0);
    expect(computeRampProgress(0, 20)).toBe(0);
    expect(computeRampProgress(30, 20)).toBe(1);
  });

  test('nearestSupportedMaiaElo maps to supported set', () => {
    expect(nearestSupportedMaiaElo(1149)).toBe(1100);
    expect(nearestSupportedMaiaElo(1150)).toBe(1100);
    expect(nearestSupportedMaiaElo(1180)).toBe(1200);
    expect(nearestSupportedMaiaElo(1870)).toBe(1900);
    expect(nearestSupportedMaiaElo(9999)).toBe(1900);
    expect(nearestSupportedMaiaElo('x')).toBe(RAMPFISH_DEFAULT_START_ELO);
    expect(nearestSupportedMaiaElo(RAMPFISH_DEFAULT_END_ELO)).toBe(1900);
    expect(MAIA_ELO_LEVELS).toEqual([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);
  });
});
