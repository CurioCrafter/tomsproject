import type { RouteChoiceDefinition } from '../game/content/RouteTypes';
import {
  ITEM_SLOTS,
  SPEC_BRANCHES,
  type ItemSlot,
  type ProceduralAbility,
  type ProceduralItem,
  type ProgressionSnapshot,
  type ProgressionStat,
  type RewardChoice,
  type SpecBranch,
} from '../game/progression/ProgressionTypes';
import { HUD_MENU_STATE_EVENT, type HudMenuState, type HudMenuStateDetail } from '../systems/Hud';

export const PROGRESSION_INTENT_EVENT = 'celestial-progression-intent' as const;
export const ROUTE_CHOICE_INTENT_EVENT = 'celestial-route-choice-intent' as const;

export type ProgressionIntentDetail = Readonly<{
  action:
    | 'claim-reward'
    | 'equip-item'
    | 'equip-ability'
    | 'upgrade-item'
    | 'upgrade-ability'
    | 'allocate-spec'
    | 'dismiss-reward';
  id?: string;
  offerId?: string;
  slot?: number;
  branch?: SpecBranch;
}>;

export type RouteChoiceIntentDetail = Readonly<{ choiceId: string; optionId: string }>;

type AtlasTab = 'gear' | 'sorceries' | 'constellation';

type RuntimeProgressionSnapshot = ProgressionSnapshot & {
  restored?: number;
  target?: number;
  charms?: readonly string[];
};

type RuntimeGameState = Readonly<{
  phase?: 'menu' | 'exploration' | 'boss' | 'dead' | 'victory' | 'paused';
  paused?: boolean;
  dead?: boolean;
  victory?: boolean;
  progression?: RuntimeProgressionSnapshot;
  route?: Readonly<{ availableChoice?: RouteChoiceDefinition | null }>;
}>;

type MenuLayerState = Readonly<{ inert: boolean; ariaHidden: string | null }>;

type AtlasOpenOptions = Readonly<{
  resumeOnClose?: boolean;
  focusReward?: boolean;
}>;

type AtlasRuntimeWindow = Window & {
  __LAST_FIRMAMENT_ATLAS__?: ProgressionPanelController;
};

const SLOT_LABELS: Readonly<Record<ItemSlot, string>> = {
  weapon: 'Weapon',
  catalyst: 'Catalyst',
  robe: 'Robe',
  charm: 'Charm',
};

const SLOT_GLYPHS: Readonly<Record<ItemSlot, string>> = {
  weapon: '†',
  catalyst: '☾',
  robe: '◇',
  charm: '✦',
};

const SLOT_KEYS = ['Q', 'E', '3'] as const;

const SPEC_META: Readonly<Record<SpecBranch, { name: string; glyph: string; description: string }>> = {
  moon: { name: 'Moon', glyph: '☾', description: 'Spell force, deeper focus, and swifter celestial recall.' },
  aurora: { name: 'Aurora', glyph: '✦', description: 'Vitality, restoration, and wards against ruin.' },
  eclipse: { name: 'Eclipse', glyph: '◐', description: 'Melee force, stamina, movement, and shortened recovery.' },
};

const STAT_LABELS: Readonly<Record<ProgressionStat, string>> = {
  meleePower: 'Melee power',
  spellPower: 'Spell power',
  maxHealth: 'Vitality',
  maxFocus: 'Focus',
  maxStamina: 'Stamina',
  moveSpeed: 'Movement',
  cooldownRate: 'Recovery',
  damageReduction: 'Warding',
  lootLuck: 'Discovery',
  healingPower: 'Restoration',
};

