import { MaiaRequestExhaustedError, createMaiaOpponentClient } from './maia-opponent.js';

const DEFAULT_TIMEOUT_MS = 20000;

export class EngineTaskCanceledError extends Error {
  constructor(reason = 'canceled') {
    super(`Engine task canceled: ${reason}`);
    this.name = 'EngineTaskCanceledError';
    this.reason = reason;
  }
}

function parseUciMoveToken(token) {
  if (!token || token === '(none)' || token.length < 4) {
    return null;
  }

  const from = token.slice(0, 2);
  const to = token.slice(2, 4);
  const promotion = token.length > 4 ? token[4] : undefined;
  return { from, to, promotion };
}

export function parseBestMoveLine(line) {
  if (!line || !line.startsWith('bestmove ')) {
    return null;
  }

  const best = line.split(' ')[1];
  return parseUciMoveToken(best);
}

function parseInfoScoreLine(line) {
  if (!line || !line.startsWith('info ')) {
    return null;
  }

  const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)\b/);
  if (!match) {
    return null;
  }

  return {
    type: match[1],
    value: Number(match[2])
  };
}

function parseInfoMultiPvRank(line) {
  if (!line || !line.startsWith('info ')) {
    return null;
  }

  const match = line.match(/\bmultipv\s+(\d+)\b/);
  if (!match) {
    return null;
  }

  return Number(match[1]);
}

export function parseInfoMultiPvLine(line) {
  if (!line || !line.startsWith('info ')) {
    return null;
  }

  const rankMatch = line.match(/\bmultipv\s+(\d+)\b/);
  const pvMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)\b/i);

  if (!rankMatch || !pvMatch) {
    return null;
  }

  const move = parseUciMoveToken(pvMatch[1]);
  if (!move) {
    return null;
  }

  return {
    rank: Number(rankMatch[1]),
    move,
    score: parseInfoScoreLine(line)
  };
}

function moveKey(move) {
  return `${move.from}${move.to}${move.promotion || ''}`;
}

function moveToUci(move) {
  if (!move || typeof move.from !== 'string' || typeof move.to !== 'string') {
    return null;
  }
  if (move.from.length !== 2 || move.to.length !== 2) {
    return null;
  }
  const promotion = typeof move.promotion === 'string' ? move.promotion : '';
  return `${move.from}${move.to}${promotion}`;
}

function normalizeSearchMoves(searchMoves) {
  if (!Array.isArray(searchMoves)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();
  for (const move of searchMoves) {
    const uci = moveToUci(move);
    if (!uci || seen.has(uci)) {
      continue;
    }
    seen.add(uci);
    normalized.push(uci);
  }

  return normalized;
}

export function rankAndDedupeMoves(entries) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  const result = [];

  for (const entry of sorted) {
    const key = moveKey(entry.move);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry.move);
  }

  return result;
}

export function rankAndDedupeMoveEntries(entries) {
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  const result = [];

  for (const entry of sorted) {
    const key = moveKey(entry.move);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }

  return result;
}

function clampSkillLevel(level) {
  const parsed = Number(level);
  if (!Number.isFinite(parsed)) {
    return 20;
  }
  return Math.max(0, Math.min(20, Math.round(parsed)));
}

function normalizeBestMoveSearchOptions(search) {
  if (typeof search === 'number') {
    return { movetimeMs: search, depth: null, legacyMovetime: true };
  }

  if (!search || typeof search !== 'object') {
    return { movetimeMs: 1500, depth: null, legacyMovetime: false };
  }

  const movetimeMs =
    Number.isFinite(Number(search.movetimeMs)) && Number(search.movetimeMs) > 0
      ? Math.round(Number(search.movetimeMs))
      : 1500;
  const depthRaw = Number(search.depth);
  const depth = Number.isFinite(depthRaw) && depthRaw > 0 ? Math.round(depthRaw) : null;

  return { movetimeMs, depth, legacyMovetime: false };
}

