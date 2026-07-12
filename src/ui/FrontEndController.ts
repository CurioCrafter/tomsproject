import {
  cloneCharacterProfile,
  sanitizeCharacterProfile,
  STARTING_ABILITY_IDS,
  type CharacterProfile,
  type StartingAbilityId,
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
  origin: {
    'lunar-penitent': 'Lunar Penitent',
    'aurora-votary': 'Aurora Votary',
    'comet-warden': 'Comet Warden',
    'eclipse-outcast': 'Eclipse Outcast',
  },
  startingAbility: {
    'lunar-dart': 'Lunar Dart',
    'aurora-veil': 'Aurora Veil',
    'comet-lance': 'Comet Lance',
    'eclipse-step': 'Eclipse Step',
  },
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
  private readonly startingAbilityFieldset = this.requireElement<HTMLFieldSetElement>('#starting-ability-fieldset');
  private readonly startingAbilityCount = this.requireElement<HTMLOutputElement>('#starting-ability-count');
  private readonly startingAbilityError = this.requireElement<HTMLElement>('#starting-ability-error');
  private readonly startingAbilityInputs = Array.from(
    this.form.querySelectorAll<HTMLInputElement>('input[name="startingAbilities"]'),
  );
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
    this.requireElement<HTMLButtonElement>('#begin-pilgrimage').addEventListener('click', () => this.showCreator());
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
    // title veil is retired, without allowing it to bypass character confirmation.
    this.requireElement<HTMLButtonElement>('#enter-game').addEventListener('click', () => this.showCreator());

    this.form.addEventListener('input', (event) => this.handleFormEdit(event));
    this.form.addEventListener('change', (event) => this.handleFormEdit(event));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveDraft(true);
    });

    window.addEventListener('keydown', (event) => this.handleKeyDown(event), { capture: true });
    window.addEventListener('focusin', (event) => this.keepFocusInside(event), { capture: true });
    window.addEventListener(HUD_MENU_STATE_EVENT, this.onHudMenuState);
  }

  private saveDraft(begin: boolean): void {
    if (!this.validateName()) return;
    if (!this.validateStartingAbilities()) return;
    this.draft = this.readDraft();
    this.nameInput.value = this.draft.name;
    const result = saveCharacterProfile(this.draft);
    this.profile = result.profile;
    this.renderProfileSummary();
    if (!result.persisted) {
      this.creatorStatus.dataset.state = 'error';
      this.creatorStatus.textContent =
        'This browser could not save your pilgrim. Your choices remain available for this session.';
      this.dispatchIntent('preview', this.profile);
      if (!begin) return;
    }
    if (result.persisted) {
      delete this.creatorStatus.dataset.state;
      this.creatorStatus.textContent = `${this.profile.name} has been written into the school ledger.`;
    }
    if (begin) {
      this.dispatchIntent('start', this.profile);
      this.hide();
    } else {
      this.showMainMenu();
    }
  }

  private previewDraft(): void {
    this.validateName(false);
    const abilitiesValid = this.validateStartingAbilities(false);
    const previous = this.draft;
    this.draft = this.readDraft();
    if (abilitiesValid) {
      delete this.creatorStatus.dataset.state;
      this.creatorStatus.textContent = this.draftSummary(this.draft);
    } else {
      this.creatorStatus.dataset.state = 'warning';
      const remaining = Math.max(0, 2 - this.selectedStartingAbilities().length);
      this.creatorStatus.textContent = `Choose ${remaining} more starting ${remaining === 1 ? 'sorcery' : 'sorceries'} before continuing.`;
    }
    if (this.previewRelevantChanged(previous, this.draft)) this.dispatchIntent('preview', this.draft);
  }

  private previewRelevantChanged(previous: CharacterProfile, next: CharacterProfile): boolean {
    return (
      previous.lifeStage !== next.lifeStage ||
      previous.frame !== next.frame ||
      previous.veil !== next.veil ||
      previous.robeDye !== next.robeDye ||
      previous.astralMetal !== next.astralMetal ||
      previous.catalyst !== next.catalyst ||
      previous.origin !== next.origin ||
      previous.startingAbilities[0] !== next.startingAbilities[0] ||
      previous.startingAbilities[1] !== next.startingAbilities[1]
    );
  }

  private readDraft(): CharacterProfile {
    const data = new FormData(this.form);
    const selectedAbilities = this.selectedStartingAbilities();
    return sanitizeCharacterProfile({
      name: data.get('name'),
      lifeStage: data.get('lifeStage'),
      frame: data.get('frame'),
      veil: data.get('veil'),
      robeDye: data.get('robeDye'),
      astralMetal: data.get('astralMetal'),
      catalyst: data.get('catalyst'),
      origin: data.get('origin'),
      startingAbilities: selectedAbilities.length === 2 ? selectedAbilities : this.draft.startingAbilities,
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
      origin: this.draft.origin,
    };
    for (const [name, value] of Object.entries(values)) {
      const input = this.form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
      if (input) input.checked = true;
    }
    for (const input of this.startingAbilityInputs) {
      input.checked = this.draft.startingAbilities.includes(input.value as StartingAbilityId);
    }
    this.validateStartingAbilities(false);
  }

  private handleFormEdit(event: Event): void {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.name === 'startingAbilities' &&
      target.type === 'checkbox' &&
      target.checked
    ) {
      const selected = this.startingAbilityInputs.filter((input) => input.checked);
      if (selected.length > 2) {
        const displaced = selected.find((input) => input !== target);
        if (displaced) displaced.checked = false;
      }
    }
    this.previewDraft();
  }

  private selectedStartingAbilities(): StartingAbilityId[] {
    return this.startingAbilityInputs
      .filter((input) => input.checked)
      .map((input) => input.value)
      .filter((value): value is StartingAbilityId => STARTING_ABILITY_IDS.includes(value as StartingAbilityId));
  }

  private validateStartingAbilities(report = true): boolean {
    const selected = this.selectedStartingAbilities();
    const valid = selected.length === 2 && new Set(selected).size === 2;
    const message = valid ? '' : 'Choose exactly two distinct starting sorceries.';
    this.startingAbilityCount.value = `${selected.length} of 2 chosen`;
    this.startingAbilityFieldset.setAttribute('aria-invalid', String(!valid));
    this.startingAbilityError.hidden = valid;
    this.startingAbilityError.textContent = message;
    for (const input of this.startingAbilityInputs) {
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', String(!valid));
    }
    if (!valid && report) {
      this.startingAbilityFieldset.scrollIntoView({ block: 'nearest' });
      (this.startingAbilityInputs.find((input) => !input.checked) ?? this.startingAbilityInputs[0])?.focus({
        preventScroll: true,
      });
    }
    return valid;
  }

  private validateName(report = true): boolean {
    const valid = this.nameInput.value.trim().length > 0;
    this.nameInput.setCustomValidity(valid ? '' : 'Give your pilgrim a name before continuing.');
    if (!valid && report) this.nameInput.reportValidity();
    return valid;
  }

  private renderProfileSummary(): void {
    this.profileName.textContent = this.profile.name;
    this.profileDetail.textContent = this.draftSummary(this.profile);
  }

  private draftSummary(profile: CharacterProfile): string {
    const abilities = profile.startingAbilities.map((ability) => PROFILE_LABELS.startingAbility[ability]).join(' + ');
    return `${PROFILE_LABELS.origin[profile.origin]} · ${abilities} · ${PROFILE_LABELS.catalyst[profile.catalyst]}`;
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
