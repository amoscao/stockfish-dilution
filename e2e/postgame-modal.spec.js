import { expect, test } from '@playwright/test';

async function playMoveBySquares(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
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

async function clickPrimaryButton(page) {
  await page.evaluate(() => {
    const button = document.querySelector('#new-game-btn');
    if (!button) {
      throw new Error('Missing primary game button');
    }
    button.click();
  });
}

test('forfeit opens modal, close works, rematch and main menu actions work', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Blunderfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const primaryBtn = page.locator('#new-game-btn');
  await expect(primaryBtn).toHaveText('Forfeit');

  await primaryBtn.click();
  await expect(page.locator('#game-result-dialog')).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText('You lost :(');
  await expect(page.locator('#game-result-graph')).toBeVisible();
  await expect(primaryBtn).toHaveText('New Game');

  await clickDialogButton(page, '#game-result-close-btn');
  await expect(page.locator('#game-result-dialog')).toBeHidden();

  await primaryBtn.click();
  await expect(primaryBtn).toHaveText('Forfeit');

  await primaryBtn.click();
  await expect(page.locator('#game-result-dialog')).toBeVisible();
  await clickDialogButton(page, '#game-result-main-menu-btn');
  await expect(page.locator('#mode-select-screen')).toBeVisible();
});

test('rematch from end-game modal should immediately start a fresh game', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Blunderfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const primaryBtn = page.locator('#new-game-btn');
  const resultDialog = page.locator('#game-result-dialog');

  await expect(primaryBtn).toHaveText('Forfeit');
  await primaryBtn.click();
  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText('You lost :(');

  await clickDialogButton(page, '#game-result-rematch-btn');
  await expect(resultDialog).toBeHidden();
  await expect(primaryBtn).toHaveText('Forfeit');

  await primaryBtn.click();
  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText('You lost :(');
});

test('rematch after checkmate should immediately reset board state', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Blunderfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.locator('#setup-blunder-slider').evaluate((el) => {
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Start Game' }).click();

  await expect(page.locator('#status-text')).toHaveText('You are White. Your Move.');
  await playMoveBySquares(page, 'f2', 'f3');
  await expect(page.locator('#status-text')).toHaveText('Your move.');
  await playMoveBySquares(page, 'g2', 'g4');

  const resultDialog = page.locator('#game-result-dialog');
  const primaryBtn = page.locator('#new-game-btn');

  await expect(resultDialog).toBeVisible();
  await expect(page.locator('#game-result-title')).toHaveText('You lost :(');

  await clickDialogButton(page, '#game-result-rematch-btn');
  await expect(resultDialog).toBeHidden();

  // A real rematch should already be active, so this button should be Forfeit immediately.
  await expect(primaryBtn).toHaveText('Forfeit');
});

test('rapid rematch/new-game interactions keep postgame state stable', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Blunderfish' }).click();
  await page.getByLabel('Play as').selectOption('w');
  await page.getByRole('button', { name: 'Start Game' }).click();

  const primaryBtn = page.locator('#new-game-btn');
  const resultDialog = page.locator('#game-result-dialog');
  await expect(primaryBtn).toHaveText('Forfeit');

  for (let i = 0; i < 3; i += 1) {
    await clickPrimaryButton(page);
    await expect(resultDialog).toBeVisible();
    await clickDialogButton(page, '#game-result-rematch-btn');
    await expect(resultDialog).toBeHidden();
    await expect(primaryBtn).toHaveText('Forfeit');
  }
});
