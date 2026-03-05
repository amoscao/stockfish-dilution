import { expect, test } from '@playwright/test';

async function movePlyCount(page) {
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

test('rampfish falls back to stockfish move after Maia timeout/retry exhaustion', async ({ page }) => {
  let getMoveCallCount = 0;

  await page.route('**/api/v1/play/get_move**', async (route) => {
    getMoveCallCount += 1;
    if (getMoveCallCount <= 2) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'forced failure for fallback test' })
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/?engineMovetimeMs=50');
  await page.getByRole('button', { name: 'Rampfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  await expect(page.locator('.topbar h1')).toHaveText('Rampfish');
  await expect(page.locator('#status-text')).toHaveText('You are White. Your Move.');

  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e4"]').click();

  await page.waitForFunction(() => {
    const dialog = document.querySelector('#game-result-dialog');
    if (dialog && dialog.hasAttribute('open')) {
      return true;
    }
    const status = (document.querySelector('#status-text')?.textContent || '').toLowerCase();
    return status.includes('your move');
  });

  await expect(page.locator('#status-text')).not.toContainText('Engine error:');
  expect(getMoveCallCount).toBe(2);
  await expect.poll(async () => movePlyCount(page)).toBe(2);
});
