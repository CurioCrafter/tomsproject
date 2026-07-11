export type HudResourceSnapshot = {
  current: number;
  max: number;
};

export type HudObjectiveSnapshot = {
  kicker: string;
  title: string;
  detail: string;
  current: number;
  target: number;
  elapsed: number;
};

export type HudSpellSchool = 'lunar' | 'aurora' | 'celestial' | 'lightless' | 'locked';

export type HudSpellSnapshot = {
  id: string;
  name: string;
  school: HudSpellSchool;
  comprehension: string;
  key: string;
  glyph: string;
  charge: number;
  active?: boolean;
  locked?: boolean;
};

export type HudAffinitySnapshot = {
  name: string;
  detail: string;
  glyph: string;
  value: number;
};

export type HudBossSnapshot = {
  visible: boolean;
  name: string;
  epithet: string;
  phase: string;
  current: number;
  max: number;
};

export type HudPromptSnapshot = {
  visible: boolean;
  key: string;
  action: string;
  label: string;
};

export type HudDiscoverySnapshot = {
  id: string;
  visible: boolean;
  kicker: string;
  title: string;
  detail: string;
  duration?: number;
};

export type HudMenuState = 'none' | 'pause' | 'settings' | 'death' | 'victory';

export type HudSnapshot = {
  vitality: HudResourceSnapshot;
  focus: HudResourceSnapshot;
  stamina: HudResourceSnapshot;
  objective: HudObjectiveSnapshot;
  spells: readonly HudSpellSnapshot[];
  comprehensionTier: string;
  comprehensionProgress: number;
  affinity: HudAffinitySnapshot;
  boss: HudBossSnapshot;
  prompt: HudPromptSnapshot;
  discovery: HudDiscoverySnapshot | null;
  menu: HudMenuState;
  reducedMotion: boolean;
};

export type HudSnapshotPatch = {
  vitality?: Partial<HudResourceSnapshot>;
  focus?: Partial<HudResourceSnapshot>;
  stamina?: Partial<HudResourceSnapshot>;
  objective?: Partial<HudObjectiveSnapshot>;
  spells?: readonly HudSpellSnapshot[];
  comprehensionTier?: string;
  comprehensionProgress?: number;
  affinity?: Partial<HudAffinitySnapshot>;
  boss?: Partial<HudBossSnapshot>;
  prompt?: Partial<HudPromptSnapshot>;
  discovery?: HudDiscoverySnapshot | null;
  menu?: HudMenuState;
  reducedMotion?: boolean;
};

type RuntimeGameState = {
  elapsed?: number;
  phase?: string;
  paused?: boolean;
  dead?: boolean;
  victory?: boolean;
  objective?: string;
  restorationCount?: number;
  targetScore?: number;
  player?: {
    health?: number;
    maxHealth?: number;
    focus?: number;
    maxFocus?: number;
    stamina?: number;
    maxStamina?: number;
  };
  enemies?: { active?: number; defeated?: number };
  boss?: { spawned?: boolean; active?: boolean; health?: number; maxHealth?: number; phase?: number };
  progression?: { restored?: number; target?: number };
  affinity?: { celestial?: number; wrathful?: number; mercy?: number };
  comprehension?: {
    lunar?: { uses?: number; tier?: string };
    aurora?: { uses?: number; tier?: string };
  };
};

