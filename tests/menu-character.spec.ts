import { expect, test, type Page } from '@playwright/test';
import type { CharacterProfile } from '../src/game/CharacterProfile';
import { CHARACTER_PROFILE_STORAGE_KEY } from '../src/game/CharacterProfileStore';

type CapturedIntent = {
  type: 'start' | 'preview' | 'open-settings';
  profile?: CharacterProfile;
};

type CapturedMenuState = {
  state: 'none' | 'pause' | 'settings' | 'death' | 'victory';
};

type FrontEndTestWindow = Window & {
  __FRONT_END_EVENTS__?: CapturedIntent[];
  __HUD_MENU_STATES__?: CapturedMenuState[];
  __LAST_FIRMAMENT_FRONT_END__?: {
    showMainMenu(): void;
    showCreator(): void;
    hide(): void;
    getProfile(): CharacterProfile;
  };
};

const STORAGE_KEY = CHARACTER_PROFILE_STORAGE_KEY;

// These tests prove the isolated front-end contract. Game.ts is expected to own
// the integration listener that applies preview/start profiles to the 3D runtime.
async function openFrontEnd(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const runtime = window as FrontEndTestWindow;
    runtime.__FRONT_END_EVENTS__ = [];
    runtime.__HUD_MENU_STATES__ = [];
    window.addEventListener('celestial-front-end-intent', (event) => {
      runtime.__FRONT_END_EVENTS__?.push((event as CustomEvent<CapturedIntent>).detail);
    });
    window.addEventListener('celestial-hud-menu-state', (event) => {
      runtime.__HUD_MENU_STATES__?.push((event as CustomEvent<CapturedMenuState>).detail);
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as FrontEndTestWindow).__LAST_FIRMAMENT_FRONT_END__));
  await expect(page.locator('#main-menu-panel')).toBeVisible();
}

async function lastIntent(page: Page, type: CapturedIntent['type']): Promise<CapturedIntent | undefined> {
  return page.evaluate((intentType) => {
    const events = (window as FrontEndTestWindow).__FRONT_END_EVENTS__ ?? [];
    return [...events].reverse().find((event) => event.type === intentType);
  }, type);
}

