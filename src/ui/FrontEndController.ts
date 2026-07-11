import {
  cloneCharacterProfile,
  sanitizeCharacterProfile,
  type CharacterProfile,
} from '../game/CharacterProfile';
import { loadCharacterProfile, saveCharacterProfile } from '../game/CharacterProfileStore';
import { HUD_MENU_STATE_EVENT, type HudMenuStateDetail } from '../systems/Hud';

export type FrontEndIntentDetail = {
  type: 'start' | 'preview' | 'open-settings';
  profile?: CharacterProfile;
};

type FrontEndPanel = 'main' | 'creator';

type BackgroundState = {
  inert: boolean;
  ariaHidden: string | null;
};

type FrontEndRuntimeWindow = Window & {
  __LAST_FIRMAMENT_FRONT_END__?: FrontEndController;
};

const PROFILE_LABELS = {
  lifeStage: { young: 'Young initiate', elder: 'Elder seer' },
  frame: { slender: 'Slender', sturdy: 'Sturdy' },
  veil: { 'deep-hood': 'Deep hood', 'moon-mask': 'Moon mask', unveiled: 'Unveiled' },
  robeDye: { midnight: 'Midnight blue', ash: 'Ash grey', moss: 'Tundra moss', oxblood: 'Oxblood' },
  astralMetal: {
    'lunar-silver': 'Lunar silver',
    'aurora-bronze': 'Aurora bronze',
    'celestial-gold': 'Celestial gold',
  },
  catalyst: { 'crescent-staff': 'Crescent staff', 'ash-wand': 'Ash wand', 'bare-hands': 'Bare hands' },
} as const;

const GAMEPLAY_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyF',
  'KeyJ',
  'KeyP',
  'KeyR',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'Tab',
]);

export class FrontEndController {
  private readonly layer = this.requireElement<HTMLElement>('#front-end-layer');
  private readonly mainPanel = this.requireElement<HTMLElement>('#main-menu-panel');
  private readonly creatorPanel = this.requireElement<HTMLElement>('#character-creator-panel');
  private readonly controlsPanel = this.requireElement<HTMLElement>('#front-controls-panel');
  private readonly controlsButton = this.requireElement<HTMLButtonElement>('#front-controls-button');
  private readonly form = this.requireElement<HTMLFormElement>('#character-form');
  private readonly nameInput = this.requireElement<HTMLInputElement>('#character-name');
  private readonly creatorStatus = this.requireElement<HTMLElement>('#creator-status');
  private readonly profileName = this.requireElement<HTMLElement>('#front-profile-name');
  private readonly profileDetail = this.requireElement<HTMLElement>('#front-profile-detail');
  private readonly backgroundStates = new Map<HTMLElement, BackgroundState>();
  private readonly backgroundElements = ['#game-canvas', '#hud', '#touch-controls']
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((element): element is HTMLElement => element !== null);

  private profile = loadCharacterProfile();
  private draft = cloneCharacterProfile(this.profile);
  private activePanel: FrontEndPanel | 'hidden' = 'hidden';
  private focusedBeforeFrontEnd: HTMLElement | null = null;
  private externalMenuOpen = Boolean(document.querySelector<HTMLElement>('#menu-layer:not([hidden])'));

  private readonly onHudMenuState = (event: Event): void => {
    const detail = (event as CustomEvent<HudMenuStateDetail>).detail;
    if (!detail) return;
    this.externalMenuOpen = detail.state !== 'none';
    this.syncExternalMenuContainment();
  };

  constructor() {
    this.bindInterface();
    this.renderProfileSummary();
    this.syncFormFromDraft();
    this.showMainMenu();

    // The game module loads immediately after this module. Defer the first preview
    // event so its runtime listener can observe the persisted profile.
    window.requestAnimationFrame(() => {
      if (this.activePanel !== 'hidden') this.dispatchIntent('preview', this.profile);
    });
  }

  showMainMenu(): void {
    this.rememberFocus();
    this.activePanel = 'main';
    this.layer.hidden = false;
    this.mainPanel.hidden = false;
    this.mainPanel.setAttribute('aria-hidden', 'false');
    this.creatorPanel.hidden = true;
    this.creatorPanel.setAttribute('aria-hidden', 'true');
    this.closeControls(false);
    this.setGameplayBackgroundInert(true);
    this.syncExternalMenuContainment();
    document.body.dataset.frontEndState = 'main';
    this.renderProfileSummary();
    this.dispatchIntent('preview', this.profile);
    this.focusSoon(this.requireElement<HTMLButtonElement>('#begin-pilgrimage'));
  }

  showCreator(): void {
    this.rememberFocus();
    this.activePanel = 'creator';
    this.draft = cloneCharacterProfile(this.profile);
    this.syncFormFromDraft();
    delete this.creatorStatus.dataset.state;
    this.creatorStatus.textContent = 'Changes are previewed live and saved only when you choose.';
    this.layer.hidden = false;
    this.mainPanel.hidden = true;
    this.mainPanel.setAttribute('aria-hidden', 'true');
    this.creatorPanel.hidden = false;
    this.creatorPanel.setAttribute('aria-hidden', 'false');
    this.setGameplayBackgroundInert(true);
    this.syncExternalMenuContainment();
    document.body.dataset.frontEndState = 'creator';
    this.dispatchIntent('preview', this.draft);
    this.focusSoon(this.nameInput);
  }