const DEFAULT_SNAPSHOT: HudSnapshot = {
  vitality: { current: 100, max: 100 },
  focus: { current: 80, max: 80 },
  stamina: { current: 100, max: 100 },
  objective: {
    kicker: 'Celestial objective',
    title: 'Recover the absent stars',
    detail: 'Celestial echoes found',
    current: 0,
    target: 8,
    elapsed: 0,
  },
  spells: [
    {
      id: 'lunar-dart',
      name: 'Lunar Dart',
      school: 'lunar',
      comprehension: 'Novice',
      key: 'Q',
      glyph: '☾',
      charge: 1,
      active: true,
    },
    {
      id: 'aurora-veil',
      name: 'Aurora Veil',
      school: 'aurora',
      comprehension: 'Novice',
      key: 'E',
      glyph: '✦',
      charge: 1,
    },
    {
      id: 'unremembered',
      name: 'Unremembered',
      school: 'locked',
      comprehension: 'Find its star',
      key: '3',
      glyph: '⊘',
      charge: 0,
      locked: true,
    },
  ],
  comprehensionTier: 'Novice',
  comprehensionProgress: 0.12,
  affinity: {
    name: 'Unwritten',
    detail: 'Your deeds have yet to mark the sky',
    glyph: '♢',
    value: 0,
  },
  boss: {
    visible: false,
    name: 'The Starved Astronomer',
    epithet: 'Warden of the Hollow Orbit',
    phase: 'I',
    current: 1,
    max: 1,
  },
  prompt: {
    visible: false,
    key: 'F',
    action: 'Interact',
    label: 'Read the weathered inscription',
  },
  discovery: null,
  menu: 'none',
  reducedMotion: false,
};

const CELESTIAL_NAMES = [
  'The Shepherd Moon',
  'Vesper, the First Witness',
  'The Ashen Twins',
  'The Pilgrim Comet',
  'The Verdant Choir',
  'The Crown of Glass',
  'The Hollow Wanderer',
  'The Last Firmament',
];

export class Hud {
  private readonly scoreValue = this.getElement('#score-value');
  private readonly targetValue = this.getElement('#target-value');
  private readonly timerValue = this.getElement<HTMLTimeElement>('#timer-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly objectiveKicker = this.getElement('#objective-kicker');
  private readonly objectiveTitle = this.getElement('#objective-title');
  private readonly vitalityMeter = this.getElement('#vitality-meter');
  private readonly vitalityValue = this.getElement<HTMLOutputElement>('#vitality-value');
  private readonly focusMeter = this.getElement('#focus-meter');
  private readonly focusValue = this.getElement<HTMLOutputElement>('#focus-value');
  private readonly staminaMeter = this.getElement('#stamina-meter');
  private readonly staminaValue = this.getElement<HTMLOutputElement>('#stamina-value');
  private readonly affinityName = this.getElement('#affinity-name');
  private readonly affinityDetail = this.getElement('#affinity-detail');
  private readonly affinityGlyph = this.getElement('#affinity-glyph');
  private readonly affinityValue = this.getElement<HTMLOutputElement>('#affinity-value');
  private readonly comprehensionTier = this.getElement('#comprehension-tier');
  private readonly comprehensionProgress = this.getElement('#comprehension-progress');
  private readonly spellSlots = Array.from(document.querySelectorAll<HTMLElement>('[data-spell-slot]'));
  private readonly bossHud = this.getElement('#boss-hud');
  private readonly bossName = this.getElement('#boss-name');
  private readonly bossEpithet = this.getElement('#boss-epithet');
  private readonly bossPhase = this.getElement('#boss-phase');
  private readonly bossMeter = this.getElement('#boss-meter');
  private readonly contextPrompt = this.getElement('#context-prompt');
  private readonly promptKey = this.getElement('#prompt-key');
  private readonly promptAction = this.getElement('#prompt-action');
  private readonly promptLabel = this.getElement('#prompt-label');
  private readonly discoveryOverlay = this.getElement('#discovery-overlay');
  private readonly discoveryKicker = this.getElement('#discovery-kicker');
  private readonly discoveryTitle = this.getElement('#discovery-title');
  private readonly discoveryDetail = this.getElement('#discovery-detail');
  private readonly menuLayer = this.getElement('#menu-layer');
  private readonly menuPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-menu-panel]'));
  private readonly titleVeil = this.getElement('#title-veil');
  private readonly motionSetting = this.getElement<HTMLInputElement>('#motion-setting');
  private readonly abortController = new AbortController();

