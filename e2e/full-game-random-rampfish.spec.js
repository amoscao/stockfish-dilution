import { expect, test } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:4174';

function shuffled(list) {
  const values = [...list];
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = values[i];
    values[i] = values[j];
    values[j] = tmp;
  }
  return values;
}

async function whitePieceSquares(page) {
  return page.$$eval('#board .square', (squares) => {
    const result = [];
    for (const square of squares) {
      const piece = square.querySelector('img.piece');
      const alt = piece?.getAttribute('alt') || '';
      if (alt.startsWith('white ')) {
        const id = square.getAttribute('data-square');
        if (id) {
          result.push(id);
        }
      }
    }
    return result;
  });
}

async function legalTargetSquares(page) {
  return page.$$eval('#board .square .legal-dot', (dots) => {
    const result = [];
    for (const dot of dots) {
      const square = dot.parentElement?.getAttribute('data-square');
      if (square) {
        result.push(square);
      }
    }
    return result;
  });
}

async function pickPromotionIfNeeded(page) {
  const promotionDialog = page.locator('#promotion-dialog');
  if (await promotionDialog.isVisible()) {
    await page.getByRole('button', { name: 'Queen' }).click();
  }
}

async function tryPlayRandomWhiteMove(page) {
  const fromSquares = shuffled(await whitePieceSquares(page));

  for (const from of fromSquares) {
    await page.locator(`[data-square="${from}"]`).click();
    const targets = await legalTargetSquares(page);

    if (targets.length === 0) {
      continue;
    }

    const to = targets[Math.floor(Math.random() * targets.length)];
    await page.locator(`[data-square="${to}"]`).click();
    await pickPromotionIfNeeded(page);
    return true;
  }

  return false;
}

test('plays a full random rampfish game and makes no external runtime requests', async ({ page }) => {
  test.setTimeout(420000);

  const externalRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return;
    }

    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }

    if (origin !== APP_ORIGIN) {
      externalRequests.push(url);
    }
  });

  await page.goto('/?engineMovetimeMs=50');
  await page.getByRole('button', { name: 'Rampfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const resultDialog = page.locator('#game-result-dialog');
  const moveRows = page.locator('#moves-body tr');

  await expect(page.locator('.topbar h1')).toHaveText('Rampfish');
  await expect(page.locator('#new-game-btn')).toHaveText('Forfeit', { timeout: 120000 });

  let humanMoves = 0;
  const maxHumanMoves = 280;

  while (!(await resultDialog.isVisible()) && humanMoves < maxHumanMoves) {
    const played = await tryPlayRandomWhiteMove(page);
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
  }

  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText(/You (won|lost :\()|Draw!/);
  await expect(page.locator('#new-game-btn')).toHaveText('New Game');
  await expect(moveRows).not.toHaveCount(0);

  const badDomainRequests = externalRequests.filter(
    (url) =>
      url.includes('githubusercontent') ||
      url.includes('jsdelivr') ||
      !url.startsWith(APP_ORIGIN)
  );
  expect(badDomainRequests).toEqual([]);
});