const PERCENT_STATS = new Set<ProgressionStat>([
  'meleePower',
  'spellPower',
  'moveSpeed',
  'cooldownRate',
  'damageReduction',
  'healingPower',
]);

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export class ProgressionPanelController {
  private readonly layer = this.requireElement<HTMLElement>('#star-atlas-layer');
  private readonly panel = this.requireElement<HTMLElement>('#star-atlas-panel');
  private readonly menuLayer = this.requireElement<HTMLElement>('#menu-layer');
  private readonly pauseButton = this.requireElement<HTMLButtonElement>('#pause-button');
  private readonly atlasButton = this.requireElement<HTMLButtonElement>('#atlas-button');
  private readonly pauseResumeButton = this.requireElement<HTMLButtonElement>(
    '[data-menu-panel="pause"] [data-ui-action="resume"]',
  );
  private readonly notice = this.requireElement<HTMLElement>('#atlas-notice');
  private readonly levelValue = this.requireElement<HTMLElement>('#atlas-level');
  private readonly originValue = this.requireElement<HTMLElement>('#atlas-origin');
  private readonly stardustValue = this.requireElement<HTMLElement>('#atlas-stardust');
  private readonly insightValue = this.requireElement<HTMLElement>('#atlas-insight');
  private readonly experienceLabel = this.requireElement<HTMLElement>('#atlas-experience-label');
  private readonly experienceBar = this.requireElement<HTMLElement>('#atlas-experience-bar');
  private readonly inventoryCount = this.requireElement<HTMLElement>('#atlas-inventory-count');
  private readonly abilityCount = this.requireElement<HTMLElement>('#atlas-ability-count');
  private readonly specCurrency = this.requireElement<HTMLElement>('#atlas-spec-currency');
  private readonly equipment = this.requireElement<HTMLElement>('#atlas-equipment');
  private readonly inventory = this.requireElement<HTMLElement>('#atlas-inventory');
  private readonly loadout = this.requireElement<HTMLElement>('#atlas-loadout');
  private readonly abilities = this.requireElement<HTMLElement>('#atlas-abilities');
  private readonly specs = this.requireElement<HTMLElement>('#atlas-specs');
  private readonly modifiers = this.requireElement<HTMLElement>('#atlas-modifiers');
  private readonly pathMarks = this.requireElement<HTMLElement>('#atlas-path-marks');
  private readonly reward = this.requireElement<HTMLElement>('#atlas-reward');
  private readonly rewardTitle = this.requireElement<HTMLElement>('#atlas-reward-title');
  private readonly rewardDetail = this.requireElement<HTMLElement>('#atlas-reward-detail');
  private readonly rewardChoices = this.requireElement<HTMLElement>('#atlas-reward-choices');
  private readonly status = this.requireElement<HTMLElement>('#atlas-status');
  private readonly tabs = Array.from(this.panel.querySelectorAll<HTMLButtonElement>('[data-atlas-tab]'));
  private readonly tabPanels = Array.from(this.panel.querySelectorAll<HTMLElement>('[data-atlas-panel]'));
  private readonly routePrompt = this.requireElement<HTMLElement>('#route-choice-prompt');
  private readonly routeTitle = this.requireElement<HTMLElement>('#route-choice-title');
  private readonly routeDetail = this.requireElement<HTMLElement>('#route-choice-detail');
  private readonly routeOptions = this.requireElement<HTMLElement>('#route-choice-options');
  private readonly touchAbilityButtons = [
    this.requireElement<HTMLButtonElement>('#lunar-button'),
    this.requireElement<HTMLButtonElement>('#aurora-button'),
    this.requireElement<HTMLButtonElement>('#ability3-button'),
  ] as const;
  private readonly abortController = new AbortController();
  private readonly transientTimers = new Set<number>();

  private state: RuntimeGameState | null = null;
  private hudMenuState: HudMenuState = 'none';
  private activeTab: AtlasTab = 'gear';
  private menuLayerState: MenuLayerState | null = null;
  private focusedBeforeOpen: HTMLElement | null = null;
  private resumeOnClose = false;
  private closeRequested = false;
  private closeFallbackTimer: number | null = null;
  private lastRenderSignature = '';
  private lastAutoOpenedOfferId = '';
  private pendingChoiceId = '';
  private focusRewardOnOpen = false;

  constructor() {
    this.bindInterface();
    this.selectTab('gear', false);
    this.renderProgression();
    this.renderRouteChoice();
    (window as AtlasRuntimeWindow).__LAST_FIRMAMENT_ATLAS__ = this;
  }

  get isOpen(): boolean {
    return !this.layer.hidden;
  }

  open(options: AtlasOpenOptions = {}): void {
    if (this.isOpen || !this.canOpen()) return;
    this.focusedBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.resumeOnClose = options.resumeOnClose ?? (!this.runtimePaused() && this.hudMenuState === 'none');
    this.focusRewardOnOpen = Boolean(options.focusReward);
    this.closeRequested = false;

    if (this.menuLayer.hidden) this.pauseButton.click();
    if (this.resumeOnClose) this.dispatchPauseIntent();

    this.menuLayerState = {
      inert: this.menuLayer.inert,
      ariaHidden: this.menuLayer.getAttribute('aria-hidden'),
    };
    this.menuLayer.inert = true;
    this.menuLayer.setAttribute('aria-hidden', 'true');
    this.layer.hidden = false;
    this.layer.setAttribute('aria-hidden', 'false');
    document.body.dataset.atlasOpen = 'true';
    this.renderRouteChoice();

    window.requestAnimationFrame(() => {
      if (!this.isOpen) return;
      const rewardAction = this.reward.querySelector<HTMLElement>('[data-progression-action="claim-reward"]');
      const target = this.focusRewardOnOpen && !this.reward.hidden ? rewardAction : this.activeTabElement();
      (target ?? this.requireElement<HTMLElement>('#atlas-close')).focus({ preventScroll: true });
    });
  }

  close(): void {
    if (!this.isOpen) return;
    if (this.resumeOnClose && !this.runtimePaused()) {
      this.closeRequested = true;
      this.status.textContent = 'Returning the Atlas to its orbit…';
      if (this.closeFallbackTimer === null) {
        this.closeFallbackTimer = window.setTimeout(() => this.finishClose(false), 650);
      }
      return;
    }
    this.finishClose(this.resumeOnClose && this.runtimePaused());
  }

  dispose(): void {
    this.abortController.abort();
    if (this.closeFallbackTimer !== null) window.clearTimeout(this.closeFallbackTimer);
    for (const timer of this.transientTimers) window.clearTimeout(timer);
    this.transientTimers.clear();
    this.closeFallbackTimer = null;
    this.finishClose(false, false);
    const runtime = window as AtlasRuntimeWindow;
    if (runtime.__LAST_FIRMAMENT_ATLAS__ === this) runtime.__LAST_FIRMAMENT_ATLAS__ = undefined;
  }

  private bindInterface(): void {
    const signal = this.abortController.signal;

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-atlas-action]') : null;
        const action = target?.dataset.atlasAction;
        if (action === 'open') {
          const openedFromPlayControl = target?.dataset.gameIntent === 'pause';
          queueMicrotask(() =>
            this.open({
              resumeOnClose: openedFromPlayControl || (!this.runtimePaused() && this.hudMenuState === 'none'),
            }),
          );
        } else if (action === 'close') {
          this.close();
        }
      },
      { signal },
    );

    this.panel.addEventListener(
      'click',
      (event) => {
        const tab = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-atlas-tab]') : null;
        if (tab?.dataset.atlasTab) {
          this.selectTab(tab.dataset.atlasTab as AtlasTab);
          return;
        }
        const action = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-progression-action]')
          : null;
        if (action) this.handleProgressionAction(action);
      },
      { signal },
    );

    this.routePrompt.addEventListener(
      'click',
      (event) => {
        const button = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('[data-route-option-id]')
          : null;
        if (button) this.chooseRouteOption(button.dataset.routeOptionId ?? '');
      },
      { signal },
    );

    window.addEventListener(
      'keydown',
      (event) => this.handleKeyDown(event),
      { capture: true, signal },
    );
    window.addEventListener(
      'focusin',
      (event) => this.keepFocusInside(event),
      { capture: true, signal },
    );
    window.addEventListener(
      'celestial-game-state',
      (event) => this.handleRuntimeState((event as CustomEvent<RuntimeGameState>).detail),
      { signal },
    );
    window.addEventListener(
      HUD_MENU_STATE_EVENT,
      (event) => {
        const detail = (event as CustomEvent<HudMenuStateDetail>).detail;
        if (detail) this.hudMenuState = detail.state;
      },
      { signal },
    );
  }

  private handleRuntimeState(state: RuntimeGameState): void {
    if (!state) return;
    this.state = state;
    if (this.pendingChoiceId && state.route?.availableChoice?.id !== this.pendingChoiceId) this.pendingChoiceId = '';
    const signature = this.renderSignature(state);
    if (signature !== this.lastRenderSignature) {
      this.lastRenderSignature = signature;
      this.renderProgression();
      this.renderRouteChoice();
      this.status.textContent = '';
    }

    const offer = state.progression?.pendingOffer;
    if (offer && offer.id !== this.lastAutoOpenedOfferId && !this.isOpen && this.canOpen()) {
      this.lastAutoOpenedOfferId = offer.id;
      queueMicrotask(() => this.open({ focusReward: true }));
    }

    if (this.closeRequested && this.runtimePaused()) this.finishClose(this.resumeOnClose);
    if ((state.dead || state.victory) && this.isOpen) this.finishClose(false);
  }

  private renderSignature(state: RuntimeGameState): string {
    const progression = state.progression;
    return JSON.stringify([
      state.phase,
      progression?.level,
      progression?.experience,
      progression?.experienceToNext,
      progression?.insight,
      progression?.stardust,
      progression?.inventory.map((item) => [item.id, item.level, item.power]),
      progression?.abilities.map((ability) => [ability.id, ability.level, ability.power]),
      progression?.equippedItems,
      progression?.equippedAbilityIds,
      progression?.specs,
      progression?.pendingOffer?.id,
      state.route?.availableChoice?.id,
    ]);
  }

  private renderProgression(): void {
    const progression = this.state?.progression;
    this.originValue.textContent = this.labelize(progression?.origin ?? 'lunar-penitent');
    this.levelValue.textContent = String(progression?.level ?? 1);
    this.stardustValue.textContent = String(progression?.stardust ?? 0);
    this.insightValue.textContent = String(progression?.insight ?? 0);
    const experience = progression?.experience ?? 0;
    const experienceToNext = Math.max(1, progression?.experienceToNext ?? 100);
    this.experienceLabel.textContent = `${experience} / ${experienceToNext} experience`;
    this.experienceBar.style.setProperty('--atlas-progress', String(Math.min(1, experience / experienceToNext)));
    this.inventoryCount.textContent = `${progression?.inventory.length ?? 0} / 36`;
    this.abilityCount.textContent = `${progression?.abilities.length ?? 0} / 18`;
    const insight = progression?.insight ?? 0;
    this.specCurrency.textContent = `${insight} insight`;
    this.notice.classList.toggle('is-visible', Boolean(progression?.pendingOffer));
    this.renderReward(progression);
    this.renderGear(progression);
    this.renderSorceries(progression);
    this.renderSpecs(progression);
  }

  private renderReward(progression?: RuntimeProgressionSnapshot): void {
    const offer = progression?.pendingOffer;
    this.reward.hidden = !offer;
    this.rewardChoices.replaceChildren();
    if (!offer) return;
    this.rewardTitle.textContent = offer.title;
    this.rewardDetail.textContent = `A level ${offer.level} memory from ${this.labelize(offer.biome)}. Choose one shape.`;
    for (const choice of offer.choices) this.rewardChoices.append(this.createRewardChoice(choice, offer.id));
  }

  private createRewardChoice(choice: RewardChoice, offerId: string): HTMLElement {
    const content = choice.kind === 'item' ? choice.item : choice.ability;
    const card = this.createElement('article', `atlas-reward-card atlas-rarity--${content.rarity}`);
    const heading = this.createElement('div', 'atlas-card__heading');
    const copy = this.createElement('span');
    copy.append(
      this.createElement('small', '', choice.kind === 'item' ? SLOT_LABELS[choice.item.slot] : this.labelize(choice.ability.school)),
      this.createElement('strong', '', content.name),
    );
    heading.append(copy, this.createElement('b', '', this.labelize(content.rarity)));
    card.append(heading);
    if (choice.kind === 'item') {
      card.append(
        this.createElement('p', '', choice.item.lore),
        this.createElement('div', 'atlas-card__stats', `Power ${choice.item.power} · Level ${choice.item.level}`),
        this.createAffixList(choice.item),
      );
    } else {
      card.append(
        this.createElement('p', '', choice.ability.description),
        this.createElement(
          'div',
          'atlas-card__stats',
          `${choice.ability.glyph} Power ${choice.ability.power} · ${choice.ability.focusCost} focus · ${choice.ability.cooldownSeconds.toFixed(2)}s`,
        ),
      );
    }
    card.append(
      this.actionButton('Claim memory', 'claim-reward', {
        id: choice.id,
        offerId,
      }, false, 'atlas-action atlas-action--primary'),
    );
    return card;
  }

  private renderGear(progression?: RuntimeProgressionSnapshot): void {
    this.equipment.replaceChildren();
    this.inventory.replaceChildren();
    const items = progression?.inventory ?? [];
    for (const slot of ITEM_SLOTS) {
      const itemId = progression?.equippedItems[slot] ?? null;
      const item = items.find((candidate) => candidate.id === itemId);
      const entry = this.createElement('article', 'atlas-equipped-slot');
      entry.dataset.slot = slot;
      entry.append(
        this.createElement('span', 'atlas-equipped-slot__glyph', SLOT_GLYPHS[slot]),
        this.createElement('small', '', SLOT_LABELS[slot]),
        this.createElement('strong', '', item?.name ?? 'Empty orbit'),
        this.createElement('em', '', item ? `Power ${item.power} · Level ${item.level}` : 'No relic equipped'),
      );
      this.equipment.append(entry);
    }

    const sorted = [...items].sort((left, right) => {
      const equippedDifference = Number(this.isItemEquipped(right.id, progression)) - Number(this.isItemEquipped(left.id, progression));
      return equippedDifference || ITEM_SLOTS.indexOf(left.slot) - ITEM_SLOTS.indexOf(right.slot) || right.power - left.power;
    });
    if (sorted.length === 0) {
      this.inventory.append(this.createEmptyState('No procedural relics have entered this orbit.'));
      return;
    }
    for (const item of sorted) this.inventory.append(this.createItemCard(item, progression));
  }

  private createItemCard(item: ProceduralItem, progression?: RuntimeProgressionSnapshot): HTMLElement {
    const equipped = this.isItemEquipped(item.id, progression);
    const card = this.createElement('article', `atlas-card atlas-rarity--${item.rarity}${equipped ? ' is-equipped' : ''}`);
    const heading = this.createElement('div', 'atlas-card__heading');
    const copy = this.createElement('span');
    copy.append(this.createElement('small', '', SLOT_LABELS[item.slot]), this.createElement('strong', '', item.name));
    heading.append(copy, this.createElement('b', '', this.labelize(item.rarity)));
    const actions = this.createElement('div', 'atlas-card__actions');
    actions.append(
      this.actionButton(equipped ? 'Equipped' : 'Equip', 'equip-item', { id: item.id }, equipped),
      this.actionButton(
        item.level >= 12 ? 'Fully awakened' : `Upgrade · ${16 + item.level * 11} ✦`,
        'upgrade-item',
        { id: item.id },
        item.level >= 12 || (progression?.stardust ?? 0) < 16 + item.level * 11,
      ),
    );
    card.append(
      heading,
      this.createElement('p', '', item.lore),
      this.createElement('div', 'atlas-card__stats', `Power ${item.power} · Level ${item.level} · ${this.labelize(item.biome)}`),
      this.createAffixList(item),
      actions,
    );
    return card;
  }

  private createAffixList(item: ProceduralItem): HTMLElement {
    const list = this.createElement('ul', 'atlas-affixes');
    for (const affix of item.affixes) {
      const entry = document.createElement('li');
      entry.append(this.createElement('span', '', affix.label), this.createElement('b', '', this.formatStat(affix.stat, affix.value)));
      list.append(entry);
    }
    return list;
  }

  private renderSorceries(progression?: RuntimeProgressionSnapshot): void {
    this.loadout.replaceChildren();
    this.abilities.replaceChildren();
    const abilities = progression?.abilities ?? [];
    SLOT_KEYS.forEach((key, slot) => {
      const id = progression?.equippedAbilityIds[slot] ?? null;
      const ability = abilities.find((candidate) => candidate.id === id);
      this.renderTouchAbility(slot, ability);
      const entry = this.createElement('article', `atlas-loadout-slot${ability ? ` atlas-school--${ability.school}` : ''}`);
      entry.append(
        this.createElement('kbd', '', key),
        this.createElement('span', 'atlas-loadout-slot__glyph', ability?.glyph ?? '⊘'),
        this.createElement('strong', '', ability?.name ?? 'Unremembered'),
        this.createElement('small', '', ability ? `Power ${ability.power} · Level ${ability.level}` : 'Find another celestial art'),
      );
      this.loadout.append(entry);
    });
    if (abilities.length === 0) {
      this.abilities.append(this.createEmptyState('No sorceries have been remembered.'));
      return;
    }
    for (const ability of abilities) this.abilities.append(this.createAbilityCard(ability, progression));
  }

  private renderTouchAbility(slot: number, ability?: ProceduralAbility): void {
    const button = this.touchAbilityButtons[slot];
    if (!button) return;
    button.dataset.school = ability?.school ?? 'locked';
    button.setAttribute('aria-label', ability ? `Cast ${ability.name}` : `Cast ability slot ${slot + 1}`);
    const glyph = button.querySelector<HTMLElement>('span');
    const label = button.querySelector<HTMLElement>('small');
    if (glyph && slot < 2) glyph.textContent = ability?.glyph ?? SLOT_KEYS[slot];
    if (label) label.textContent = ability ? this.labelize(ability.school) : slot === 2 ? 'Third art' : 'Empty';
  }

  private createAbilityCard(ability: ProceduralAbility, progression?: RuntimeProgressionSnapshot): HTMLElement {
    const equippedSlot = progression?.equippedAbilityIds.indexOf(ability.id) ?? -1;
    const card = this.createElement(
      'article',
      `atlas-card atlas-rarity--${ability.rarity}${equippedSlot >= 0 ? ' is-equipped' : ''}`,
    );
    const heading = this.createElement('div', 'atlas-card__heading');
    const copy = this.createElement('span');
    copy.append(
      this.createElement('small', '', `${ability.glyph} ${this.labelize(ability.school)} ${this.labelize(ability.form)}`),
      this.createElement('strong', '', ability.name),
    );
    heading.append(copy, this.createElement('b', '', this.labelize(ability.rarity)));
    const slots = this.createElement('div', 'atlas-slot-actions');
    SLOT_KEYS.forEach((key, slot) => {
      slots.append(
        this.actionButton(
          equippedSlot === slot ? `${key} equipped` : `Equip ${key}`,
          'equip-ability',
          { id: ability.id, slot: String(slot) },
          equippedSlot === slot,
          'atlas-slot-action',
        ),
      );
    });
    const actions = this.createElement('div', 'atlas-card__actions atlas-card__actions--ability');
    actions.append(
      this.actionButton(
        ability.level >= 12 ? 'Fully awakened' : `Upgrade · ${18 + ability.level * 12} ✦`,
        'upgrade-ability',
        { id: ability.id },
        ability.level >= 12 || (progression?.stardust ?? 0) < 18 + ability.level * 12,
      ),
    );
    card.append(
      heading,
      this.createElement('p', '', ability.description),
      this.createElement(
        'div',
        'atlas-card__stats',
        `Power ${ability.power} · Level ${ability.level} · ${ability.focusCost} focus · ${ability.cooldownSeconds.toFixed(2)}s · ${this.labelize(ability.effect)}`,
      ),
      slots,
      actions,
    );
    return card;
  }

  private renderSpecs(progression?: RuntimeProgressionSnapshot): void {
    this.specs.replaceChildren();
    this.modifiers.replaceChildren();
    this.pathMarks.replaceChildren();
    for (const branch of SPEC_BRANCHES) {
      const rank = progression?.specs[branch] ?? 0;
      const meta = SPEC_META[branch];
      const card = this.createElement('article', `atlas-spec atlas-spec--${branch}`);
      const pips = this.createElement('div', 'atlas-spec__pips');
      for (let index = 0; index < 5; index += 1) {
        const pip = this.createElement('i');
        if (index < rank) pip.classList.add('is-filled');
        pips.append(pip);
      }
      card.append(
        this.createElement('span', 'atlas-spec__glyph', meta.glyph),
        this.createElement('small', '', `${rank} / 5 ranks`),
        this.createElement('h4', '', meta.name),
        this.createElement('p', '', meta.description),
        pips,
        this.actionButton(
          rank >= 5 ? 'Constellation complete' : 'Spend 1 insight',
          'allocate-spec',
          { branch },
          rank >= 5 || (progression?.insight ?? 0) <= 0,
        ),
      );
      this.specs.append(card);
    }

    const modifierEntries = Object.entries(progression?.modifiers ?? {}) as [ProgressionStat, number][];
    const activeModifiers = modifierEntries.filter(([, value]) => Math.abs(value) > 0.0001);
    if (activeModifiers.length === 0) {
      this.modifiers.append(this.createElement('span', 'atlas-modifier is-empty', 'No celestial influence yet'));
    } else {
      for (const [stat, value] of activeModifiers) {
        const entry = this.createElement('span', 'atlas-modifier');
        entry.append(this.createElement('small', '', STAT_LABELS[stat]), this.createElement('strong', '', this.formatStat(stat, value)));
        this.modifiers.append(entry);
      }
    }

    const selections = progression?.branchSelections ?? [];
    if (selections.length === 0) {
      this.pathMarks.append(this.createElement('span', 'atlas-path-mark is-empty', 'No fork has marked this pilgrimage yet'));
    } else {
      for (const selection of selections) {
        const peril = Math.round((selection.consequence.enemyPowerMultiplier - 1) * 100);
        const mark = this.createElement('article', 'atlas-path-mark');
        mark.append(
          this.createElement('strong', '', selection.label),
          this.createElement(
            'small',
            '',
            `${this.labelize(selection.consequence.affinity)} · ${this.labelize(selection.consequence.lootBias)} rewards · Peril ${peril >= 0 ? '+' : ''}${peril}%`,
          ),
          this.createElement('em', '', selection.consequence.rewardLabel),
        );
        this.pathMarks.append(mark);
      }
    }
  }

  private renderRouteChoice(): void {
    const choice = this.state?.route?.availableChoice ?? null;
    const hidden =
      !choice ||
      this.isOpen ||
      this.runtimePaused() ||
      Boolean(this.state?.dead || this.state?.victory) ||
      Boolean(document.body.dataset.frontEndState);
    this.routePrompt.hidden = hidden;
    if (!choice || hidden) return;
    if (this.pendingChoiceId && this.pendingChoiceId !== choice.id) this.pendingChoiceId = '';
    this.routePrompt.classList.toggle('is-pending', this.pendingChoiceId === choice.id);
    this.routeTitle.textContent = choice.name;
    this.routeDetail.textContent = choice.prompt;
    this.routeOptions.replaceChildren();
    choice.options.forEach((option, index) => {
      const peril = Math.round((option.consequence.enemyPowerMultiplier - 1) * 100);
      const button = this.createElement('button', 'route-choice-option') as HTMLButtonElement;
      button.type = 'button';
      button.dataset.routeOptionId = option.id;
      button.disabled = this.pendingChoiceId === choice.id;
      button.setAttribute(
        'aria-label',
        `${option.label}. ${option.description}. ${this.labelize(option.consequence.affinity)} affinity. ${this.labelize(option.consequence.lootBias)} rewards. Peril ${peril >= 0 ? 'plus' : 'minus'} ${Math.abs(peril)} percent. ${option.consequence.rewardLabel}`,
      );
      button.append(
        this.createElement('kbd', '', String(index + 1)),
        this.createElement('strong', '', option.label),
        this.createElement('small', '', option.description),
        this.createElement(
          'em',
          '',
          `${this.labelize(option.consequence.affinity)} · ${this.labelize(option.consequence.lootBias)} rewards · Peril ${peril >= 0 ? '+' : ''}${peril}% · ${option.consequence.rewardLabel}`,
        ),
      );
      this.routeOptions.append(button);
    });
  }

  private handleProgressionAction(button: HTMLButtonElement): void {
    const action = button.dataset.progressionAction as ProgressionIntentDetail['action'] | undefined;
    if (!action || button.disabled) return;
    if (action === 'dismiss-reward') {
      this.status.textContent = 'The memory remains in the Atlas until you choose.';
      this.close();
      return;
    }
    const detail: ProgressionIntentDetail = {
      action,
      ...(button.dataset.id ? { id: button.dataset.id } : {}),
      ...(button.dataset.offerId ? { offerId: button.dataset.offerId } : {}),
      ...(button.dataset.slot !== undefined ? { slot: Number(button.dataset.slot) } : {}),
      ...(button.dataset.branch ? { branch: button.dataset.branch as SpecBranch } : {}),
    };
    button.disabled = true;
    const signatureBefore = this.lastRenderSignature;
    this.status.textContent = 'The Atlas realigns…';
    window.dispatchEvent(new CustomEvent<ProgressionIntentDetail>(PROGRESSION_INTENT_EVENT, { detail }));
    this.scheduleTransient(() => {
      if (button.isConnected && this.lastRenderSignature === signatureBefore) {
        button.disabled = false;
        this.status.textContent = 'That star did not answer. Review its cost and requirements.';
      }
    }, 650);
  }

  private chooseRouteOption(optionId: string): void {
    const choice = this.state?.route?.availableChoice;
    if (!choice || !choice.options.some((option) => option.id === optionId)) return;
    this.pendingChoiceId = choice.id;
    this.renderRouteChoice();
    window.dispatchEvent(
      new CustomEvent<RouteChoiceIntentDetail>(ROUTE_CHOICE_INTENT_EVENT, {
        detail: { choiceId: choice.id, optionId },
      }),
    );
    this.scheduleTransient(() => {
      if (this.pendingChoiceId === choice.id && this.state?.route?.availableChoice?.id === choice.id) {
        this.pendingChoiceId = '';
        this.renderRouteChoice();
      }
    }, 650);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.isOpen) {
      if (event.code === 'Escape' || event.code === 'KeyI') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
        return;
      }
      if (event.key === 'Tab') this.trapTab(event);
      if (this.handleTabArrowKey(event)) return;
      event.stopImmediatePropagation();
      return;
    }

    const atlasTrigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-atlas-action="open"]') : null;
    if (atlasTrigger && (event.code === 'Enter' || event.code === 'Space')) {
      event.stopImmediatePropagation();
      return;
    }

    if (
      !this.routePrompt.hidden &&
      event.target instanceof Node &&
      this.routePrompt.contains(event.target) &&
      (event.code === 'Enter' || event.code === 'Space')
    ) {
      event.stopImmediatePropagation();
      return;
    }

    if (event.code === 'KeyI' && !isEditableTarget(event.target) && this.canOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.open();
      return;
    }

    if (!this.routePrompt.hidden && !isEditableTarget(event.target) && (event.code === 'Digit1' || event.code === 'Digit2')) {
      const choice = this.state?.route?.availableChoice;
      const option = choice?.options[event.code === 'Digit1' ? 0 : 1];
      if (option) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.chooseRouteOption(option.id);
      }
    }
  }

  private handleTabArrowKey(event: KeyboardEvent): boolean {
    const active = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[data-atlas-tab]') : null;
    if (!active || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    const index = this.tabs.indexOf(active);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? this.tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length;
    const tab = this.tabs[nextIndex];
    this.selectTab(tab.dataset.atlasTab as AtlasTab);
    tab.focus();
    return true;
  }

  private selectTab(tab: AtlasTab, focus = false): void {
    if (!['gear', 'sorceries', 'constellation'].includes(tab)) return;
    this.activeTab = tab;
    for (const button of this.tabs) {
      const active = button.dataset.atlasTab === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus({ preventScroll: true });
    }
    for (const panel of this.tabPanels) panel.hidden = panel.dataset.atlasPanel !== tab;
  }

  private trapTab(event: KeyboardEvent): void {
    const focusable = this.focusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private keepFocusInside(event: FocusEvent): void {
    if (!this.isOpen) return;
    const target = event.target;
    if (target instanceof Node && this.panel.contains(target)) return;
    this.focusableElements()[0]?.focus({ preventScroll: true });
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]') && element.getClientRects().length > 0);
  }

  private activeTabElement(): HTMLButtonElement | null {
    return this.tabs.find((tab) => tab.dataset.atlasTab === this.activeTab) ?? null;
  }

  private finishClose(resumeGame: boolean, restoreFocus = true): void {
    if (!this.isOpen && !this.menuLayerState) return;
    if (this.closeFallbackTimer !== null) window.clearTimeout(this.closeFallbackTimer);
    this.closeFallbackTimer = null;
    this.closeRequested = false;
    this.layer.hidden = true;
    this.layer.setAttribute('aria-hidden', 'true');
    delete document.body.dataset.atlasOpen;
    if (this.menuLayerState) {
      this.menuLayer.inert = this.menuLayerState.inert;
      if (this.menuLayerState.ariaHidden === null) this.menuLayer.removeAttribute('aria-hidden');
      else this.menuLayer.setAttribute('aria-hidden', this.menuLayerState.ariaHidden);
      this.menuLayerState = null;
    }
    this.renderRouteChoice();
    if (resumeGame) {
      this.pauseResumeButton.click();
      this.dispatchPauseIntent();
    }
    if (restoreFocus) {
      const previous = this.focusedBeforeOpen;
      window.requestAnimationFrame(() => {
        const restorable = previous?.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        const target = restorable && previous?.isConnected && previous.getClientRects().length > 0 && !previous.closest('[inert]')
          ? previous
          : this.atlasButton;
        target.focus({ preventScroll: true });
      });
    }
    this.focusedBeforeOpen = null;
    this.resumeOnClose = false;
    this.focusRewardOnOpen = false;
    this.status.textContent = '';
  }

  private dispatchPauseIntent(): void {
    window.dispatchEvent(new CustomEvent('celestial-game-intent', { detail: { action: 'pause', pressed: true } }));
    window.dispatchEvent(new CustomEvent('celestial-game-intent', { detail: { action: 'pause', pressed: false } }));
  }

  private runtimePaused(): boolean {
    return Boolean(this.state?.paused || this.state?.phase === 'paused');
  }

  private canOpen(): boolean {
    const phase = this.state?.phase;
    return (
      !document.body.dataset.frontEndState &&
      phase !== undefined &&
      phase !== 'menu' &&
      phase !== 'dead' &&
      phase !== 'victory'
    );
  }

  private isItemEquipped(itemId: string, progression?: RuntimeProgressionSnapshot): boolean {
    return progression ? Object.values(progression.equippedItems).includes(itemId) : false;
  }

  private actionButton(
    label: string,
    action: ProgressionIntentDetail['action'],
    data: Readonly<Record<string, string>>,
    disabled: boolean,
    className = 'atlas-action',
  ): HTMLButtonElement {
    const button = this.createElement('button', className, label) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.progressionAction = action;
    for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
    button.disabled = disabled;
    return button;
  }

  private createEmptyState(message: string): HTMLElement {
    return this.createElement('p', 'atlas-empty', message);
  }

  private scheduleTransient(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.transientTimers.delete(timer);
      callback();
    }, delay);
    this.transientTimers.add(timer);
  }

  private formatStat(stat: ProgressionStat, value: number): string {
    if (PERCENT_STATS.has(stat)) return `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1));
    return `${value >= 0 ? '+' : ''}${rounded}`;
  }

  private labelize(value: string): string {
    return value
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  private requireElement<T extends HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Star Atlas element: ${selector}`);
    return element;
  }
}