  private snapshot: HudSnapshot = this.cloneSnapshot(DEFAULT_SNAPSHOT);
  private discoveryTimer: number | null = null;
  private titleTimer: number | null = null;
  private lastDiscoveryId = '';
  private menuBeforeSettings: HudMenuState = 'none';
  private focusedBeforeMenu: HTMLElement | null = null;
  private completeShown = false;
  private lastRuntimeStateAt = -Infinity;

  constructor() {
    const storedReducedMotion = this.readBoolean('last-firmament-reduced-motion');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.snapshot.reducedMotion = storedReducedMotion ?? prefersReducedMotion;
    this.motionSetting.checked = this.snapshot.reducedMotion;
    this.applyReducedMotion(this.snapshot.reducedMotion);
    this.bindInterface();
    this.render();

    this.titleTimer = window.setTimeout(() => this.dismissTitle(), 3600);
  }

  /** Full state API for simulation-driven HUD updates. */
  setSnapshot(snapshot: HudSnapshot): void {
    this.snapshot = this.cloneSnapshot(snapshot);
    this.render();
  }

  /** Partial state API for event-oriented systems that only own one HUD slice. */
  patchSnapshot(patch: HudSnapshotPatch): void {
    this.snapshot = {
      ...this.snapshot,
      vitality: { ...this.snapshot.vitality, ...patch.vitality },
      focus: { ...this.snapshot.focus, ...patch.focus },
      stamina: { ...this.snapshot.stamina, ...patch.stamina },
      objective: { ...this.snapshot.objective, ...patch.objective },
      spells: patch.spells ?? this.snapshot.spells,
      comprehensionTier: patch.comprehensionTier ?? this.snapshot.comprehensionTier,
      comprehensionProgress: patch.comprehensionProgress ?? this.snapshot.comprehensionProgress,
      affinity: { ...this.snapshot.affinity, ...patch.affinity },
      boss: { ...this.snapshot.boss, ...patch.boss },
      prompt: { ...this.snapshot.prompt, ...patch.prompt },
      discovery: patch.discovery === undefined ? this.snapshot.discovery : patch.discovery,
      menu: patch.menu ?? this.snapshot.menu,
      reducedMotion: patch.reducedMotion ?? this.snapshot.reducedMotion,
    };
    this.render();
  }

  getSnapshot(): HudSnapshot {
    return this.cloneSnapshot(this.snapshot);
  }

  /** Backward-compatible scaffold API. */
  setTarget(target: number): void {
    this.patchSnapshot({ objective: { target: Math.max(0, target) } });
  }

  /** Backward-compatible scaffold API. */
  update(score: number, target: number, elapsed: number, complete: boolean): void {
    const clampedTarget = Math.max(0, target);
    const clampedScore = Math.max(0, Math.min(score, clampedTarget || score));
    const runtimeBridgeActive = performance.now() - this.lastRuntimeStateAt < 1000;
    this.patchSnapshot(
      runtimeBridgeActive
        ? { objective: { elapsed: Math.max(0, elapsed) } }
        : {
            objective: {
              current: clampedScore,
              target: clampedTarget,
              elapsed: Math.max(0, elapsed),
              detail: complete ? 'The recovered lights answer as one' : 'Celestial echoes found',
              title: complete ? 'The local firmament is restored' : 'Recover the absent stars',
            },
          },
    );

    if (complete && !this.completeShown) {
      this.completeShown = true;
      this.showDiscovery({
        id: 'firmament-restored',
        visible: true,
        kicker: 'Constellation restored',
        title: 'The sky remembers',
        detail: 'Its returning light reaches the spiral school.',
        duration: 2400,
      });
      window.setTimeout(() => {
        if (this.completeShown) this.showMenu('victory');
      }, 2450);
    } else if (!complete) {
      this.completeShown = false;
    }
  }

