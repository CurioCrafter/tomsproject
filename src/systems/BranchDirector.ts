import type {
  BranchEncounterDefinition,
  CampaignRouteDefinition,
  GateState,
  GateStateSnapshot,
  RouteChoiceDefinition,
  RouteChoiceOptionDefinition,
  RouteShape,
  Vec2Tuple,
} from '../game/content/RouteTypes';

export type BranchDefeatResult = Readonly<{
  accepted: boolean;
  encounterCompleted: boolean;
  encounterId: string | null;
  choiceId: string | null;
}>;

export type BranchDirectorSnapshot = Readonly<{
  version: 1;
  selections: readonly Readonly<{ choiceId: string; optionId: string }>[];
  activeEncounterId: string | null;
  completedEncounterIds: readonly string[];
  defeatedSpawnIds: readonly string[];
  gates: readonly GateStateSnapshot[];
}>;

const EPSILON = 0.000_001;

function shapeIntersectsCircle(shape: RouteShape, point: Vec2Tuple, radius: number): boolean {
  const safeRadius = Math.max(0, radius);
  const dx = point[0] - shape.center[0];
  const dz = point[1] - shape.center[1];
  if (shape.kind === 'circle') {
    const combined = shape.radius + safeRadius;
    return dx * dx + dz * dz <= combined * combined + EPSILON;
  }
  const cosine = Math.cos(shape.rotation);
  const sine = Math.sin(shape.rotation);
  const localX = cosine * dx + sine * dz;
  const localZ = -sine * dx + cosine * dz;
  const closestX = Math.max(-shape.halfExtents[0], Math.min(shape.halfExtents[0], localX));
  const closestZ = Math.max(-shape.halfExtents[1], Math.min(shape.halfExtents[1], localZ));
  const separationX = localX - closestX;
  const separationZ = localZ - closestZ;
  return separationX * separationX + separationZ * separationZ <= safeRadius * safeRadius + EPSILON;
}

function choiceIntersectsCircle(choice: RouteChoiceDefinition, point: Vec2Tuple, radius: number): boolean {
  const dx = point[0] - choice.position[0];
  const dz = point[1] - choice.position[1];
  const combined = choice.activationRadius + Math.max(0, radius);
  return dx * dx + dz * dz <= combined * combined + EPSILON;
}

export class BranchDirector {
  private readonly choices: readonly RouteChoiceDefinition[];
  private readonly encounters: readonly BranchEncounterDefinition[];
  private readonly choiceById = new Map<string, RouteChoiceDefinition>();
  private readonly encounterById = new Map<string, BranchEncounterDefinition>();
  private readonly encounterBySpawnId = new Map<string, string>();
  private readonly selections = new Map<string, string>();
  private readonly completedEncounterIds = new Set<string>();
  private readonly defeatedSpawnIds = new Set<string>();
  private activeEncounterId: string | null = null;

  constructor(private readonly route: CampaignRouteDefinition) {
    this.choices = route.choices ?? [];
    this.encounters = route.branchEncounters ?? [];
    this.choices.forEach((choice) => this.choiceById.set(choice.id, choice));
    this.encounters.forEach((encounter) => {
      this.encounterById.set(encounter.id, encounter);
      encounter.spawns.forEach((spawn) => this.encounterBySpawnId.set(spawn.id, encounter.id));
    });
    this.assertReferences();
  }

  get activeEncounter(): BranchEncounterDefinition | null {
    return this.activeEncounterId ? this.encounterById.get(this.activeEncounterId) ?? null : null;
  }

  get objective(): string | null {
    return this.activeEncounter?.objective ?? null;
  }

  reset(): void {
    this.selections.clear();
    this.completedEncounterIds.clear();
    this.defeatedSpawnIds.clear();
    this.activeEncounterId = null;
  }

  restoreAfterDeath(): void {
    this.activeEncounterId = null;
    this.defeatedSpawnIds.clear();
  }

  findAvailableChoiceAt(point: Vec2Tuple, radius = 0): RouteChoiceDefinition | null {
    if (this.activeEncounterId) return null;
    return this.choices.find((choice) => !this.selections.has(choice.id) && choiceIntersectsCircle(choice, point, radius)) ?? null;
  }

  selectOption(choiceId: string, optionId: string): RouteChoiceOptionDefinition | null {
    if (this.selections.has(choiceId)) return null;
    const choice = this.choiceById.get(choiceId);
    const option = choice?.options.find((candidate) => candidate.id === optionId);
    if (!choice || !option) return null;
    this.selections.set(choiceId, option.id);
    return option;
  }

  getSelectedOption(choiceId: string): RouteChoiceOptionDefinition | null {
    const choice = this.choiceById.get(choiceId);
    const optionId = this.selections.get(choiceId);
    return choice?.options.find((option) => option.id === optionId) ?? null;
  }

