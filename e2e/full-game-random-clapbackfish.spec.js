import { expect, test } from '@playwright/test';
import { Chess } from 'chess.js';

// NOTE: Both tests drive human moves from Maia-1900 so the spec has a
// deterministic opponent profile and no random move path.

const EVAL_LABEL_PATTERN = /[+-]\d+\.\d{2}|-?M\d+/;
const CLAPBACK_FINAL_MOVE = 40;
const CLAPBACK_TARGET_CP_MIN = -2000;
const CLAPBACK_TARGET_CP_MAX = 2000;
const GRAPH_PLOT_WIDTH = 596;
const GRAPH_PLOT_HEIGHT = 220;
const TARGET_ENGINE_TURNS_TO_PLAY = 40;
const MIN_ENGINE_TURNS_FOR_ASSERTION = 8;
const ALLOWED_MEAN_ABS_ERROR_CP = 2700;
const MAIA_HUMAN_NAME = 'maia_kdd_1900';
const MAIA_HUMAN_VERSION = 'maia2rapid';
const MIN_PLY_BEFORE_CHECKMATE_ALLOWED = 79;
const POST_ENGINE_SAMPLE_WAIT_MS = 450;
const FULL_TURNS_TO_IGNORE_FOR_MAE = 5;

function parseUciMove(uci) {
  if (!uci || typeof uci !== 'string' || uci.length < 4) {
    return null;
  }

  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined
  };
}

async function playMoveByUci(page, uci) {
  const move = parseUciMove(uci);
  if (!move) {
    return false;
  }

  try {
    await page.locator(`[data-square="${move.from}"]`).click();
    await page.locator(`[data-square="${move.to}"]`).click();

    const promotionDialog = page.locator('#promotion-dialog');
    if (await promotionDialog.isVisible()) {
      const promotionNameByPiece = {
        q: 'Queen',
        r: 'Rook',
        b: 'Bishop',
        n: 'Knight'
      };
      const promotionName = promotionNameByPiece[move.promotion] || 'Queen';
      await page.getByRole('button', { name: promotionName }).click();
    }
  } catch {
    return false;
  }

  return true;
}

async function fetchMaiaMoveForFen(request, fen) {
  const params = new URLSearchParams({
    fen,
    maia_name: MAIA_HUMAN_NAME,
    maia_version: MAIA_HUMAN_VERSION,
    initial_clock: '0',
    current_clock: '0'
  });
  const response = await request.post(`/api/v1/play/get_move?${params.toString()}`, {
    data: []
  });
  if (!response.ok()) {
    return null;
  }

  const data = await response.json();
  return typeof data?.top_move === 'string' ? data.top_move : null;
}

async function currentFenFromMovesTable(page) {
  const sanMoves = await page.$$eval('#moves-body tr', (rows) => {
    const moves = [];
    for (const row of rows) {
      const whiteMove = row.children[1]?.textContent?.trim() || '';
      const blackMove = row.children[2]?.textContent?.trim() || '';
      if (whiteMove) {
        moves.push(whiteMove);
      }
      if (blackMove) {
        moves.push(blackMove);
      }
    }
    return moves;
  });

  const chess = new Chess();
  for (const sanRaw of sanMoves) {
    const san = String(sanRaw).replace(/[🧠🎲]/g, '').trim();
    if (!san) {
      continue;
    }

    const applied = chess.move(san);
    if (!applied) {
      return null;
    }
  }

  return chess.fen();
}

async function tryPlayMaiaWhiteMove(page, request) {
  const fen = await currentFenFromMovesTable(page);
  if (!fen) {
    return false;
  }

  const topMove = await fetchMaiaMoveForFen(request, fen);
  if (!topMove) {
    return false;
  }

  return playMoveByUci(page, topMove);
}

async function getPlayedPly(page) {
  return page.$$eval('#moves-body tr', (rows) => {
    let count = 0;
    for (const row of rows) {
      const whiteMove = row.children[1]?.textContent?.trim() || '';
      const blackMove = row.children[2]?.textContent?.trim() || '';
      if (whiteMove) {
        count += 1;
      }
      if (blackMove) {
        count += 1;
      }
    }
    return count;
  });
}