  /** Backward-compatible scaffold API. */
  flashPickup(): void {
    if (!this.snapshot.reducedMotion) {
      this.statusLine.animate(
        [
          { color: 'rgba(238, 233, 215, 0.64)', transform: 'translateY(0)' },
          { color: '#a5f0cd', transform: 'translateY(-2px)' },
          { color: 'rgba(238, 233, 215, 0.64)', transform: 'translateY(0)' },
        ],
        { duration: 360, easing: 'ease-out' },
      );
    }

    const index = Math.min(this.snapshot.objective.current, CELESTIAL_NAMES.length - 1);
    this.showDiscovery({
      id: `echo-${performance.now().toFixed(0)}`,
      visible: true,
      kicker: 'Celestial memory recovered',
      title: CELESTIAL_NAMES[Math.max(0, index)],
      detail: 'A forgotten light answers the astrology spire.',
      duration: 1750,
    });
  }

  setPrompt(prompt: HudPromptSnapshot): void {
    this.patchSnapshot({ prompt });
  }

  showDiscovery(discovery: HudDiscoverySnapshot): void {
    this.snapshot = { ...this.snapshot, discovery };
    this.renderDiscovery(discovery);
  }

  showMenu(state: HudMenuState): void {
    this.snapshot = { ...this.snapshot, menu: state };
    const isOpen = state !== 'none';
    this.menuLayer.hidden = !isOpen;

    for (const panel of this.menuPanels) {
      panel.hidden = panel.dataset.menuPanel !== state;
    }

    if (isOpen) {
      this.focusedBeforeMenu ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.dataset.gameState = state;
      window.requestAnimationFrame(() => {
        this.menuPanels
          .find((panel) => panel.dataset.menuPanel === state)
          ?.querySelector<HTMLElement>('button, input')
          ?.focus();
      });
    } else {
      document.body.dataset.gameState = 'playing';
      this.focusedBeforeMenu?.focus();
      this.focusedBeforeMenu = null;
    }
  }

  dismissTitle(): void {
    if (this.titleVeil.hidden || this.titleVeil.classList.contains('is-dismissed')) return;
    if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
    this.titleTimer = null;
    this.titleVeil.classList.add('is-dismissed');
    window.setTimeout(() => {
      this.titleVeil.hidden = true;
    }, this.snapshot.reducedMotion ? 0 : 850);
  }

  dispose(): void {
    this.abortController.abort();
    if (this.discoveryTimer !== null) window.clearTimeout(this.discoveryTimer);
    if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
  }

  private bindInterface(): void {
    const signal = this.abortController.signal;

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-action]') : null;
        const action = target?.dataset.uiAction;
        if (!action) return;

