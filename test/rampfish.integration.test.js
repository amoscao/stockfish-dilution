// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const boardController = vi.hoisted(() => ({
  onHumanMoveAttempt: null
}));

const createEngineMock = vi.hoisted(() => vi.fn());

const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  setSkillLevel: vi.fn().mockResolvedValue(undefined),
  setMaiaDifficulty: vi.fn().mockResolvedValue(undefined),
  newGame: vi.fn().mockResolvedValue(undefined),
  getBestMove: vi.fn().mockResolvedValue({ from: 'a7', to: 'a6' }),
  analyzePosition: vi.fn().mockResolvedValue({ type: 'cp', value: 0 }),
  getRankedMovesWithScores: vi.fn().mockResolvedValue([]),
  getRankedMoves: vi.fn().mockResolvedValue([]),
  flushAnalysis: vi.fn(),
  terminate: vi.fn()
}));

const boardMock = vi.hoisted(() => ({
  setMoveQueryHandlers: vi.fn(),
  setInteractionEnabled: vi.fn(),
  setLastMove: vi.fn(),
  setKingOutcome: vi.fn(),
  setBlindMarkers: vi.fn(),
  render: vi.fn()
}));

function createGameDouble() {
  let turn = 'w';
  let humanColor = 'w';
  let history = [];

  return {
    newGame(nextHumanColor) {
      humanColor = nextHumanColor;
      turn = humanColor === 'w' ? 'b' : 'w';
      history = [];
    },
    loadFen: vi.fn(),
    getFen() {
      return '4k3/8/8/8/8/8/8/4K3 b - - 0 1';
    },
    getTurn() {
      return turn;
    },
    getHumanColor() {
      return humanColor;
    },
    getPosition() {
      return {
        e1: { color: 'w', type: 'k' },
        e8: { color: 'b', type: 'k' },
        a2: { color: 'w', type: 'p' },
        a7: { color: 'b', type: 'p' }
      };
    },
    getLegalMoves: vi.fn().mockReturnValue([]),
    getAllLegalMoves: vi.fn(() => [{ from: 'a7', to: 'a6' }]),
    applyMove: vi.fn(() => {
      history.push('a6');
      turn = turn === 'w' ? 'b' : 'w';
      return { ok: true };
    }),
    isLegalMove: vi.fn().mockReturnValue(true),
    selectBlindSquares: vi.fn().mockReturnValue([]),
    buildBlindFen: vi.fn().mockReturnValue('4k3/8/8/8/8/8/8/4K3 b - - 0 1'),
    isBlindFenSearchSafe: vi.fn().mockReturnValue(true),
    getGameStatus() {
      return { over: false, result: null, reason: null, check: false };
    },
    getMoveHistory() {
      return history;
    }
  };
}

vi.mock('../src/blunder-smoother.js', () => ({
  createBlunderDecisionSmoother: vi.fn(() => ({
    next: vi.fn(() => false),
    reset: vi.fn()
  }))
}));

vi.mock('../src/engine.js', () => ({
  createEngine: createEngineMock
}));

vi.mock('../src/board.js', () => ({
  createBoard: vi.fn(({ onHumanMoveAttempt }) => {
    boardController.onHumanMoveAttempt = onHumanMoveAttempt;
    return boardMock;
  })
}));

vi.mock('../src/game.js', () => ({
  createGame: vi.fn(() => createGameDouble())
}));

vi.mock('../src/blindfish.js', () => ({
  chooseBlindfishMoveWithRetries: vi.fn()
}));

function loadIndexDom() {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const body = html.match(/<body>([\s\S]*)<\/body>/i)?.[1] || '';
  document.body.innerHTML = body;
}

async function flushUi() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('rampfish integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    boardController.onHumanMoveAttempt = null;
    createEngineMock.mockImplementation(() => engineMock);

    loadIndexDom();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      })
    });
  });

  test('shows rampfish setup controls with expected defaults', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-rampfish-btn').click();

    expect(document.querySelector('#setup-title').textContent).toBe('Rampfish Settings');
    expect(document.querySelector('#setup-rampfish-settings').hidden).toBe(false);
    expect(document.querySelector('#setup-rampfish-start-elo').value).toBe('1100');
    expect(document.querySelector('#setup-rampfish-end-elo').value).toBe('1900');
    expect(document.querySelector('#setup-rampfish-turn-n').value).toBe('20');
  });

  test('removes non-rampfish Maia controls and forces Maia provider in rampfish mode', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-rampfish-btn').click();
    expect(document.querySelector('#setup-opponent-engine-settings')).toBeNull();
    expect(document.querySelector('#setup-maia-settings')).toBeNull();

    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(createEngineMock).toHaveBeenCalledWith({
      provider: 'maia',
      maiaDifficulty: 1100
    });
  });

  test('advances Maia Elo over AI turns using configured ramp', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-rampfish-btn').click();
    document.querySelector('#setup-rampfish-start-elo').value = '1100';
    document.querySelector('#setup-rampfish-end-elo').value = '1900';
    document.querySelector('#setup-rampfish-turn-n').value = '3';
    document.querySelector('#setup-color-select').value = 'w';

    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(engineMock.setMaiaDifficulty).toHaveBeenCalledWith(1100);

    await boardController.onHumanMoveAttempt({ from: 'a2', to: 'a3' });
    await flushUi();
    await flushUi();
    expect(engineMock.setMaiaDifficulty).toHaveBeenLastCalledWith(1500);

    await boardController.onHumanMoveAttempt({ from: 'b2', to: 'b3' });
    await flushUi();
    await flushUi();
    expect(engineMock.setMaiaDifficulty).toHaveBeenLastCalledWith(1900);
  });
});