function createUciWorkerClient({ workerUrl }) {
  const worker = new Worker(workerUrl);
  let pendingResolvers = [];
  let queuedTasks = [];
  let activeTask = null;
  let terminated = false;
  let appliedSkillLevel = null;

  worker.addEventListener('message', (event) => {
    const line = String(event.data || '');

    const nextPendingResolvers = [];
    for (const entry of pendingResolvers) {
      if (entry.onLine) {
        entry.onLine(line);
      }
      if (entry.predicate(line)) {
        entry.resolve(line);
      } else {
        nextPendingResolvers.push(entry);
      }
    }

    pendingResolvers = nextPendingResolvers;
  });

  function send(command) {
    if (terminated) {
      throw new EngineTaskCanceledError('terminated');
    }
    worker.postMessage(command);
  }

  function waitForLine(predicate, timeoutMs = DEFAULT_TIMEOUT_MS, onLine = null) {
    if (terminated) {
      return Promise.reject(new EngineTaskCanceledError('terminated'));
    }

    return new Promise((resolve, reject) => {
      const resolverEntry = {
        predicate,
        onLine,
        timeout: null,
        resolve: (line) => {
          clearTimeout(resolverEntry.timeout);
          resolve(line);
        },
        reject: (error) => {
          clearTimeout(resolverEntry.timeout);
          reject(error);
        }
      };

      resolverEntry.timeout = setTimeout(() => {
        pendingResolvers = pendingResolvers.filter((entry) => entry !== resolverEntry);
        reject(new Error('Stockfish response timeout'));
      }, timeoutMs);

      pendingResolvers.push(resolverEntry);
    });
  }

  function rejectPendingResolvers(error) {
    for (const resolver of pendingResolvers) {
      resolver.reject(error);
    }
    pendingResolvers = [];
  }

  function processTaskQueue() {
    if (activeTask || queuedTasks.length === 0 || terminated) {
      return;
    }

    const task = queuedTasks.shift();
    activeTask = task;

    let operationPromise;
    try {
      operationPromise = Promise.resolve(task.operation());
    } catch (error) {
      task.reject(error);
      activeTask = null;
      processTaskQueue();
      return;
    }

    operationPromise
      .then((value) => {
        task.resolve(value);
      })
      .catch((error) => {
        task.reject(error);
      })
      .finally(() => {
        if (activeTask === task) {
          activeTask = null;
        }
        processTaskQueue();
      });
  }

  function enqueueTask(operation) {
    if (terminated) {
      return Promise.reject(new EngineTaskCanceledError('terminated'));
    }

    return new Promise((resolve, reject) => {
      queuedTasks.push({ operation, resolve, reject });
      processTaskQueue();
    });
  }

  function flush(reason = 'flushed', { cancelActive = false } = {}) {
    const error = new EngineTaskCanceledError(reason);
    for (const task of queuedTasks) {
      task.reject(error);
    }
    queuedTasks = [];

    if (!cancelActive || !activeTask) {
      return;
    }

    if (!terminated) {
      worker.postMessage('stop');
    }
    rejectPendingResolvers(error);
    const canceledTask = activeTask;
    activeTask = null;
    canceledTask.reject(error);
    processTaskQueue();
  }

  function terminate() {
    if (terminated) {
      return;
    }

    terminated = true;
    const error = new EngineTaskCanceledError('terminated');
    flush('terminated');
    rejectPendingResolvers(error);

    if (activeTask) {
      activeTask.reject(error);
      activeTask = null;
    }

    worker.terminate();
  }

  async function init() {
    return enqueueTask(async () => {
      send('uci');
      await waitForLine((line) => line === 'uciok');

      send('isready');
      await waitForLine((line) => line === 'readyok');
    });
  }

  async function setSkillLevel(level = 20) {
    return enqueueTask(async () => {
      const clampedLevel = clampSkillLevel(level);
      if (appliedSkillLevel === clampedLevel) {
        return;
      }

      send(`setoption name Skill Level value ${clampedLevel}`);
      send('isready');
      await waitForLine((line) => line === 'readyok');
      appliedSkillLevel = clampedLevel;
    });
  }

  async function newGame() {
    return enqueueTask(async () => {
      send('ucinewgame');
      send('isready');
      await waitForLine((line) => line === 'readyok');
    });
  }

  async function getBestMove(fen, search = 1500) {
    return enqueueTask(async () => {
      const options = normalizeBestMoveSearchOptions(search);
      send(`position fen ${fen}`);
      if (options.depth !== null && !options.legacyMovetime) {
        send(`go depth ${options.depth} movetime ${options.movetimeMs}`);
      } else {
        send(`go movetime ${options.movetimeMs}`);
      }

      const bestMoveLine = await waitForLine((line) => line.startsWith('bestmove '));
      const move = parseBestMoveLine(bestMoveLine);

      if (!move) {
        throw new Error(`Unable to parse engine best move: ${bestMoveLine}`);
      }

      return move;
    });
  }

  async function getRankedMovesWithScores(
    fen,
    { movetimeMs = 1500, multiPv = 8, depth = null, searchMoves = [] } = {}
  ) {
    return enqueueTask(async () => {
      const requestedMultiPv = Math.max(1, Math.floor(multiPv));
      const requestedDepth =
        Number.isFinite(Number(depth)) && Number(depth) > 0 ? Math.floor(Number(depth)) : null;
      const requestedSearchMoves = normalizeSearchMoves(searchMoves);
      const rankedBySlot = new Map();

      send(`setoption name MultiPV value ${requestedMultiPv}`);
      send(`position fen ${fen}`);
      const searchmovesSuffix =
        requestedSearchMoves.length > 0 ? ` searchmoves ${requestedSearchMoves.join(' ')}` : '';
      if (requestedDepth !== null) {
        send(`go depth ${requestedDepth} movetime ${movetimeMs}${searchmovesSuffix}`);
      } else {
        send(`go movetime ${movetimeMs}${searchmovesSuffix}`);
      }

      const bestMoveLine = await waitForLine(
        (line) => line.startsWith('bestmove '),
        DEFAULT_TIMEOUT_MS,
        (line) => {
          const parsed = parseInfoMultiPvLine(line);
          if (parsed) {
            rankedBySlot.set(parsed.rank, parsed);
          }
        }
      );

      const bestMove = parseBestMoveLine(bestMoveLine);
      if (bestMove && !rankedBySlot.has(1)) {
        rankedBySlot.set(1, {
          rank: 1,
          move: bestMove,
          score: null
        });
      }

      const entries = Array.from(rankedBySlot.values());
      return rankAndDedupeMoveEntries(entries);
    });
  }

  async function getRankedMoves(fen, options = {}) {
    const entries = await getRankedMovesWithScores(fen, options);
    return entries.map((entry) => entry.move);
  }

  async function analyzePosition(fen, movetimeMs = 1500) {
    return enqueueTask(async () => {
      let latestScore = null;

      send(`position fen ${fen}`);
      send(`go movetime ${movetimeMs}`);
      await waitForLine(
        (line) => line.startsWith('bestmove '),
        DEFAULT_TIMEOUT_MS,
        (line) => {
          const score = parseInfoScoreLine(line);
          if (score) {
            const multipvRank = parseInfoMultiPvRank(line);
            if (multipvRank === null || multipvRank === 1) {
              latestScore = score;
            }
          }
        }
      );

      if (!latestScore) {
        throw new Error('Unable to parse engine score from analysis');
      }

      return latestScore;
    });
  }

  return {
    init,
    setSkillLevel,
    newGame,
    getBestMove,
    getRankedMoves,
    getRankedMovesWithScores,
    analyzePosition,
    flush,
    terminate
  };
}

