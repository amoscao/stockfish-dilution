import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MaiaRequestExhaustedError, createMaiaOpponentClient } from '../src/maia-opponent.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function parseUrl(rawUrl) {
  return new URL(rawUrl, 'http://localhost/');
}

function abortError() {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

describe('maia opponent API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('getBestMove calls get_move with Maia-2 version only', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ top_move: 'e2e4', move_delay: 0 }));

    const client = createMaiaOpponentClient({ difficultyElo: 1900 });
    const move = await client.getBestMove(START_FEN);

    expect(move).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, options] = fetch.mock.calls[0];
    const parsed = parseUrl(url);
    expect(parsed.pathname).toContain('/api/v1/play/get_move');
    expect(parsed.searchParams.get('fen')).toBe(START_FEN);
    expect(parsed.searchParams.get('maia_name')).toBe('maia_kdd_1900');
    expect(parsed.searchParams.get('maia_version')).toBe('maia2rapid');
    expect(options.method).toBe('POST');
    expect(options.body).toBe('[]');
  });

  test('retries exactly once and succeeds on second attempt', async () => {
    fetch.mockRejectedValueOnce(new Error('network failure'));
    fetch.mockResolvedValueOnce(jsonResponse({ top_move: 'd2d4', move_delay: 0 }));

    const client = createMaiaOpponentClient({ difficultyElo: 1500 });
    const move = await client.getBestMove(START_FEN);

    expect(move).toEqual({ from: 'd2', to: 'd4', promotion: undefined });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of fetch.mock.calls) {
      expect(parseUrl(url).searchParams.get('maia_version')).toBe('maia2rapid');
    }
  });

  test('throws MaiaRequestExhaustedError after retry is exhausted', async () => {
    fetch.mockResolvedValue(jsonResponse({ detail: 'service unavailable' }, 503));

    const client = createMaiaOpponentClient({ difficultyElo: 1500 });
    await expect(client.getBestMove(START_FEN)).rejects.toMatchObject({
      name: 'MaiaRequestExhaustedError',
      attempts: 2
    });
  });

  test('timeout path retries once then fails with MaiaRequestExhaustedError', async () => {
    vi.useFakeTimers();

    fetch.mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(abortError());
        });
      });
    });

    const client = createMaiaOpponentClient({ difficultyElo: 1600 });
    const movePromise = client.getBestMove(START_FEN);
    const rejection = expect(movePromise).rejects.toBeInstanceOf(MaiaRequestExhaustedError);

    await vi.advanceTimersByTimeAsync(9000);

    await rejection;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('difficulty is clamped to nearest supported Elo', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ top_move: 'g1f3', move_delay: 0 }));

    const client = createMaiaOpponentClient({ difficultyElo: 1876 });
    await client.getBestMove(START_FEN);

    const [url] = fetch.mock.calls[0];
    const parsed = parseUrl(url);
    expect(parsed.searchParams.get('maia_name')).toBe('maia_kdd_1900');
  });
});
