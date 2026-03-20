// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const gameState = vi.hoisted(() => ({
  status: { over: false, result: null, reason: null, check: false }
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
      return gameState.status;
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
  createBoard: vi.fn(() => boardMock)
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

describe('goatcounter mode start tracking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    engineMock.init.mockReset().mockResolvedValue(undefined);
    engineMock.setSkillLevel.mockReset().mockResolvedValue(undefined);
    engineMock.setMaiaDifficulty.mockReset().mockResolvedValue(undefined);
    engineMock.newGame.mockReset().mockResolvedValue(undefined);
    engineMock.getBestMove.mockReset().mockResolvedValue({ from: 'a7', to: 'a6' });
    engineMock.analyzePosition.mockReset().mockResolvedValue({ type: 'cp', value: 0 });
    engineMock.getRankedMovesWithScores.mockReset().mockResolvedValue([]);
    engineMock.getRankedMoves.mockReset().mockResolvedValue([]);
    engineMock.flushAnalysis.mockReset();
    engineMock.terminate.mockReset();
    createEngineMock.mockImplementation(() => engineMock);
    gameState.status = { over: false, result: null, reason: null, check: false };

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
    delete window.goatcounter;
  });

  test.each([
    ['#mode-blunderfish-btn', 'blunderfish'],
    ['#mode-blindfish-btn', 'blindfish'],
    ['#mode-clapbackfish-btn', 'clapbackfish'],
    ['#mode-rampfish-btn', 'rampfish']
  ])('starting %s sends one Goatcounter event for %s', async (buttonSelector, mode) => {
    const count = vi.fn();
    window.goatcounter = { count };

    await import('../src/main.js');

    document.querySelector(buttonSelector).click();
    expect(count).not.toHaveBeenCalled();

    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      path: `game-start-${mode}`,
      title: `Game started: ${mode}`,
      event: true
    });
  });

  test('starting a game still works when Goatcounter is unavailable', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(createEngineMock).toHaveBeenCalledWith({
      provider: 'stockfish',
      maiaDifficulty: 1100
    });
  });

  test('rematch start sends another Goatcounter event', async () => {
    const count = vi.fn();
    window.goatcounter = { count };

    await import('../src/main.js');

    document.querySelector('#mode-clapbackfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    document.querySelector('#game-result-rematch-btn').click();
    await flushUi();
    await flushUi();

    expect(count).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenNthCalledWith(1, {
      path: 'game-start-clapbackfish',
      title: 'Game started: clapbackfish',
      event: true
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      path: 'game-start-clapbackfish',
      title: 'Game started: clapbackfish',
      event: true
    });
  });

  test('failed startup does not send a Goatcounter event', async () => {
    const count = vi.fn();
    window.goatcounter = { count };
    engineMock.init.mockRejectedValueOnce(new Error('engine init failed'));

    await import('../src/main.js');

    document.querySelector('#mode-rampfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(count).not.toHaveBeenCalled();
    expect(document.querySelector('#status-text').textContent).toContain('Startup failed');
  });
});