async function selectRadio(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((element) => {
    const input = element as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function setCheckbox(page: Page, selector: string, checked: boolean): Promise<void> {
  await page.locator(selector).evaluate((element, nextChecked) => {
    const input = element as HTMLInputElement;
    input.checked = nextChecked;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

test('boot presents a deliberate, focus-contained main menu over an inert game surface', async ({ page }) => {
  await openFrontEnd(page);

  await expect(page.locator('#front-end-layer')).toBeVisible();
  await expect(page.locator('#title-veil')).toBeHidden();
  await expect(page.locator('#character-creator-panel')).toBeHidden();
  await expect(page.locator('#begin-pilgrimage')).toBeFocused();

  for (const selector of ['#game-canvas', '#hud', '#touch-controls']) {
    const state = await page.locator(selector).evaluate((element) => ({
      inert: (element as HTMLElement).inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    expect(state, `${selector} should be inert behind the modal front end`).toEqual({ inert: true, ariaHidden: 'true' });
  }

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#front-controls-button')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#begin-pilgrimage')).toBeFocused();

  await page.locator('#front-controls-button').click();
  await expect(page.locator('#front-controls-panel')).toBeVisible();
  await expect(page.locator('#front-controls-close')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#front-controls-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#front-controls-panel')).toBeHidden();
  await expect(page.locator('#front-controls-button')).toBeFocused();

  await page.locator('#front-settings-button').click();
  await expect.poll(async () => (await lastIntent(page, 'open-settings'))?.type).toBe('open-settings');
});

test('front-end settings owns focus and accessibility containment until it closes', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#front-settings-button').click();

  await expect(page.locator('[data-menu-panel="settings"]')).toBeVisible();
  await expect(page.locator('#mute-setting')).toBeFocused();
  expect(await page.locator('#front-end-layer').evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  await expect(page.locator('#front-end-layer')).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-menu-panel="settings"] [data-ui-action="back"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#mute-setting')).toBeFocused();

  await page.locator('#begin-pilgrimage').evaluate((element) => (element as HTMLElement).focus());
  await expect(page.locator('#mute-setting')).toBeFocused();

  await page.locator('[data-menu-panel="settings"] [data-ui-action="back"]').click();
  await expect(page.locator('#menu-layer')).toBeHidden();
  expect(await page.locator('#front-end-layer').evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect(page.locator('#front-end-layer')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#front-settings-button')).toBeFocused();

  const states = await page.evaluate(() => (window as FrontEndTestWindow).__HUD_MENU_STATES__ ?? []);
  expect(states.slice(-2).map(({ state }) => state)).toEqual(['settings', 'none']);
  for (const selector of ['#game-canvas', '#hud', '#touch-controls']) {
    expect(await page.locator(selector).evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  }
});

test('name edits do not rebuild the model and a radio input previews only once', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  const previewCount = () =>
    page.evaluate(() =>
      ((window as FrontEndTestWindow).__FRONT_END_EVENTS__ ?? []).filter((event) => event.type === 'preview').length,
    );
  const initialCount = await previewCount();

  const nameInput = page.locator('#character-name');
  await nameInput.fill('');
  await nameInput.pressSequentially('Ilyra of Vesper');
  await expect(nameInput).toHaveValue('Ilyra of Vesper');
  expect(await previewCount()).toBe(initialCount);

  await selectRadio(page, 'input[name="lifeStage"][value="elder"]');
  expect(await previewCount()).toBe(initialCount + 1);
});

test('reduced motion keeps the live character portrait static', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'One pixel-stability proof is sufficient.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  const preview = page.locator('#character-preview-canvas');
  await expect(preview).toBeVisible();
  await page.waitForTimeout(500);
  const first = await preview.screenshot();
  await page.waitForTimeout(500);
  const second = await preview.screenshot();
  expect(first.equals(second)).toBe(true);
});

test('creator emits live previews, validates, persists, and restores the complete profile', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  await expect(page.locator('#character-creator-panel')).toBeVisible();
  await expect(page.locator('#character-name')).toBeFocused();

  await page.locator('#character-name').fill('Astrid of Vesper');
  await selectRadio(page, 'input[name="lifeStage"][value="elder"]');
  await selectRadio(page, 'input[name="frame"][value="sturdy"]');
  await selectRadio(page, 'input[name="veil"][value="moon-mask"]');
  await selectRadio(page, 'input[name="robeDye"][value="oxblood"]');
  await selectRadio(page, 'input[name="astralMetal"][value="celestial-gold"]');
  await selectRadio(page, 'input[name="catalyst"][value="bare-hands"]');
  await selectRadio(page, 'input[name="origin"][value="eclipse-outcast"]');
  await setCheckbox(page, 'input[name="startingAbilities"][value="aurora-veil"]', false);
  await setCheckbox(page, 'input[name="startingAbilities"][value="comet-lance"]', true);

  await expect
    .poll(async () => (await lastIntent(page, 'preview'))?.profile)
    .toMatchObject({
      name: 'Astrid of Vesper',
      lifeStage: 'elder',
      frame: 'sturdy',
      veil: 'moon-mask',
      robeDye: 'oxblood',
      astralMetal: 'celestial-gold',
      catalyst: 'bare-hands',
      origin: 'eclipse-outcast',
      startingAbilities: ['lunar-dart', 'comet-lance'],
    });

  await page.locator('#creator-save').click();
  await expect(page.locator('#main-menu-panel')).toBeVisible();
  await expect(page.locator('#front-profile-name')).toHaveText('Astrid of Vesper');

  const persisted = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as CharacterProfile, STORAGE_KEY);
  expect(persisted).toMatchObject({
    schemaVersion: 2,
    name: 'Astrid of Vesper',
    lifeStage: 'elder',
    frame: 'sturdy',
    veil: 'moon-mask',
    robeDye: 'oxblood',
    astralMetal: 'celestial-gold',
    catalyst: 'bare-hands',
    origin: 'eclipse-outcast',
    startingAbilities: ['lunar-dart', 'comet-lance'],
  });

  await page.reload();
  await page.locator('#shape-pilgrim').click();
  await expect(page.locator('#character-name')).toHaveValue('Astrid of Vesper');
  for (const selector of [
    'input[name="lifeStage"][value="elder"]',
    'input[name="frame"][value="sturdy"]',
    'input[name="veil"][value="moon-mask"]',
    'input[name="robeDye"][value="oxblood"]',
    'input[name="astralMetal"][value="celestial-gold"]',
    'input[name="catalyst"][value="bare-hands"]',
    'input[name="origin"][value="eclipse-outcast"]',
    'input[name="startingAbilities"][value="lunar-dart"]',
    'input[name="startingAbilities"][value="comet-lance"]',
  ]) {
    await expect(page.locator(selector)).toBeChecked();
  }
});

test('creator keeps the starting loadout distinct and blocks fewer than two sorceries', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();

  await expect(page.locator('#starting-ability-count')).toHaveText('2 of 2 chosen');
  await setCheckbox(page, 'input[name="startingAbilities"][value="comet-lance"]', true);
  await expect(page.locator('input[name="startingAbilities"][value="lunar-dart"]')).not.toBeChecked();
  await expect(page.locator('input[name="startingAbilities"][value="aurora-veil"]')).toBeChecked();
  await expect(page.locator('input[name="startingAbilities"][value="comet-lance"]')).toBeChecked();

  await setCheckbox(page, 'input[name="startingAbilities"][value="aurora-veil"]', false);
  await expect(page.locator('#starting-ability-count')).toHaveText('1 of 2 chosen');
  await expect(page.locator('#starting-ability-fieldset')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#starting-ability-error')).toContainText('exactly two distinct');
  await page.locator('#creator-begin').click();
  await expect(page.locator('#character-creator-panel')).toBeVisible();
  expect(await lastIntent(page, 'start')).toBeUndefined();

  await setCheckbox(page, 'input[name="startingAbilities"][value="eclipse-step"]', true);
  await expect(page.locator('#starting-ability-fieldset')).toHaveAttribute('aria-invalid', 'false');
  await page.locator('#creator-begin').click();
  await expect(page.locator('#front-end-layer')).toBeHidden();
  expect((await lastIntent(page, 'start'))?.profile?.startingAbilities).toEqual(['comet-lance', 'eclipse-step']);
});

test('begin persists before dispatching start and restores gameplay interactivity', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#begin-pilgrimage').click();

  await expect(page.locator('#front-end-layer')).toBeHidden();
  const start = await lastIntent(page, 'start');
  expect(start?.profile).toMatchObject({
    schemaVersion: 2,
    name: 'Unnamed Pilgrim',
    origin: 'lunar-penitent',
    startingAbilities: ['lunar-dart', 'aurora-veil'],
  });

  const storedName = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CharacterProfile).name : null;
  }, STORAGE_KEY);
  expect(storedName).toBe('Unnamed Pilgrim');

  for (const selector of ['#game-canvas', '#hud', '#touch-controls']) {
    expect(await page.locator(selector).evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  }
});

test('leaving the creator discards the draft and restores the persisted preview', async ({ page }) => {
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  await page.locator('input[name="robeDye"][value="oxblood"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(async () => (await lastIntent(page, 'preview'))?.profile?.robeDye).toBe('oxblood');

  await page.locator('#creator-back').click();
  await expect(page.locator('#main-menu-panel')).toBeVisible();
  await expect.poll(async () => (await lastIntent(page, 'preview'))?.profile?.robeDye).toBe('midnight');
  expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
});

test('malformed storage and blank names fail safely without starting', async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, '{not-json'), STORAGE_KEY);
  await openFrontEnd(page);

  await expect(page.locator('#front-profile-name')).toHaveText('Unnamed Pilgrim');
  await page.locator('#shape-pilgrim').click();
  await page.locator('#character-name').fill('   ');
  await page.locator('#creator-begin').click();

  await expect(page.locator('#character-creator-panel')).toBeVisible();
  await expect(page.locator('#character-name')).toHaveJSProperty('validationMessage', 'Give your pilgrim a name before continuing.');
  expect(await lastIntent(page, 'start')).toBeUndefined();
});

test('failed profile persistence is reported without losing the session draft', async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (key.startsWith('last-firmament.character.')) throw new DOMException('Storage is blocked', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    };
  });
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  await page.locator('#character-name').fill('Session Seer');
  await page.locator('#creator-save').click();

  await expect(page.locator('#character-creator-panel')).toBeVisible();
  await expect(page.locator('#creator-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#creator-status')).toContainText('could not save your pilgrim');
  expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  expect(await lastIntent(page, 'start')).toBeUndefined();

  await page.locator('#creator-back').click();
  await expect(page.locator('#front-profile-name')).toHaveText('Session Seer');
  await page.locator('#begin-pilgrimage').click();
  await expect(page.locator('#front-end-layer')).toBeHidden();
  expect((await lastIntent(page, 'start'))?.profile?.name).toBe('Session Seer');
});

test('creator controls retain practical targets and fit portrait and short landscape viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFrontEnd(page);
  await page.locator('#shape-pilgrim').click();
  await page.waitForTimeout(500);

  for (const selector of ['#character-name', '#creator-back', '#creator-save', '#creator-begin']) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should have a visible target`).not.toBeNull();
    expect(box?.height ?? 0, `${selector} height`).toBeGreaterThanOrEqual(44);
  }

  const optionHeights = await page.locator('.creator-option > span').evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
  optionHeights.forEach((height, index) => {
    expect(height, `creator option ${index} height`).toBeGreaterThanOrEqual(44);
  });

  await page.setViewportSize({ width: 844, height: 390 });
  const panelBox = await page.locator('#character-creator-panel').boundingBox();
  const beginBox = await page.locator('#creator-begin').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(beginBox).not.toBeNull();
  expect((panelBox?.x ?? -1) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(844);
  expect((panelBox?.y ?? -1) + (panelBox?.height ?? 0)).toBeLessThanOrEqual(390);
  expect((beginBox?.y ?? -1) + (beginBox?.height ?? 0)).toBeLessThanOrEqual(390);
  expect(beginBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  for (const viewport of [
    { width: 720, height: 800 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(viewport);
    const panel = await page.locator('#character-creator-panel').boundingBox();
    const form = await page.locator('#character-form').boundingBox();
    const begin = await page.locator('#creator-begin').boundingBox();
    expect(panel, `${viewport.width}x${viewport.height} panel`).not.toBeNull();
    expect(form, `${viewport.width}x${viewport.height} form`).not.toBeNull();
    expect(begin, `${viewport.width}x${viewport.height} begin`).not.toBeNull();
    expect(panel?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    expect((form?.x ?? 0) + (form?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0) + 0.5);
    expect((begin?.x ?? 0) + (begin?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0) + 0.5);
    expect((begin?.y ?? 0) + (begin?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
  }
});
