const MAIA_DIFFICULTIES = Object.freeze([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]);
const DEFAULT_MAIA_DIFFICULTY = 1500;
const MAIA_VERSION = 'maia2rapid';
const MAIA_API_TIMEOUT_MS = 4000;
const MAIA_API_RETRY_COUNT = 1;

export class MaiaRequestExhaustedError extends Error {
  constructor({ attempts, cause }) {
    super(`Maia request failed after ${attempts} attempts`);
    this.name = 'MaiaRequestExhaustedError';
    this.attempts = attempts;
    this.cause = cause;
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
    return null;
  }

  const allowed = new Set();
  for (const move of searchMoves) {
    const uci = moveToUci(move);
    if (uci) {
      allowed.add(uci);
    }
  }

  return allowed.size > 0 ? allowed : null;
}

function normalizeMultiPv(value, fallback = 8) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function clampMaiaDifficulty(elo) {
  const parsed = Number(elo);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAIA_DIFFICULTY;
  }

  let nearest = MAIA_DIFFICULTIES[0];
  let nearestDistance = Math.abs(parsed - nearest);
  for (let i = 1; i < MAIA_DIFFICULTIES.length; i += 1) {
    const candidate = MAIA_DIFFICULTIES[i];
    const distance = Math.abs(parsed - candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function maiaNameForDifficulty(elo) {
  return `maia_kdd_${clampMaiaDifficulty(elo)}`;
}

function createTaskQueue() {
  let chain = Promise.resolve();

  function enqueue(operation) {
    const next = chain.then(() => operation());
    chain = next.catch(() => {});
    return next;
  }

  return { enqueue };
}

function buildApiPath(endpoint, queryEntries = []) {
  const params = new URLSearchParams();
  for (const [key, value] of queryEntries) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params.set(key, String(value));
  }

  const querySuffix = params.toString();
  const basePath = `${import.meta.env.BASE_URL}api/v1/play/${endpoint}`;
  return querySuffix ? `${basePath}?${querySuffix}` : basePath;
}

async function readJsonResponse(response, contextLabel) {
  const text = await response.text();
  let json;

  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${contextLabel} returned invalid JSON: ${detail}`);
  }

  if (!response.ok) {
    const compactBody = typeof text === 'string' ? text.slice(0, 200) : '';
    throw new Error(`${contextLabel} failed (HTTP ${response.status}): ${compactBody}`);
  }

  return json;
}

function isAbortError(error) {
  return error instanceof Error && error.name === 'AbortError';
}

function makeTimeoutError(timeoutMs) {
  return new Error(`Maia get_move API timed out after ${timeoutMs}ms`);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw makeTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

class MaiaApiClient {
  constructor({ difficultyElo }) {
    this.difficultyElo = clampMaiaDifficulty(difficultyElo);
    this.queue = createTaskQueue();
    this.terminated = false;
  }

  setDifficultyElo(difficultyElo) {
    this.difficultyElo = clampMaiaDifficulty(difficultyElo);
  }

  ensureActive() {
    if (this.terminated) {
      throw new Error('Maia client has been terminated');
    }
  }

  async requestTopMoveUci({ fen, piece = null }) {
    const maiaName = maiaNameForDifficulty(this.difficultyElo);
    const maxAttempts = MAIA_API_RETRY_COUNT + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          buildApiPath('get_move', [
            ['fen', fen],
            ['maia_name', maiaName],
            ['maia_version', MAIA_VERSION],
            ['piece', piece],
            ['initial_clock', 0],
            ['current_clock', 0]
          ]),
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify([])
          },
          MAIA_API_TIMEOUT_MS
        );
        const data = await readJsonResponse(response, 'Maia get_move API');
        const topMove = typeof data?.top_move === 'string' ? data.top_move : null;
        if (!topMove) {
          throw new Error('Maia get_move API returned no top_move');
        }
        return topMove;
      } catch (error) {
        lastError = error;
      }
    }

    throw new MaiaRequestExhaustedError({
      attempts: maxAttempts,
      cause: lastError
    });
  }

  async init() {
    return this.queue.enqueue(async () => {
      this.ensureActive();
    });
  }

  async newGame() {
    return this.queue.enqueue(async () => {
      this.ensureActive();
    });
  }

  async getBestMove(fen) {
    return this.queue.enqueue(async () => {
      this.ensureActive();
      const topMoveUci = await this.requestTopMoveUci({ fen });
      const move = parseUciMoveToken(topMoveUci);
      if (!move) {
        throw new Error(`Unable to parse Maia top_move: ${topMoveUci}`);
      }
      return move;
    });
  }

  async resolveRankedMoves(fen, { multiPv = 8, searchMoves = [] } = {}) {
    const allowed = normalizeSearchMoves(searchMoves);
    const topMoveUci = await this.requestTopMoveUci({ fen });
    const topMove = parseUciMoveToken(topMoveUci);
    if (!topMove) {
      throw new Error(`Unable to parse Maia top_move: ${topMoveUci}`);
    }

    if (allowed === null) {
      return [topMove].slice(0, normalizeMultiPv(multiPv));
    }

    const topMoveKey = moveToUci(topMove);
    if (topMoveKey && allowed.has(topMoveKey)) {
      return [topMove].slice(0, normalizeMultiPv(multiPv));
    }

    for (const uci of allowed) {
      const candidate = parseUciMoveToken(uci);
      if (candidate) {
        return [candidate].slice(0, normalizeMultiPv(multiPv));
      }
    }

    return [];
  }

  async getRankedMoves(fen, { multiPv = 8, searchMoves = [] } = {}) {
    return this.queue.enqueue(async () => {
      this.ensureActive();
      return this.resolveRankedMoves(fen, { multiPv, searchMoves });
    });
  }

  async getRankedMovesWithScores(fen, { multiPv = 8, searchMoves = [] } = {}) {
    return this.queue.enqueue(async () => {
      this.ensureActive();
      const rankedMoves = await this.resolveRankedMoves(fen, { multiPv, searchMoves });
      return rankedMoves.map((move, index) => ({
        rank: index + 1,
        move,
        score: null
      }));
    });
  }

  terminate() {
    this.terminated = true;
  }
}

export function createMaiaOpponentClient({ difficultyElo = DEFAULT_MAIA_DIFFICULTY } = {}) {
  const maia = new MaiaApiClient({ difficultyElo });

  return {
    init: () => maia.init(),
    newGame: () => maia.newGame(),
    getBestMove: (fen) => maia.getBestMove(fen),
    getRankedMoves: (fen, options) => maia.getRankedMoves(fen, options),
    getRankedMovesWithScores: (fen, options) => maia.getRankedMovesWithScores(fen, options),
    setDifficultyElo: (nextDifficulty) => maia.setDifficultyElo(nextDifficulty),
    terminate: () => maia.terminate()
  };
}
