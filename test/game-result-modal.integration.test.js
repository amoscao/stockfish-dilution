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
  analyzePosition: vi.fn().mockResolvedValue({ type: 'cp', value: 80 }),
  getRankedMoves: vi.fn().mockResolvedValue([]),
  getRankedMovesWithScores: vi.fn().mockResolvedValue([]),
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
    getFen: vi.fn(() => '4k3/8/8/8/8/8/8/4K3 b - - 0 1'),
    getTurn: vi.fn(() => turn),
    getHumanColor: vi.fn(() => humanColor),
    getPosition: vi.fn(() => ({
      e1: { color: 'w', type: 'k' },
      e8: { color: 'b', type: 'k' },
      a2: { color: 'w', type: 'p' },
      a7: { color: 'b', type: 'p' }
    })),
    getLegalMoves: vi.fn(() => []),
    getAllLegalMoves: vi.fn(() => [{ from: 'a7', to: 'a6' }]),
    applyMove: vi.fn(() => {
      history.push('a6');
      turn = turn === 'w' ? 'b' : 'w';
      return { ok: true };
    }),
    isLegalMove: vi.fn(() => true),
    selectBlindSquares: vi.fn(() => []),
    buildBlindFen: vi.fn(() => '4k3/8/8/8/8/8/8/4K3 b - - 0 1'),
    isBlindFenSearchSafe: vi.fn(() => true),
    getGameStatus: vi.fn(() => ({ over: false, result: null, reason: null, check: false })),
    getMoveHistory: vi.fn(() => history)
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

describe('game result modal integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
    if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
      window.HTMLDialogElement.prototype.showModal = function showModal() {
        this.open = true;
      };
    }
    if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.close) {
      window.HTMLDialogElement.prototype.close = function close() {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  test('forfeit opens modal with graph and button flips to New Game', async () => {
    await import('../src/main.js');
    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(document.querySelector('#new-game-btn').textContent).toBe('Forfeit');

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    expect(document.querySelector('#game-result-dialog').open).toBe(true);
    expect(document.querySelector('#game-result-title').textContent).toBe('You lost :(');
    expect(document.querySelector('#new-game-btn').textContent).toBe('New Game');
    expect(document.querySelector('#game-result-graph').innerHTML).toContain('polyline');
  });

  test('close button dismisses modal and rematch restores active game state', async () => {
    await import('../src/main.js');
    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();

    document.querySelector('#game-result-close-btn').click();
    expect(document.querySelector('#game-result-dialog').open).toBe(false);

    document.querySelector('#game-result-rematch-btn').click();
    await flushUi();
    await flushUi();
    expect(document.querySelector('#new-game-btn').textContent).toBe('Forfeit');
  });

  test('main menu button returns to mode select screen', async () => {
    await import('../src/main.js');
    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();

    expect(document.querySelector('#mode-select-screen').hidden).toBe(false);
    expect(document.querySelector('#game-app').classList.contains('app-hidden')).toBe(true);
  });

  test('lifecycle transitions flush analysis generation state', async () => {
    await import('../src/main.js');
    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('start_new_game');

    document.querySelector('#new-game-btn').click();
    await flushUi();
    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('forfeit');

    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();
    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('main_menu');
  });

  test('target eval line and legend appear only for clapbackfish', async () => {
    await import('../src/main.js');
    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    expect(document.querySelector('#game-result-target-line')).toBeNull();
    expect(document.querySelector('#game-result-target-legend')).toBeNull();

    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();
    document.querySelector('#mode-clapbackfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    expect(document.querySelector('#game-result-target-line')).not.toBeNull();
    expect(document.querySelector('#game-result-target-legend')?.textContent).toContain('Target Eval');
  });
});