async function collectClapbackTrajectoryStats(page, playedPly) {
  return page.evaluate(
    ({
      playedPly,
      finalMove,
      targetMinCp,
      targetMaxCp,
      plotWidth,
      plotHeight,
      ignoreFullTurns
    }) => {
      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function parsePoints(raw) {
        const source = String(raw || '').trim();
        if (!source) {
          return [];
        }
        return source
          .split(/\s+/)
          .map((pair) => {
            const [xRaw, yRaw] = pair.split(',');
            return { x: Number(xRaw), y: Number(yRaw) };
          })
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      }

      function expectedHumanTargetCp(engineTurnIndex) {
        const turn = Number(engineTurnIndex);
        if (!Number.isFinite(turn) || turn <= 1 || finalMove <= 1) {
          const progress = turn >= finalMove ? 1 : 0;
          const targetEngineCp = Math.round(
            targetMinCp + (targetMaxCp - targetMinCp) * progress
          );
          return -targetEngineCp;
        }

        const progress = turn >= finalMove ? 1 : (turn - 1) / (finalMove - 1);
        const targetEngineCp = Math.round(targetMinCp + (targetMaxCp - targetMinCp) * progress);
        return -targetEngineCp;
      }

      const graph = document.querySelector('#game-result-graph');
      const actualPolyline = graph?.querySelector('g[transform] polyline');
      if (!graph || !actualPolyline) {
        return null;
      }

      const labels = Array.from(graph.querySelectorAll('text'))
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
      let yMaxPawn = 0;
      for (const label of labels) {
        if (/^[+-]\d+\.\d{2}$/.test(label)) {
          yMaxPawn = Math.max(yMaxPawn, Math.abs(Number(label)));
        }
      }
      const yMaxCp = Math.round((yMaxPawn > 0 ? yMaxPawn : 20) * 100);
      const spanCp = yMaxCp * 2;

      const points = parsePoints(actualPolyline.getAttribute('points'));
      const byTurn = new Map();

      for (const point of points) {
        const ply = Math.round((point.x / plotWidth) * playedPly);
        if (!Number.isFinite(ply) || ply <= 0 || ply % 2 !== 0) {
          continue;
        }

        const engineTurnIndex = ply / 2;
        if (engineTurnIndex <= ignoreFullTurns) {
          continue;
        }

        const actualCp = yMaxCp - (point.y / plotHeight) * spanCp;
        const expectedCp = clamp(expectedHumanTargetCp(engineTurnIndex), -yMaxCp, yMaxCp);
        const errorCp = Math.abs(actualCp - expectedCp);

        const previous = byTurn.get(engineTurnIndex);
        if (!previous || errorCp < previous.errorCp) {
          byTurn.set(engineTurnIndex, {
            engineTurnIndex,
            ply,
            actualCp,
            expectedCp,
            errorCp
          });
        }
      }

      const samples = Array.from(byTurn.values()).sort(
        (a, b) => a.engineTurnIndex - b.engineTurnIndex
      );
      const meanAbsErrorCp =
        samples.length === 0
          ? Number.POSITIVE_INFINITY
          : samples.reduce((sum, sample) => sum + sample.errorCp, 0) / samples.length;
      const maxErrorCp =
        samples.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.max(...samples.map((sample) => sample.errorCp));

      return {
        sampleCount: samples.length,
        meanAbsErrorCp,
        maxErrorCp,
        samples
      };
    },
    {
      playedPly,
      finalMove: CLAPBACK_FINAL_MOVE,
      targetMinCp: CLAPBACK_TARGET_CP_MIN,
      targetMaxCp: CLAPBACK_TARGET_CP_MAX,
      plotWidth: GRAPH_PLOT_WIDTH,
      plotHeight: GRAPH_PLOT_HEIGHT,
      ignoreFullTurns: FULL_TURNS_TO_IGNORE_FOR_MAE
    }
  );
}

