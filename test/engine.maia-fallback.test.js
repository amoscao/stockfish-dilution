import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

class MockWorker {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.messages = [];
    this.listeners = [];
    this.terminated = false;
    MockWorker.instances.push(this);
  }

  postMessage(command) {
    this.messages.push(command);
  }

  addEventListener(type, listener) {
    if (type === 'message') {
      this.listeners.push(listener);
    }
  }

  emit(line) {
    for (const listener of this.listeners) {
      listener({ data: line });
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const maiaClientMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  newGame: vi.fn().mockResolvedValue(undefined),
  getBestMove: vi.fn(),
  getRankedMoves: vi.fn().mockResolvedValue([]),
  getRankedMovesWithScores: vi.fn().mockResolvedValue([]),
  setDifficultyElo: vi.fn(),
  terminate: vi.fn()
}));

vi.mock('../src/maia-opponent.js', () => {
  class MaiaRequestExhaustedError extends Error {
    constructor({ attempts, cause }) {
      super(`Maia request failed after ${attempts} attempts`);
      this.name = 'MaiaRequestExhaustedError';
      this.attempts = attempts;
      this.cause = cause;
    }
  }

  return {
    MaiaRequestExhaustedError,
    createMaiaOpponentClient: vi.fn(() => maiaClientMock)
  };
});

describe('engine maia fallback', () => {
  async function waitForMessages(worker, minimumCount) {
    for (let i = 0; i < 50; i += 1) {
      if (worker.messages.length >= minimumCount) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('falls back to stockfish move after Maia retry exhaustion', async () => {
    const { MaiaRequestExhaustedError } = await import('../src/maia-opponent.js');
    const { createEngine } = await import('../src/engine.js');
    maiaClientMock.getBestMove.mockRejectedValueOnce(
      new MaiaRequestExhaustedError({ attempts: 2, cause: new Error('timeout') })
    );

    const engine = createEngine({ provider: 'maia', maiaDifficulty: 1500 });
    await engine.init();
    expect(MockWorker.instances.length).toBe(0);

    const bestMovePromise = engine.getBestMove('fallback-fen', 250);
    await Promise.resolve();
    expect(MockWorker.instances.length).toBe(1);
    const fallbackPlayWorker = MockWorker.instances[0];
    expect(fallbackPlayWorker.messages).toEqual(['uci']);

    fallbackPlayWorker.emit('uciok');
    await Promise.resolve();
    expect(fallbackPlayWorker.messages).toEqual(['uci', 'isready']);

    fallbackPlayWorker.emit('readyok');
    await waitForMessages(fallbackPlayWorker, 4);
    expect(fallbackPlayWorker.messages).toEqual([
      'uci',
      'isready',
      'setoption name Skill Level value 20',
      'isready'
    ]);

    fallbackPlayWorker.emit('readyok');
    await waitForMessages(fallbackPlayWorker, 6);
    expect(fallbackPlayWorker.messages).toEqual([
      'uci',
      'isready',
      'setoption name Skill Level value 20',
      'isready',
      'position fen fallback-fen',
      'go movetime 250'
    ]);

    fallbackPlayWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(bestMovePromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });

  test('does not fallback for non-MaiaRequestExhaustedError failures', async () => {
    const { createEngine } = await import('../src/engine.js');
    maiaClientMock.getBestMove.mockRejectedValueOnce(new Error('bad payload'));

    const engine = createEngine({ provider: 'maia', maiaDifficulty: 1500 });
    await expect(engine.getBestMove('bad-fen', 250)).rejects.toThrow('bad payload');
    expect(MockWorker.instances.length).toBe(0);
  });
});
