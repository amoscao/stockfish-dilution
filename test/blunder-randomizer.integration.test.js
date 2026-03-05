// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const smootherMock = vi.hoisted(() => ({
  next: vi.fn(() => false),
  reset: vi.fn()
}));

const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  setSkillLevel: vi.fn().mockResolvedValue(undefined),
  setMaiaDifficulty: vi.fn().mockResolvedValue(undefined),
  newGame: vi.fn().mockResolvedValue(undefined),
  getBestMove: vi.fn().mockResolvedValue({ from: 'a7', to: 'a6' }),
  analyzePosition: vi.fn().mockResolvedValue({ type: 'cp', value: 0 }),
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
    getAllLegalMoves: vi.fn().mockReturnValue([{ from: 'a7', to: 'a6' }]),
    applyMove() {
      history.push('a6');
      turn = turn === 'w' ? 'b' : 'w';
      return { ok: true };
    },
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
  createBlunderDecisionSmoother: vi.fn(() => smootherMock)
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

describe('blunder randomizer integration', () => {
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  test('uses smoother decisions on engine turns', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(smootherMock.next).toHaveBeenCalled();
  });

  test('resets smoother when slider changes and on new game', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const resetsAfterBoot = smootherMock.reset.mock.calls.length;

    const slider = document.querySelector('#blunder-slider');
    slider.value = '33';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(smootherMock.reset.mock.calls.length).toBe(resetsAfterBoot + 1);

    document.querySelector('#new-game-btn').click();
    await flushUi();
    await flushUi();
    document.querySelector('#new-game-btn').click();
    await flushUi();
    expect(smootherMock.reset.mock.calls.length).toBe(resetsAfterBoot + 2);
  });

  test('eval bar is visible by default and requests eval analysis', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const evalWrap = document.querySelector('#eval-bar-wrap');
    expect(evalWrap.hidden).toBe(false);
    expect(engineMock.analyzePosition).toHaveBeenCalled();
    expect(document.querySelector('#eval-bar-label').textContent).toBe('+0.00');
  });

  test('exports current FEN to clipboard', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const exportBtn = document.querySelector('#export-fen-btn');
    exportBtn.click();
    await flushUi();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '4k3/8/8/8/8/8/8/4K3 b - - 0 1'
    );
    expect(document.querySelector('#status-text').textContent).toContain('FEN copied');
  });

  test('eval bar shows human-perspective sign when player is white (engine black)', async () => {
    engineMock.analyzePosition.mockResolvedValue({ type: 'cp', value: 120 });
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    const colorSelect = document.querySelector('#setup-color-select');
    colorSelect.value = 'w';
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const evalToggle = document.querySelector('#show-eval-bar');
    evalToggle.checked = true;
    evalToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await flushUi();
    await flushUi();

    expect(document.querySelector('#eval-bar-label').textContent).toBe('-1.20');
  });

  test('eval bar shows white-perspective sign when player is black (engine white)', async () => {
    engineMock.analyzePosition.mockResolvedValue({ type: 'cp', value: 120 });
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    const colorSelect = document.querySelector('#setup-color-select');
    colorSelect.value = 'b';
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const evalToggle = document.querySelector('#show-eval-bar');
    evalToggle.checked = true;
    evalToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await flushUi();
    await flushUi();

    expect(document.querySelector('#eval-bar-label').textContent).toBe('+1.20');
  });

  test('eval bar label should be positive when human (black) is winning', async () => {
    engineMock.analyzePosition.mockResolvedValue({ type: 'cp', value: 120 });
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    const colorSelect = document.querySelector('#setup-color-select');
    colorSelect.value = 'b';
    colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    expect(document.querySelector('#eval-bar-label').textContent).toBe('+1.20');
  });

  test('blunderfish always uses stockfish and hides current Maia ELO', async () => {
    await import('../src/main.js');

    document.querySelector('#mode-blunderfish-btn').click();
    document.querySelector('#setup-start-btn').click();
    await flushUi();
    await flushUi();

    const engineModule = await import('../src/engine.js');
    expect(engineModule.createEngine).toHaveBeenCalledWith({
      provider: 'stockfish',
      maiaDifficulty: 1100
    });
    expect(document.querySelector('#current-maia-elo-row').hidden).toBe(true);
  });
});