export function createEngine({ provider = 'stockfish', maiaDifficulty = 1500 } = {}) {
  const workerUrl = `${import.meta.env.BASE_URL}stockfish/stockfish.wasm.js`;

  if (provider === 'maia') {
    const maiaClient = createMaiaOpponentClient({ difficultyElo: maiaDifficulty });
    let analysisClient = null;
    let fallbackPlayClient = null;
    let analysisInitPromise = null;
    let fallbackPlayInitPromise = null;
    let configuredSkillLevel = 20;

    function getAnalysisClient() {
      if (!analysisClient) {
        analysisClient = createUciWorkerClient({ workerUrl });
      }
      return analysisClient;
    }

    function getFallbackPlayClient() {
      if (!fallbackPlayClient) {
        fallbackPlayClient = createUciWorkerClient({ workerUrl });
      }
      return fallbackPlayClient;
    }

    async function ensureAnalysisClientReady() {
      const client = getAnalysisClient();
      if (!analysisInitPromise) {
        analysisInitPromise = (async () => {
          await client.init();
          await client.setSkillLevel(configuredSkillLevel);
          return client;
        })().catch((error) => {
          analysisInitPromise = null;
          throw error;
        });
      }
      return analysisInitPromise;
    }

    async function ensureFallbackPlayClientReady() {
      const client = getFallbackPlayClient();
      if (!fallbackPlayInitPromise) {
        fallbackPlayInitPromise = (async () => {
          await client.init();
          await client.setSkillLevel(configuredSkillLevel);
          return client;
        })().catch((error) => {
          fallbackPlayInitPromise = null;
          throw error;
        });
      }
      return fallbackPlayInitPromise;
    }

    async function init() {
      await maiaClient.init();
    }

    async function setSkillLevel(level = 20) {
      configuredSkillLevel = clampSkillLevel(level);
      const tasks = [];

      if (analysisInitPromise) {
        tasks.push(ensureAnalysisClientReady().then((client) => client.setSkillLevel(configuredSkillLevel)));
      }

      if (fallbackPlayInitPromise) {
        tasks.push(
          ensureFallbackPlayClientReady().then((client) => client.setSkillLevel(configuredSkillLevel))
        );
      }

      await Promise.all(tasks);
    }

    async function newGame() {
      if (analysisInitPromise) {
        analysisClient.flush('new_game');
        void ensureAnalysisClientReady()
          .then((client) => client.newGame())
          .catch(() => {});
      }

      if (fallbackPlayInitPromise) {
        fallbackPlayClient.flush('new_game', { cancelActive: true });
        void ensureFallbackPlayClientReady()
          .then((client) => client.newGame())
          .catch(() => {});
      }

      await maiaClient.newGame();
    }

    function flushAnalysis(reason = 'flushed') {
      if (analysisClient) {
        analysisClient.flush(reason);
      }
    }

    function terminate() {
      if (analysisClient) {
        analysisClient.terminate();
        analysisClient = null;
      }
      if (fallbackPlayClient) {
        fallbackPlayClient.terminate();
        fallbackPlayClient = null;
      }
      analysisInitPromise = null;
      fallbackPlayInitPromise = null;
      maiaClient.terminate();
    }

    async function getBestMove(fen, search) {
      try {
        return await maiaClient.getBestMove(fen);
      } catch (error) {
        if (!(error instanceof MaiaRequestExhaustedError)) {
          throw error;
        }
        const fallbackClient = await ensureFallbackPlayClientReady();
        return fallbackClient.getBestMove(fen, search);
      }
    }

    return {
      init,
      setSkillLevel,
      setMaiaDifficulty: (elo) => Promise.resolve(maiaClient.setDifficultyElo(elo)),
      newGame,
      getBestMove,
      getRankedMoves: (fen, options) => maiaClient.getRankedMoves(fen, options),
      getRankedMovesWithScores: (fen, options) => maiaClient.getRankedMovesWithScores(fen, options),
      analyzePosition: async (fen, movetimeMs) => {
        const client = await ensureAnalysisClientReady();
        return client.analyzePosition(fen, movetimeMs);
      },
      flushAnalysis,
      terminate
    };
  }

  const playClient = createUciWorkerClient({ workerUrl });
  const analysisClient = createUciWorkerClient({ workerUrl });

  async function init() {
    await Promise.all([playClient.init(), analysisClient.init()]);
  }

  async function setSkillLevel(level = 20) {
    await Promise.all([playClient.setSkillLevel(level), analysisClient.setSkillLevel(level)]);
  }

  async function newGame() {
    analysisClient.flush('new_game');
    void analysisClient.newGame().catch(() => {});
    playClient.flush('new_game', { cancelActive: true });
    await playClient.newGame();
  }

  function flushAnalysis(reason = 'flushed') {
    analysisClient.flush(reason);
  }

  function terminate() {
    playClient.terminate();
    analysisClient.terminate();
  }

  return {
    init,
    setSkillLevel,
    setMaiaDifficulty: () => {},
    newGame,
    getBestMove: (fen, search) => playClient.getBestMove(fen, search),
    getRankedMoves: (fen, options) => playClient.getRankedMoves(fen, options),
    getRankedMovesWithScores: (fen, options) => playClient.getRankedMovesWithScores(fen, options),
    analyzePosition: (fen, movetimeMs) => analysisClient.analyzePosition(fen, movetimeMs),
    flushAnalysis,
    terminate
  };
}