  hide(): void {
    if (this.activePanel === 'hidden') return;
    this.activePanel = 'hidden';
    this.layer.hidden = true;
    this.mainPanel.hidden = true;
    this.creatorPanel.hidden = true;
    this.mainPanel.setAttribute('aria-hidden', 'true');
    this.creatorPanel.setAttribute('aria-hidden', 'true');
    this.closeControls(false);
    this.setGameplayBackgroundInert(false);
    this.layer.inert = false;
    this.layer.removeAttribute('aria-hidden');
    delete document.body.dataset.frontEndState;
    const restoreTarget = this.focusedBeforeFrontEnd;
    this.focusedBeforeFrontEnd = null;
    if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
  }

  getProfile(): CharacterProfile {
    return cloneCharacterProfile(this.profile);
  }

  private bindInterface(): void {
    this.requireElement<HTMLButtonElement>('#begin-pilgrimage').addEventListener('click', () => this.begin(this.profile));
    this.requireElement<HTMLButtonElement>('#shape-pilgrim').addEventListener('click', () => this.showCreator());
    const settingsButton = this.requireElement<HTMLButtonElement>('#front-settings-button');
    settingsButton.addEventListener('click', () => {
      settingsButton.focus({ preventScroll: true });
      this.dispatchIntent('open-settings', this.profile);
    });
    this.controlsButton.addEventListener('click', () => this.toggleControls());
    this.requireElement<HTMLButtonElement>('#front-controls-close').addEventListener('click', () => this.closeControls(true));
    this.requireElement<HTMLButtonElement>('#creator-back').addEventListener('click', () => this.showMainMenu());
    this.requireElement<HTMLButtonElement>('#creator-save').addEventListener('click', () => this.saveDraft(false));

    // Keep the old test/bootstrap affordance functional while the visible timed
    // title veil is retired.
    this.requireElement<HTMLButtonElement>('#enter-game').addEventListener('click', () => this.begin(this.profile));

    this.form.addEventListener('input', () => this.previewDraft());
    this.form.addEventListener('change', () => this.previewDraft());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveDraft(true);
    });

    window.addEventListener('keydown', (event) => this.handleKeyDown(event), { capture: true });
    window.addEventListener('focusin', (event) => this.keepFocusInside(event), { capture: true });
    window.addEventListener(HUD_MENU_STATE_EVENT, this.onHudMenuState);
  }

  private begin(profile: CharacterProfile): void {
    const result = saveCharacterProfile(profile);
    this.profile = result.profile;
    this.renderProfileSummary();
    this.dispatchIntent('start', this.profile);
    this.hide();
  }

  private saveDraft(begin: boolean): void {
    if (!this.validateName()) return;
    this.draft = this.readDraft();
    this.nameInput.value = this.draft.name;
    const result = saveCharacterProfile(this.draft);
    this.profile = result.profile;
    this.renderProfileSummary();
    if (!result.persisted) {
      this.creatorStatus.dataset.state = 'error';
      this.creatorStatus.textContent =
        'This browser could not save your pilgrim. Your choices remain for this session; choose Back, then Begin to play without persistence.';
      this.dispatchIntent('preview', this.profile);
      return;
    }
    delete this.creatorStatus.dataset.state;
    this.creatorStatus.textContent = `${this.profile.name} has been written into the school ledger.`;
    if (begin) {
      this.dispatchIntent('start', this.profile);
      this.hide();
    } else {
      this.showMainMenu();
    }
  }

  private previewDraft(): void {
    this.validateName(false);
    const previous = this.draft;
    this.draft = this.readDraft();
    delete this.creatorStatus.dataset.state;
    this.creatorStatus.textContent = `${this.draft.name} · ${PROFILE_LABELS.lifeStage[this.draft.lifeStage]} · ${PROFILE_LABELS.catalyst[this.draft.catalyst]}`;
    if (this.appearanceChanged(previous, this.draft)) this.dispatchIntent('preview', this.draft);
  }

  private appearanceChanged(previous: CharacterProfile, next: CharacterProfile): boolean {
    return (
      previous.lifeStage !== next.lifeStage ||
      previous.frame !== next.frame ||
      previous.veil !== next.veil ||
      previous.robeDye !== next.robeDye ||
      previous.astralMetal !== next.astralMetal ||
      previous.catalyst !== next.catalyst
    );
  }

  private readDraft(): CharacterProfile {
    const data = new FormData(this.form);
    return sanitizeCharacterProfile({
      name: data.get('name'),
      lifeStage: data.get('lifeStage'),
      frame: data.get('frame'),
      veil: data.get('veil'),
      robeDye: data.get('robeDye'),
      astralMetal: data.get('astralMetal'),
      catalyst: data.get('catalyst'),
    });
  }

  private syncFormFromDraft(): void {
    this.nameInput.value = this.draft.name;
    this.nameInput.setCustomValidity('');
    const values: Record<string, string> = {
      lifeStage: this.draft.lifeStage,
      frame: this.draft.frame,
      veil: this.draft.veil,
      robeDye: this.draft.robeDye,
      astralMetal: this.draft.astralMetal,
      catalyst: this.draft.catalyst,
    };
    for (const [name, value] of Object.entries(values)) {
      const input = this.form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
      if (input) input.checked = true;
    }
  }

  private validateName(report = true): boolean {
    const valid = this.nameInput.value.trim().length > 0;
    this.nameInput.setCustomValidity(valid ? '' : 'Give your pilgrim a name before continuing.');
    if (!valid && report) this.nameInput.reportValidity();
    return valid;
  }

  private renderProfileSummary(): void {
    this.profileName.textContent = this.profile.name;
    this.profileDetail.textContent = [
      PROFILE_LABELS.lifeStage[this.profile.lifeStage],
      PROFILE_LABELS.veil[this.profile.veil],
      PROFILE_LABELS.robeDye[this.profile.robeDye],
      PROFILE_LABELS.astralMetal[this.profile.astralMetal],
      PROFILE_LABELS.catalyst[this.profile.catalyst],
    ].join(' · ');
  }

  private toggleControls(): void {
    if (this.controlsPanel.hidden) {
      this.controlsPanel.hidden = false;
      this.controlsButton.setAttribute('aria-expanded', 'true');
      this.focusSoon(this.requireElement<HTMLButtonElement>('#front-controls-close'));
    } else {
      this.closeControls(true);
    }
  }

  private closeControls(restoreFocus: boolean): void {
    this.controlsPanel.hidden = true;
    this.controlsButton.setAttribute('aria-expanded', 'false');
    if (restoreFocus && this.activePanel === 'main') this.controlsButton.focus({ preventScroll: true });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.activePanel === 'hidden' || this.externalModalOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.controlsPanel.hidden) this.closeControls(true);
      else if (this.activePanel === 'creator') this.showMainMenu();
      return;
    }

    if (event.key === 'Tab') this.trapTab(event);
    event.stopImmediatePropagation();

    const target = event.target;
    const isInteractive = target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target instanceof HTMLLabelElement;
    if (GAMEPLAY_KEYS.has(event.code) && !isInteractive && event.key !== 'Tab') event.preventDefault();
  }

  private trapTab(event: KeyboardEvent): void {
    const panel = this.visiblePanel();
    const focusable = this.focusableElements(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private keepFocusInside(event: FocusEvent): void {
    if (this.activePanel === 'hidden' || this.externalModalOpen()) return;
    const target = event.target;
    const panel = this.visiblePanel();
    if (target instanceof Node && panel.contains(target)) return;
    this.focusableElements(panel)[0]?.focus({ preventScroll: true });
  }

  private visiblePanel(): HTMLElement {
    if (!this.controlsPanel.hidden) return this.controlsPanel;
    return this.activePanel === 'creator' ? this.creatorPanel : this.mainPanel;
  }

  private focusableElements(panel: HTMLElement): HTMLElement[] {
    return Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((element) => !element.closest('[hidden]') && element.getClientRects().length > 0);
  }

  private setGameplayBackgroundInert(inert: boolean): void {
    for (const element of this.backgroundElements) {
      if (inert) {
        if (!this.backgroundStates.has(element)) {
          this.backgroundStates.set(element, { inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
        }
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      } else {
        const previous = this.backgroundStates.get(element);
        if (!previous) continue;
        element.inert = previous.inert;
        if (previous.ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', previous.ariaHidden);
        this.backgroundStates.delete(element);
      }
    }
  }

  private externalModalOpen(): boolean {
    return this.externalMenuOpen;
  }

  private syncExternalMenuContainment(): void {
    if (this.activePanel === 'hidden') return;
    this.layer.inert = this.externalMenuOpen;
    if (this.externalMenuOpen) this.layer.setAttribute('aria-hidden', 'true');
    else this.layer.removeAttribute('aria-hidden');
  }

  private rememberFocus(): void {
    if (this.activePanel === 'hidden' && document.activeElement instanceof HTMLElement) {
      this.focusedBeforeFrontEnd = document.activeElement;
    }
  }

  private focusSoon(element: HTMLElement): void {
    window.requestAnimationFrame(() => {
      if (!this.layer.hidden && element.isConnected) element.focus({ preventScroll: true });
    });
  }

  private dispatchIntent(type: FrontEndIntentDetail['type'], profile?: CharacterProfile): void {
    const detail: FrontEndIntentDetail = {
      type,
      ...(profile ? { profile: cloneCharacterProfile(profile) } : {}),
    };
    window.dispatchEvent(new CustomEvent<FrontEndIntentDetail>('celestial-front-end-intent', { detail }));
  }

  private requireElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing front-end element: ${selector}`);
    return element;
  }
}

export const frontEndController = new FrontEndController();
(window as FrontEndRuntimeWindow).__LAST_FIRMAMENT_FRONT_END__ = frontEndController;