  activateSelectedEncounterAt(point: Vec2Tuple, radius = 0): string | null {
    if (this.activeEncounterId) return null;
    for (const choice of this.choices) {
      const option = this.getSelectedOption(choice.id);
      if (!option || this.completedEncounterIds.has(option.encounterId)) continue;
      const encounter = this.encounterById.get(option.encounterId);
      if (!encounter || !shapeIntersectsCircle(encounter.activation, point, radius)) continue;
      this.activeEncounterId = encounter.id;
      this.defeatedSpawnIds.clear();
      return encounter.id;
    }
    return null;
  }

  isEnemyEnabled(spawnId: string): boolean {
    return this.activeEncounterId !== null && this.encounterBySpawnId.get(spawnId) === this.activeEncounterId && !this.defeatedSpawnIds.has(spawnId);
  }

  getEncounterState(encounterId: string): 'locked' | 'available' | 'active' | 'cleared' {
    if (this.completedEncounterIds.has(encounterId)) return 'cleared';
    if (this.activeEncounterId === encounterId) return 'active';
    const encounter = this.encounterById.get(encounterId);
    if (!encounter) throw new Error(`Unknown branch encounter "${encounterId}".`);
    return this.selections.get(encounter.choiceId) === encounter.optionId ? 'available' : 'locked';
  }

  markEnemyDefeated(spawnId: string): BranchDefeatResult {
    const encounter = this.activeEncounter;
    if (!encounter || this.encounterBySpawnId.get(spawnId) !== encounter.id || this.defeatedSpawnIds.has(spawnId)) {
      return { accepted: false, encounterCompleted: false, encounterId: null, choiceId: null };
    }
    this.defeatedSpawnIds.add(spawnId);
    const encounterCompleted = encounter.spawns.every((spawn) => this.defeatedSpawnIds.has(spawn.id));
    if (encounterCompleted) {
      this.completedEncounterIds.add(encounter.id);
      this.activeEncounterId = null;
      this.defeatedSpawnIds.clear();
    }
    return { accepted: true, encounterCompleted, encounterId: encounter.id, choiceId: encounter.choiceId };
  }

  getGateOverrides(): readonly GateStateSnapshot[] {
    const states = new Map<string, GateState>();
    for (const choice of this.choices) {
      const selected = this.getSelectedOption(choice.id);
      const completed = selected ? this.completedEncounterIds.has(selected.encounterId) : false;
      states.set(choice.directGateId, completed ? 'open' : 'closed');
      for (const option of choice.options) {
        states.set(option.entryGateId, selected?.id === option.id ? 'open' : 'closed');
        states.set(option.exitGateId, selected?.id === option.id && completed ? 'open' : 'closed');
      }
    }
    return [...states].map(([id, state]) => ({ id, state }));
  }

  getSnapshot(): BranchDirectorSnapshot {
    return {
      version: 1,
      selections: this.choices
        .filter((choice) => this.selections.has(choice.id))
        .map((choice) => ({ choiceId: choice.id, optionId: this.selections.get(choice.id) as string })),
      activeEncounterId: this.activeEncounterId,
      completedEncounterIds: this.encounters.filter((encounter) => this.completedEncounterIds.has(encounter.id)).map((encounter) => encounter.id),
      defeatedSpawnIds: [...this.defeatedSpawnIds],
      gates: this.getGateOverrides(),
    };
  }

  private assertReferences(): void {
    const gateIds = new Set(this.route.gates.map((gate) => gate.id));
    const sectionIds = new Set([
      ...this.route.sections.map((section) => section.id),
      ...(this.route.branchSections ?? []).map((section) => section.id),
    ]);
    for (const choice of this.choices) {
      if (!sectionIds.has(choice.sectionId)) throw new Error(`Branch choice "${choice.id}" uses an unknown section.`);
      if (!gateIds.has(choice.directGateId)) throw new Error(`Branch choice "${choice.id}" uses an unknown direct gate.`);
      for (const option of choice.options) {
        if (!gateIds.has(option.entryGateId)) throw new Error(`Branch option "${option.id}" uses an unknown entry gate.`);
        if (!gateIds.has(option.exitGateId)) throw new Error(`Branch option "${option.id}" uses an unknown exit gate.`);
        if (!this.encounterById.has(option.encounterId)) throw new Error(`Branch option "${option.id}" uses an unknown encounter.`);
        option.sectionIds.forEach((sectionId) => {
          if (!sectionIds.has(sectionId)) throw new Error(`Branch option "${option.id}" uses an unknown section "${sectionId}".`);
        });
      }
    }
    for (const encounter of this.encounters) {
      const choice = this.choiceById.get(encounter.choiceId);
      if (!choice?.options.some((option) => option.id === encounter.optionId && option.encounterId === encounter.id)) {
        throw new Error(`Branch encounter "${encounter.id}" is not owned by its declared choice option.`);
      }
    }
  }
}