test('plays a full Maia-1900-vs-clapbackfish white game and reaches end-game modal', async ({
  page,
  request
}) => {
  test.setTimeout(120000);

  await page.goto('/?engineMovetimeMs=50');
  await page.getByRole('button', { name: 'Clapbackfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const resultDialog = page.locator('#game-result-dialog');
  const primaryBtn = page.locator('#new-game-btn');
  const moveRows = page.locator('#moves-body tr');

  await expect(page.locator('.topbar h1')).toHaveText('Clapbackfish');
  await expect(primaryBtn).toHaveText('Forfeit');
  await expect(page.locator('#eval-bar-wrap')).toBeVisible();
  await expect(page.locator('#eval-bar-label')).toHaveText(EVAL_LABEL_PATTERN);
  await expect(page.locator('#clapback-readonly-settings')).toBeVisible();

  let humanMoves = 0;
  const maxHumanMoves = 140;

  while (!(await resultDialog.isVisible()) && humanMoves < maxHumanMoves) {
    const played = await tryPlayMaiaWhiteMove(page, request);
    if (!played) {
      await page.waitForTimeout(80);
      continue;
    }

    humanMoves += 1;

    await expect(page.locator('#eval-bar-wrap')).toBeVisible();
    await expect(page.locator('#eval-bar-label')).toHaveText(EVAL_LABEL_PATTERN);

    await page.waitForFunction(() => {
      const dialog = document.querySelector('#game-result-dialog');
      if (dialog && dialog.hasAttribute('open')) {
        return true;
      }
      const status = (document.querySelector('#status-text')?.textContent || '').toLowerCase();
      return status.includes('your move');
    });
    await page.waitForTimeout(POST_ENGINE_SAMPLE_WAIT_MS);
  }

  if (!(await resultDialog.isVisible())) {
    await primaryBtn.click();
  }

  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText(/You (won|lost :\()|Draw!/);
  await expect(page.locator('#game-result-graph')).toBeVisible();
  await expect(page.locator('#new-game-btn')).toHaveText('New Game');
  await expect(moveRows).not.toHaveCount(0);
  const playedPly = await getPlayedPly(page);
  expect(playedPly).toBeGreaterThanOrEqual(40);
  await expect(page.locator('#game-result-target-line')).toHaveCount(1);
  await expect(page.locator('#game-result-target-legend')).toHaveCount(1);
});

test('maia-1900 human play stays near the clapback target eval trajectory with no early checkmate', async ({
  page,
  request
}) => {
  test.setTimeout(180000);

  await page.goto('/?engineMovetimeMs=80');
  await page.getByRole('button', { name: 'Clapbackfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const resultDialog = page.locator('#game-result-dialog');
  const primaryBtn = page.locator('#new-game-btn');

  await expect(page.locator('.topbar h1')).toHaveText('Clapbackfish');
  await expect(primaryBtn).toHaveText('Forfeit');

  let humanMoves = 0;
  while (!(await resultDialog.isVisible()) && humanMoves < TARGET_ENGINE_TURNS_TO_PLAY) {
    const played = await tryPlayMaiaWhiteMove(page, request);
    if (!played) {
      await page.waitForTimeout(80);
      continue;
    }

    humanMoves += 1;
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#game-result-dialog');
      if (dialog && dialog.hasAttribute('open')) {
        return true;
      }
      const status = (document.querySelector('#status-text')?.textContent || '').toLowerCase();
      return status.includes('your move');
    });
    await page.waitForTimeout(POST_ENGINE_SAMPLE_WAIT_MS);
  }

  if (!(await resultDialog.isVisible())) {
    await primaryBtn.click();
  }

  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-graph')).toBeVisible();
  await expect(page.locator('#game-result-target-line')).toHaveCount(1);
  await page.waitForTimeout(600);

  const playedPly = await getPlayedPly(page);
  const statusText = ((await page.locator('#status-text').textContent()) || '').toLowerCase();
  if (statusText.includes('checkmate')) {
    expect(playedPly).toBeGreaterThanOrEqual(MIN_PLY_BEFORE_CHECKMATE_ALLOWED);
  }

  const trajectory = await collectClapbackTrajectoryStats(page, playedPly);
  expect(playedPly).toBeGreaterThanOrEqual(MIN_ENGINE_TURNS_FOR_ASSERTION * 2);
  expect(trajectory).not.toBeNull();
  console.log(
    `[clapback-trajectory] sampleCount=${trajectory.sampleCount} meanAbsErrorCp=${trajectory.meanAbsErrorCp.toFixed(
      1
    )} maxErrorCp=${trajectory.maxErrorCp.toFixed(1)} playedPly=${playedPly} ignoredFullTurns=${FULL_TURNS_TO_IGNORE_FOR_MAE}`
  );
  expect(trajectory.meanAbsErrorCp).toBeLessThanOrEqual(ALLOWED_MEAN_ABS_ERROR_CP);
});
