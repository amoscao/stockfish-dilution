import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EngineTaskCanceledError, createEngine } from '../src/engine.js';

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

describe('engine worker integration', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createWithWorkers() {
    const engine = createEngine();
    expect(MockWorker.instances.length).toBe(2);
    const playWorker = MockWorker.instances[0];
    const analysisWorker = MockWorker.instances[1];
    return { engine, playWorker, analysisWorker };
  }

  test('init sends uci/isready on both workers and waits for acknowledgements', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const initPromise = engine.init();
    expect(playWorker.messages).toEqual(['uci']);
    expect(analysisWorker.messages).toEqual(['uci']);

    playWorker.emit('uciok');
    analysisWorker.emit('uciok');
    await Promise.resolve();

    expect(playWorker.messages).toEqual(['uci', 'isready']);
    expect(analysisWorker.messages).toEqual(['uci', 'isready']);

    playWorker.emit('readyok');
    analysisWorker.emit('readyok');
    await initPromise;
  });

  test('getBestMove sends position/go on play worker and parses response', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const movePromise = engine.getBestMove('test-fen', 321);
    expect(playWorker.messages).toEqual(['position fen test-fen', 'go movetime 321']);
    expect(analysisWorker.messages).toEqual([]);

    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(movePromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });

  test('analyzePosition runs on analysis worker and is independent from play worker', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const analysisPromise = engine.analyzePosition('analysis-fen', 350);
    expect(analysisWorker.messages).toEqual(['position fen analysis-fen', 'go movetime 350']);

    const bestMovePromise = engine.getBestMove('play-fen', 200);
    expect(playWorker.messages).toEqual(['position fen play-fen', 'go movetime 200']);

    playWorker.emit('bestmove g8f6 ponder e2e4');
    await expect(bestMovePromise).resolves.toEqual({ from: 'g8', to: 'f6', promotion: undefined });

    analysisWorker.emit('info depth 13 score cp 42 pv e2e4 e7e5');
    analysisWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(analysisPromise).resolves.toEqual({ type: 'cp', value: 42 });
  });

  test('getBestMove supports depth and movetime options object', async () => {
    const { engine, playWorker } = createWithWorkers();

    const movePromise = engine.getBestMove('test-fen', { movetimeMs: 250, depth: 9 });
    expect(playWorker.messages).toEqual(['position fen test-fen', 'go depth 9 movetime 250']);

    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(movePromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });

  test('getBestMove normalizes invalid object search options to safe defaults', async () => {
    const { engine, playWorker } = createWithWorkers();

    const movePromise = engine.getBestMove('bad-options-fen', {
      movetimeMs: 0,
      depth: -3
    });
    expect(playWorker.messages).toEqual(['position fen bad-options-fen', 'go movetime 1500']);

    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(movePromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });

  test('getBestMove legacy numeric mode preserves provided numeric movetime', async () => {
    const { engine, playWorker } = createWithWorkers();

    const zeroPromise = engine.getBestMove('legacy-zero', 0);
    expect(playWorker.messages).toEqual(['position fen legacy-zero', 'go movetime 0']);
    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(zeroPromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });

    const negativePromise = engine.getBestMove('legacy-negative', -50);
    expect(playWorker.messages).toEqual([
      'position fen legacy-zero',
      'go movetime 0',
      'position fen legacy-negative',
      'go movetime -50'
    ]);
    playWorker.emit('bestmove d2d4 ponder d7d5');
    await expect(negativePromise).resolves.toEqual({ from: 'd2', to: 'd4', promotion: undefined });
  });

  test('getRankedMoves uses multipv lines and fallback bestmove rank-1', async () => {
    const { engine, playWorker } = createWithWorkers();

    const movesPromise = engine.getRankedMoves('blind-fen', { movetimeMs: 200, multiPv: 4 });

    expect(playWorker.messages).toEqual([
      'setoption name MultiPV value 4',
      'position fen blind-fen',
      'go movetime 200'
    ]);

    playWorker.emit('info depth 15 multipv 2 score cp 10 pv d2d4 d7d5');
    playWorker.emit('info depth 15 multipv 3 score cp 8 pv g1f3 g8f6');
    playWorker.emit('bestmove e2e4 ponder e7e5');

    await expect(movesPromise).resolves.toEqual([
      { from: 'e2', to: 'e4', promotion: undefined },
      { from: 'd2', to: 'd4', promotion: undefined },
      { from: 'g1', to: 'f3', promotion: undefined }
    ]);
  });

  test('getRankedMoves supports optional depth constraint', async () => {
    const { engine, playWorker } = createWithWorkers();

    const movesPromise = engine.getRankedMoves('deep-fen', { movetimeMs: 200, multiPv: 2, depth: 11 });

    expect(playWorker.messages).toEqual([
      'setoption name MultiPV value 2',
      'position fen deep-fen',
      'go depth 11 movetime 200'
    ]);

    playWorker.emit('info depth 11 multipv 1 score cp 20 pv e2e4 e7e5');
    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(movesPromise).resolves.toEqual([{ from: 'e2', to: 'e4', promotion: undefined }]);
  });

  test('getRankedMovesWithScores supports restricting root moves via searchmoves', async () => {
    const { engine, playWorker } = createWithWorkers();
    const entriesPromise = engine.getRankedMovesWithScores('subset-fen', {
      movetimeMs: 180,
      multiPv: 2,
      depth: 8,
      searchMoves: [
        { from: 'a7', to: 'a6' },
        { from: 'a7', to: 'a5' }
      ]
    });

    expect(playWorker.messages).toEqual([
      'setoption name MultiPV value 2',
      'position fen subset-fen',
      'go depth 8 movetime 180 searchmoves a7a6 a7a5'
    ]);

    playWorker.emit('info depth 8 multipv 1 score cp 33 pv a7a6');
    playWorker.emit('info depth 8 multipv 2 score cp 20 pv a7a5');
    playWorker.emit('bestmove a7a6 ponder a2a3');
    await expect(entriesPromise).resolves.toEqual([
      {
        rank: 1,
        move: { from: 'a7', to: 'a6', promotion: undefined },
        score: { type: 'cp', value: 33 }
      },
      {
        rank: 2,
        move: { from: 'a7', to: 'a5', promotion: undefined },
        score: { type: 'cp', value: 20 }
      }
    ]);
  });

  test('getRankedMovesWithScores clamps invalid multipv and ignores invalid depth', async () => {
    const { engine, playWorker } = createWithWorkers();

    const entriesPromise = engine.getRankedMovesWithScores('normalized-fen', {
      movetimeMs: 120,
      multiPv: 0,
      depth: 'x'
    });

    expect(playWorker.messages).toEqual([
      'setoption name MultiPV value 1',
      'position fen normalized-fen',
      'go movetime 120'
    ]);

    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(entriesPromise).resolves.toEqual([
      {
        rank: 1,
        move: { from: 'e2', to: 'e4', promotion: undefined },
        score: null
      }
    ]);
  });

  test('getRankedMovesWithScores returns rank and cp score metadata', async () => {
    const { engine, playWorker } = createWithWorkers();

    const entriesPromise = engine.getRankedMovesWithScores('scored-fen', {
      movetimeMs: 200,
      multiPv: 2
    });

    playWorker.emit('info depth 16 multipv 2 score cp -45 pv d2d4 d7d5');
    playWorker.emit('bestmove e2e4 ponder e7e5');

    await expect(entriesPromise).resolves.toEqual([
      {
        rank: 1,
        move: { from: 'e2', to: 'e4', promotion: undefined },
        score: null
      },
      {
        rank: 2,
        move: { from: 'd2', to: 'd4', promotion: undefined },
        score: { type: 'cp', value: -45 }
      }
    ]);
  });

  test('analyzePosition should use multipv-1 score when MultiPV is enabled on analysis worker', async () => {
    const { engine, analysisWorker } = createWithWorkers();

    const analyzePromise = engine.analyzePosition('target-fen', 200);
    expect(analysisWorker.messages).toEqual(['position fen target-fen', 'go movetime 200']);

    analysisWorker.emit('info depth 14 multipv 1 score cp 35 pv d2d4 d7d5');
    analysisWorker.emit('info depth 14 multipv 2 score cp -460 pv a2a3 a7a6');
    analysisWorker.emit('bestmove d2d4 ponder d7d5');

    await expect(analyzePromise).resolves.toEqual({ type: 'cp', value: 35 });
  });

  test('times out when expected engine response does not arrive', async () => {
    vi.useFakeTimers();

    const { engine } = createWithWorkers();
    const bestMovePromise = engine.getBestMove('slow-fen', 100);
    const timeoutExpectation = expect(bestMovePromise).rejects.toThrow('Stockfish response timeout');

    await vi.advanceTimersByTimeAsync(20001);
    await timeoutExpectation;
  });

  test('concurrent bestmove requests on play worker are serialized', async () => {
    const { engine, playWorker } = createWithWorkers();

    const firstPromise = engine.getBestMove('fen-one', 200);
    const secondPromise = engine.getBestMove('fen-two', 200);

    expect(playWorker.messages).toEqual(['position fen fen-one', 'go movetime 200']);

    let secondSettled = false;
    secondPromise.finally(() => {
      secondSettled = true;
    });

    playWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(firstPromise).resolves.toEqual({ from: 'e2', to: 'e4', promotion: undefined });

    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(playWorker.messages).toEqual([
      'position fen fen-one',
      'go movetime 200',
      'position fen fen-two',
      'go movetime 200'
    ]);

    playWorker.emit('bestmove d2d4 ponder d7d5');
    await expect(secondPromise).resolves.toEqual({ from: 'd2', to: 'd4', promotion: undefined });
  });

  test('newGame cancels an in-flight play search and starts immediately', async () => {
    const { engine, playWorker } = createWithWorkers();

    const inFlightMove = engine.getBestMove('busy-fen', 200);
    expect(playWorker.messages).toEqual(['position fen busy-fen', 'go movetime 200']);

    const newGamePromise = engine.newGame();
    await Promise.resolve();

    expect(playWorker.messages).toEqual([
      'position fen busy-fen',
      'go movetime 200',
      'stop',
      'ucinewgame',
      'isready'
    ]);

    await expect(inFlightMove).rejects.toEqual(expect.objectContaining({
      name: 'EngineTaskCanceledError',
      reason: 'new_game'
    }));

    playWorker.emit('readyok');
    await expect(newGamePromise).resolves.toBeUndefined();
  });

  test('flushAnalysis rejects queued analysis tasks with cancellation error', async () => {
    const { engine, analysisWorker } = createWithWorkers();

    const first = engine.analyzePosition('fen-one', 200);
    const second = engine.analyzePosition('fen-two', 200);

    expect(analysisWorker.messages).toEqual(['position fen fen-one', 'go movetime 200']);
    engine.flushAnalysis('generation_changed');

    await expect(second).rejects.toEqual(expect.objectContaining({
      name: 'EngineTaskCanceledError',
      reason: 'generation_changed'
    }));

    analysisWorker.emit('info depth 10 score cp 12 pv e2e4 e7e5');
    analysisWorker.emit('bestmove e2e4 ponder e7e5');
    await expect(first).resolves.toEqual({ type: 'cp', value: 12 });
  });

  test('terminate rejects queued and in-flight tasks and terminates both workers', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const inFlight = engine.analyzePosition('fen-one', 200);
    const queued = engine.analyzePosition('fen-two', 200);

    engine.terminate();

    await expect(inFlight).rejects.toBeInstanceOf(EngineTaskCanceledError);
    await expect(queued).rejects.toBeInstanceOf(EngineTaskCanceledError);
    expect(playWorker.terminated).toBe(true);
    expect(analysisWorker.terminated).toBe(true);
  });

  test('setSkillLevel clamps values to valid range on both workers', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const lowPromise = engine.setSkillLevel(-9);
    expect(playWorker.messages).toEqual(['setoption name Skill Level value 0', 'isready']);
    expect(analysisWorker.messages).toEqual(['setoption name Skill Level value 0', 'isready']);
    playWorker.emit('readyok');
    analysisWorker.emit('readyok');
    await lowPromise;

    const highPromise = engine.setSkillLevel(99);
    expect(playWorker.messages).toEqual([
      'setoption name Skill Level value 0',
      'isready',
      'setoption name Skill Level value 20',
      'isready'
    ]);
    expect(analysisWorker.messages).toEqual([
      'setoption name Skill Level value 0',
      'isready',
      'setoption name Skill Level value 20',
      'isready'
    ]);
    playWorker.emit('readyok');
    analysisWorker.emit('readyok');
    await highPromise;
  });

  test('setSkillLevel skips duplicate values', async () => {
    const { engine, playWorker, analysisWorker } = createWithWorkers();

    const firstPromise = engine.setSkillLevel(10);
    expect(playWorker.messages).toEqual(['setoption name Skill Level value 10', 'isready']);
    expect(analysisWorker.messages).toEqual(['setoption name Skill Level value 10', 'isready']);
    playWorker.emit('readyok');
    analysisWorker.emit('readyok');
    await firstPromise;

    await engine.setSkillLevel(10);
    expect(playWorker.messages).toEqual(['setoption name Skill Level value 10', 'isready']);
    expect(analysisWorker.messages).toEqual(['setoption name Skill Level value 10', 'isready']);
  });
});
