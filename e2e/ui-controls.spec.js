import { expect, test } from '@playwright/test';

async function startBlunderfishAsWhite(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Blunderfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();
  await expect(page.locator('#game-app')).toBeVisible();
  await expect(page.locator('#new-game-btn')).toHaveText('Forfeit');
}

async function clickDialogButton(page, selector) {
  await page.evaluate((sel) => {
    const button = document.querySelector(sel);
    if (!button) {
      throw new Error(`Missing dialog button: ${sel}`);
    }
    button.click();
  }, selector);
}

test('flip board and export FEN work in active game', async ({ page }) => {
  await startBlunderfishAsWhite(page);

  const firstSquare = page.locator('#board .square').first();
  await expect(firstSquare).toHaveAttribute('data-square', 'a8');

  await page.locator('#flip-board-btn').click();
  await expect(firstSquare).toHaveAttribute('data-square', 'h1');

  await page.locator('#flip-board-btn').click();
  await expect(firstSquare).toHaveAttribute('data-square', 'a8');

  await page.evaluate(() => {
    Object.defineProperty(window, '__copiedFen', {
      configurable: true,
      writable: true,
      value: null
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text) => {
          window.__copiedFen = text;
          return Promise.resolve();
        }
      }
    });
  });

  await page.locator('#export-fen-btn').click();
  await expect(page.locator('#status-text')).toContainText('FEN copied to clipboard');

  const copiedFen = await page.evaluate(() => window.__copiedFen);
  expect(copiedFen).toMatch(/^\S+\s+[wb]\s+\S+\s+\S+\s+\d+\s+\d+$/);
});

test('forfeit flow transitions to concluded state and new game starts immediately', async ({ page }) => {
  await startBlunderfishAsWhite(page);

  const primaryBtn = page.locator('#new-game-btn');
  const resultDialog = page.locator('#game-result-dialog');

  await expect(primaryBtn).toHaveText('Forfeit');
  await primaryBtn.click();

  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText('You lost :(');
  await expect(primaryBtn).toHaveText('New Game');

  await clickDialogButton(page, '#game-result-close-btn');
  await expect(resultDialog).toBeHidden();

  await primaryBtn.click();
  await expect(primaryBtn).toHaveText('Forfeit');
  await expect(resultDialog).toBeHidden();
});

test('postgame modal action buttons close, rematch, and main menu work', async ({ page }) => {
  await startBlunderfishAsWhite(page);

  const primaryBtn = page.locator('#new-game-btn');
  const resultDialog = page.locator('#game-result-dialog');

  await primaryBtn.click();
  await expect(resultDialog).toBeVisible();

  await clickDialogButton(page, '#game-result-close-btn');
  await expect(resultDialog).toBeHidden();

  await primaryBtn.click();
  await expect(primaryBtn).toHaveText('Forfeit');
  await expect(resultDialog).toBeHidden();

  await primaryBtn.click();
  await expect(resultDialog).toBeVisible();

  await clickDialogButton(page, '#game-result-rematch-btn');
  await expect(resultDialog).toBeHidden();
  await expect(primaryBtn).toHaveText('Forfeit');

  await primaryBtn.click();
  await expect(resultDialog).toBeVisible();
  await clickDialogButton(page, '#game-result-main-menu-btn');

  await expect(page.locator('#mode-select-screen')).toBeVisible();
  await expect(page.locator('#game-app')).toHaveClass(/app-hidden/);
});
