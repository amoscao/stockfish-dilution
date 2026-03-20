// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  setSkillLevel: vi.fn().mockResolvedValue(undefined),
  setMaiaDifficulty: vi.fn().mockResolvedValue(undefined),
  newGame: vi.fn().mockResolvedValue(undefined),
  getBestMove: vi.fn().mockResolvedValue({ from: 'a7', to: 'a6' }),
  analyzePosition: vi.fn().mockResolvedValue({ type: 'cp', value: 0 }),
  getRankedMovesWithScores: vi
    .fn()
    .mockResolvedValue([
      { rank: 1, move: { from: 'a7', to: 'a6' }, score: { type: 'cp', value: -1500 } },
      { rank: 2, move: { from: 'a7', to: 'a5' }, score: { type: 'cp', value: 200 } }
    ]),
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

const gameApplyMoveMock = vi.hoisted(() => vi.fn());

const gameConfig = vi.hoisted(() => ({
  legalMoves: [{ from: 'a7', to: 'a6' }]
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
    getAllLegalMoves: vi.fn(() => gameConfig.legalMoves),
    applyMove: gameApplyMoveMock.mockImplementation(() => {
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
  createEngine: vi.fn(() => engineMock)
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

describe('clapbackfish integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    gameApplyMoveMock.mockReset();
    gameConfig.legalMoves = [{ from: 'a7', to: 'a6' }];
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

  test('shows clapback setup and keeps rampfish-only controls hidden', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-clapbackfish-btn').click();

    expect(document.querySelector('#setup-rampfish-settings').hidden).toBe(true);
    expect(document.querySelector('#setup-subtitle').textContent).toBe(
      'Clapbackfish throws in the beginning then clap backs at the end.'
    );
  });

  test('first clapback engine turn uses max engine settings and target eval readout', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-clapbackfish-btn').click();
    const colorSelect = document.querySelector('#setup-color-select');
    colorSelect.value = 'w';
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(engineMock.setSkillLevel).toHaveBeenCalledWith(20);
    expect(engineMock.getRankedMovesWithScores).toHaveBeenCalledWith(
      '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
      { movetimeMs: 1500, multiPv: 1 }
    );

    expect(document.querySelector('#clapback-readonly-settings').hidden).toBe(false);
    expect(document.querySelector('#clapback-target-cp-value').textContent).toBe('White +20.00');
    expect(document.querySelector('#setting-label').hidden).toBe(true);
    expect(document.querySelector('#blunder-slider').parentElement.hidden).toBe(true);
    expect(document.querySelector('#reveal-blunders').parentElement.hidden).toBe(true);
    expect(document.querySelector('#show-eval-bar').parentElement.hidden).toBe(false);
  });

  test('selects move by engine-perspective score distance to target eval', async () => {
    gameConfig.legalMoves = [
      { from: 'a7', to: 'a6' },
      { from: 'a7', to: 'a5' }
    ];
    engineMock.getRankedMovesWithScores.mockResolvedValueOnce([
      { rank: 1, move: { from: 'a7', to: 'a6' }, score: { type: 'cp', value: -1800 } },
      { rank: 2, move: { from: 'a7', to: 'a5' }, score: { type: 'cp', value: -1950 } }
    ]);

    await import('../src/main.js');
    document.querySelector('#mode-clapbackfish-btn').click();
    const colorSelect = document.querySelector('#setup-color-select');
    colorSelect.value = 'w';
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(engineMock.getRankedMovesWithScores).toHaveBeenCalledWith(
      '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
      { movetimeMs: 1500, multiPv: 2 }
    );
    expect(gameApplyMoveMock).toHaveBeenCalledWith({ from: 'a7', to: 'a5' });
    expect(engineMock.getBestMove).not.toHaveBeenCalled();
  });

  test('starting clapbackfish should not reset blunderfish setup slider value', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    const blunderSlider = document.querySelector('#setup-blunder-slider');
    blunderSlider.value = '37';
    blunderSlider.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();

    document.querySelector('#mode-clapbackfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();

    document.querySelector('#mode-blunderfish-btn').click();
    expect(document.querySelector('#setup-blunder-slider').value).toBe('37');
  });
});
