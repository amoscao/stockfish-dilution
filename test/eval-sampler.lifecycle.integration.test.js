// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pendingAnalyze = vi.hoisted(() => []);

const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  setSkillLevel: vi.fn().mockResolvedValue(undefined),
  setMaiaDifficulty: vi.fn().mockResolvedValue(undefined),
  newGame: vi.fn().mockResolvedValue(undefined),
  getBestMove: vi.fn().mockResolvedValue({ from: 'a7', to: 'a6' }),
  analyzePosition: vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        pendingAnalyze.push(resolve);
      })
  ),
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

async function startAsWhiteAndWaitForPendingAnalysis() {
  document.querySelector('#mode-blunderfish-btn').click();
  const colorSelect = document.querySelector('#setup-color-select');
  colorSelect.value = 'w';
  colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#setup-start-btn').click();
  await flushUi();
  await flushUi();
  expect(pendingAnalyze.length).toBeGreaterThan(0);
}

describe('eval sampler lifecycle race safety', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    pendingAnalyze.length = 0;
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

  test('stale post-computer analysis is ignored after forfeit', async () => {
    await import('../src/main.js');
    await startAsWhiteAndWaitForPendingAnalysis();

    const staleResolve = pendingAnalyze.shift();
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');

    document.querySelector('#new-game-btn').click();
    await flushUi();
    const graphBefore = document.querySelector('#game-result-graph').innerHTML;

    staleResolve({ type: 'cp', value: 900 });
    await flushUi();
    await flushUi();

    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('forfeit');
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');
    expect(document.querySelector('#game-result-graph').innerHTML).toBe(graphBefore);
  });

  test('stale post-computer analysis is ignored after start_new_game', async () => {
    await import('../src/main.js');
    await startAsWhiteAndWaitForPendingAnalysis();

    const staleResolve = pendingAnalyze.shift();
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();

    staleResolve({ type: 'cp', value: 900 });
    await flushUi();
    await flushUi();

    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('start_new_game');
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');
  });

  test('stale post-computer analysis is ignored after main_menu', async () => {
    await import('../src/main.js');
    await startAsWhiteAndWaitForPendingAnalysis();

    const staleResolve = pendingAnalyze.shift();

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();
    const graphBefore = document.querySelector('#game-result-graph').innerHTML;

    document.querySelector('#game-result-main-menu-btn').click();
    await flushUi();

    staleResolve({ type: 'cp', value: 900 });
    await flushUi();
    await flushUi();

    expect(engineMock.flushAnalysis).toHaveBeenCalledWith('main_menu');
    expect(document.querySelector('#mode-select-screen').hidden).toBe(false);
    expect(document.querySelector('#game-result-graph').innerHTML).toBe(graphBefore);
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');
  });
});