        switch (action) {
          case 'enter':
            this.dismissTitle();
            break;
          case 'pause':
            this.showMenu('pause');
            break;
          case 'resume':
          case 'continue':
          case 'restart':
            this.showMenu('none');
            break;
          case 'settings':
            this.menuBeforeSettings = this.snapshot.menu === 'none' || this.snapshot.menu === 'settings' ? 'pause' : this.snapshot.menu;
            this.showMenu('settings');
            break;
          case 'back':
            this.showMenu(this.menuBeforeSettings);
            break;
        }
      },
      { signal },
    );

    window.addEventListener(
      'keydown',
      (event) => {
        if (!this.titleVeil.hidden) this.dismissTitle();
        if (event.code !== 'Escape') return;
        if (this.snapshot.menu === 'settings') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.showMenu(this.menuBeforeSettings);
        } else {
          this.showMenu(this.snapshot.menu === 'pause' ? 'none' : 'pause');
        }
      },
      { signal },
    );

    this.motionSetting.addEventListener(
      'change',
      () => {
        this.snapshot = { ...this.snapshot, reducedMotion: this.motionSetting.checked };
        this.applyReducedMotion(this.motionSetting.checked);
        this.writeBoolean('last-firmament-reduced-motion', this.motionSetting.checked);
      },
      { signal },
    );

    for (const button of document.querySelectorAll<HTMLElement>('.touch-action')) {
      const release = () => button.classList.remove('is-held');
      button.addEventListener('pointerdown', () => button.classList.add('is-held'), { signal });
      button.addEventListener('pointerup', release, { signal });
      button.addEventListener('pointercancel', release, { signal });
      button.addEventListener('lostpointercapture', release, { signal });
    }

    window.addEventListener(
      'blur',
      () => {
        for (const button of document.querySelectorAll<HTMLElement>('.touch-action.is-held')) {
          button.classList.remove('is-held');
        }
      },
      { signal },
    );

    window.addEventListener(
      'celestial-game-state',
      (event) => this.handleRuntimeState((event as CustomEvent<RuntimeGameState>).detail),
      { signal },
    );
  }

  private handleRuntimeState(state: RuntimeGameState): void {
    if (!state) return;
    this.lastRuntimeStateAt = performance.now();
    const phase = state.phase ?? 'exploration';
    const restored = state.progression?.restored ?? state.restorationCount ?? this.snapshot.objective.current;
    const restorationTarget = state.progression?.target ?? state.targetScore ?? this.snapshot.objective.target;
    const player = state.player ?? {};
    const boss = state.boss ?? {};
    const objective = state.objective ?? this.snapshot.objective.title;
    const promptsForInteraction = phase === 'exploration' && /^(Claim|Approach)/i.test(objective);

    const affinityEntries = [
      { key: 'celestial', value: state.affinity?.celestial ?? 0, glyph: '✦', detail: 'The returning heavens recognize your purpose' },
      { key: 'mercy', value: state.affinity?.mercy ?? 0, glyph: '♢', detail: 'Restraint tempers the light within you' },
      { key: 'wrathful', value: state.affinity?.wrathful ?? 0, glyph: '†', detail: 'Violence bends your sorcery toward ruin' },
    ].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
    const dominantAffinity = affinityEntries[0];

    let menu = this.snapshot.menu;
    if (state.dead || phase === 'dead') menu = 'death';
    else if (state.victory || phase === 'victory') menu = 'victory';
    else if (state.paused || phase === 'paused') menu = menu === 'settings' ? 'settings' : 'pause';
    else if (menu === 'pause' || menu === 'death' || menu === 'victory') menu = 'none';

    const spells = this.snapshot.spells.map((spell, index) => {
      const track = index === 0 ? state.comprehension?.lunar : index === 1 ? state.comprehension?.aurora : undefined;
      return {
        ...spell,
        comprehension: track?.tier ?? spell.comprehension,
        charge: index < 2 ? this.ratio(player.focus ?? 0, player.maxFocus ?? 1) : spell.charge,
      };
    });

    this.patchSnapshot({
      vitality: {
        current: player.health ?? this.snapshot.vitality.current,
        max: player.maxHealth ?? this.snapshot.vitality.max,
      },
      focus: {
        current: player.focus ?? this.snapshot.focus.current,
        max: player.maxFocus ?? this.snapshot.focus.max,
      },
      stamina: {
        current: player.stamina ?? this.snapshot.stamina.current,
        max: player.maxStamina ?? this.snapshot.stamina.max,
      },
      objective: {
        kicker: phase === 'boss' ? 'Eclipse confrontation' : phase === 'victory' ? 'Firmament restored' : 'Celestial objective',
        title: objective,
        detail:
          phase === 'boss'
            ? 'Sever the archon from the dark orbit'
            : `${Math.round(restored)} of ${Math.round(restorationTarget)} celestial bodies restored`,
        current: restored,
        target: restorationTarget,
        elapsed: state.elapsed ?? this.snapshot.objective.elapsed,
      },
      spells,
      comprehensionTier: state.comprehension?.lunar?.tier ?? this.snapshot.comprehensionTier,
      affinity: {
        name: dominantAffinity.value === 0 ? 'Unwritten' : dominantAffinity.key[0].toUpperCase() + dominantAffinity.key.slice(1),
        detail: dominantAffinity.value === 0 ? 'Your deeds have yet to mark the sky' : dominantAffinity.detail,
        glyph: dominantAffinity.value === 0 ? '♢' : dominantAffinity.glyph,
        value: Math.round(dominantAffinity.value * 100),
      },
      boss: {
        visible: Boolean(boss.spawned && boss.active),
        name: 'The Eclipse Archon',
        epithet: 'Devourer of the Returned Light',
        phase: this.formatPhase(boss.phase ?? 1),
        current: boss.health ?? this.snapshot.boss.current,
        max: boss.maxHealth ?? this.snapshot.boss.max,
      },
      prompt: {
        visible: promptsForInteraction,
        key: 'F',
        action: 'Interact',
        label: objective,
      },
      menu,
    });
  }

  private render(): void {
    this.setMeter(this.vitalityMeter, this.vitalityValue, this.snapshot.vitality);
    this.setMeter(this.focusMeter, this.focusValue, this.snapshot.focus);
    this.setMeter(this.staminaMeter, this.staminaValue, this.snapshot.stamina);

    const objective = this.snapshot.objective;
    this.scoreValue.textContent = String(Math.round(objective.current));
    this.targetValue.textContent = String(Math.round(objective.target));
    this.objectiveKicker.textContent = objective.kicker;
    this.objectiveTitle.textContent = objective.title;
    this.statusLine.textContent = objective.detail;
    this.timerValue.textContent = this.formatTime(objective.elapsed);
    this.timerValue.dateTime = `PT${Math.floor(objective.elapsed)}S`;

    this.affinityName.textContent = this.snapshot.affinity.name;
    this.affinityDetail.textContent = this.snapshot.affinity.detail;
    this.affinityGlyph.textContent = this.snapshot.affinity.glyph;
    this.affinityValue.textContent = this.formatSigned(this.snapshot.affinity.value);
    this.affinityValue.classList.toggle('is-negative', this.snapshot.affinity.value < 0);

    this.comprehensionTier.textContent = this.snapshot.comprehensionTier;
    this.comprehensionProgress.style.setProperty('--meter-value', String(this.clamp01(this.snapshot.comprehensionProgress)));
    this.renderSpells();
    this.renderBoss();
    this.renderPrompt();
    this.applyReducedMotion(this.snapshot.reducedMotion);

    if (this.snapshot.discovery?.visible && this.snapshot.discovery.id !== this.lastDiscoveryId) {
      this.renderDiscovery(this.snapshot.discovery);
    }

    if (this.snapshot.menu !== (this.menuLayer.hidden ? 'none' : this.visibleMenu())) {
      this.showMenu(this.snapshot.menu);
    }
  }

  private renderSpells(): void {
    this.spellSlots.forEach((slot, index) => {
      const spell = this.snapshot.spells[index];
      slot.hidden = !spell;
      if (!spell) return;

      slot.dataset.spellId = spell.id;
      slot.style.setProperty('--slot-charge', String(this.clamp01(spell.charge)));
      slot.classList.toggle('is-active', Boolean(spell.active));
      slot.classList.toggle('is-locked', Boolean(spell.locked));
      slot.dataset.school = spell.school;

      const key = slot.querySelector<HTMLElement>('kbd');
      const glyph = slot.querySelector<HTMLElement>('.spell-slot__glyph');
      const name = slot.querySelector<HTMLElement>('strong');
      const tier = slot.querySelector<HTMLElement>('small');
      if (key) key.textContent = spell.key;
      if (glyph) {
        glyph.textContent = spell.glyph;
        glyph.classList.toggle('spell-slot__glyph--aurora', spell.school === 'aurora');
      }
      if (name) name.textContent = spell.name;
      if (tier) tier.textContent = spell.comprehension;
    });
  }

  private renderBoss(): void {
    const boss = this.snapshot.boss;
    this.bossHud.hidden = !boss.visible;
    if (!boss.visible) return;
    this.bossName.textContent = boss.name;
    this.bossEpithet.textContent = boss.epithet;
    this.bossPhase.textContent = boss.phase;
    this.bossMeter.style.setProperty('--meter-value', String(this.ratio(boss.current, boss.max)));
    this.bossMeter.setAttribute('role', 'progressbar');
    this.bossMeter.setAttribute('aria-valuemin', '0');
    this.bossMeter.setAttribute('aria-valuemax', String(Math.max(0, boss.max)));
    this.bossMeter.setAttribute('aria-valuenow', String(Math.max(0, boss.current)));
  }

  private renderPrompt(): void {
    const prompt = this.snapshot.prompt;
    this.contextPrompt.hidden = !prompt.visible;
    if (!prompt.visible) return;
    this.promptKey.textContent = prompt.key;
    this.promptAction.textContent = prompt.action;
    this.promptLabel.textContent = prompt.label;
  }

  private renderDiscovery(discovery: HudDiscoverySnapshot): void {
    if (this.discoveryTimer !== null) window.clearTimeout(this.discoveryTimer);
    this.lastDiscoveryId = discovery.id;
    this.discoveryOverlay.hidden = !discovery.visible;
    this.discoveryOverlay.classList.remove('is-leaving');
    if (!discovery.visible) return;

    this.discoveryKicker.textContent = discovery.kicker;
    this.discoveryTitle.textContent = discovery.title;
    this.discoveryDetail.textContent = discovery.detail;
    const duration = Math.max(700, discovery.duration ?? 2200);
    this.discoveryTimer = window.setTimeout(() => {
      this.discoveryOverlay.classList.add('is-leaving');
      this.discoveryTimer = window.setTimeout(() => {
        this.discoveryOverlay.hidden = true;
        this.discoveryOverlay.classList.remove('is-leaving');
        this.snapshot = { ...this.snapshot, discovery: null };
        this.discoveryTimer = null;
      }, this.snapshot.reducedMotion ? 0 : 460);
    }, duration);
  }

  private setMeter(element: HTMLElement, output: HTMLOutputElement, resource: HudResourceSnapshot): void {
    const current = Math.max(0, resource.current);
    const max = Math.max(0, resource.max);
    element.style.setProperty('--meter-value', String(this.ratio(current, max)));
    element.setAttribute('role', 'progressbar');
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', String(Math.round(max)));
    element.setAttribute('aria-valuenow', String(Math.round(current)));
    output.textContent = String(Math.round(current));
  }

  private applyReducedMotion(enabled: boolean): void {
    document.documentElement.dataset.reducedMotion = String(enabled);
    this.motionSetting.checked = enabled;
  }

  private visibleMenu(): HudMenuState {
    const visible = this.menuPanels.find((panel) => !panel.hidden)?.dataset.menuPanel;
    return visible === 'pause' || visible === 'settings' || visible === 'death' || visible === 'victory' ? visible : 'none';
  }

  private ratio(current: number, max: number): number {
    return max > 0 ? this.clamp01(current / max) : 0;
  }

  private clamp01(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private formatTime(elapsed: number): string {
    const wholeSeconds = Math.max(0, Math.floor(elapsed));
    const minutes = Math.min(99, Math.floor(wholeSeconds / 60));
    const seconds = minutes === 99 && wholeSeconds >= 6000 ? 59 : wholeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private formatSigned(value: number): string {
    const rounded = Math.round(value);
    if (rounded === 0) return '±0';
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}`;
  }

  private formatPhase(phase: number): string {
    if (phase === 1) return 'I';
    if (phase === 2) return 'II';
    if (phase === 3) return 'III';
    return String(Math.max(1, Math.round(phase)));
  }

  private cloneSnapshot(snapshot: HudSnapshot): HudSnapshot {
    return {
      ...snapshot,
      vitality: { ...snapshot.vitality },
      focus: { ...snapshot.focus },
      stamina: { ...snapshot.stamina },
      objective: { ...snapshot.objective },
      spells: snapshot.spells.map((spell) => ({ ...spell })),
      affinity: { ...snapshot.affinity },
      boss: { ...snapshot.boss },
      prompt: { ...snapshot.prompt },
      discovery: snapshot.discovery ? { ...snapshot.discovery } : null,
    };
  }

  private readBoolean(key: string): boolean | null {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? null : value === 'true';
    } catch {
      return null;
    }
  }

  private writeBoolean(key: string, value: boolean): void {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Storage may be disabled in privacy-focused browsers; the live setting still applies.
    }
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
