import type {
  CampaignRouteDefinition,
  CheckpointDefinition,
  CheckpointState,
  EncounterDefinition,
  EncounterDirectorSnapshot,
  EncounterState,
  GateState,
  GateStateSnapshot,
  RouteShape,
  Vec2Tuple,
} from '../game/content/RouteTypes';
import { assertValidRouteDefinition } from '../game/content/validateRoute';

export type EncounterDirectorUpdate = {
  readonly activatedEncounterId: string | null;
  readonly activatedCheckpointId: string | null;
};

export type EnemyDefeatResult = {
  readonly accepted: boolean;
  readonly encounterCompleted: boolean;
};

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

function checkpointIntersectsCircle(checkpoint: CheckpointDefinition, point: Vec2Tuple, radius: number): boolean {
  const dx = point[0] - checkpoint.position[0];
  const dz = point[1] - checkpoint.position[1];
  const combined = checkpoint.activationRadius + Math.max(0, radius);
  return dx * dx + dz * dz <= combined * combined + EPSILON;
}

function arraysEqual<T>(first: readonly T[], second: readonly T[], compare: (a: T, b: T) => boolean): boolean {
  return first.length === second.length && first.every((value, index) => compare(value, second[index]));
}

export class EncounterDirector {
  private readonly encounterById = new Map<string, EncounterDefinition>();
  private readonly spawnEncounterId = new Map<string, string>();
  private readonly gateStates = new Map<string, GateState>();
  private readonly defeatedSpawnIds = new Set<string>();
  private completedEncounterCount = 0;
  private activeEncounterId: string | null = null;
  private currentCheckpointIndex = -1;
  private checkpointCompletedEncounterCount = 0;

  constructor(readonly route: CampaignRouteDefinition) {
    assertValidRouteDefinition(route);
    route.encounters.forEach((encounter) => {
      this.encounterById.set(encounter.id, encounter);
      encounter.spawns.forEach((spawn) => this.spawnEncounterId.set(spawn.id, encounter.id));
    });
    this.reset();
  }

  get activeEncounter(): EncounterDefinition | null {
    return this.activeEncounterId ? this.encounterById.get(this.activeEncounterId) ?? null : null;
  }

  get nextEncounter(): EncounterDefinition | null {
    return this.route.encounters[this.completedEncounterCount] ?? null;
  }

  get currentCheckpoint(): CheckpointDefinition | null {
    return this.currentCheckpointIndex >= 0 ? this.route.checkpoints[this.currentCheckpointIndex] ?? null : null;
  }

  get campaignComplete(): boolean {
    return this.completedEncounterCount === this.route.encounters.length && this.activeEncounterId === null;
  }

  get objective(): string {
    return this.activeEncounter?.objective ?? this.nextEncounter?.objective ?? 'The firmament remembers';
  }

  reset(): void {
    this.completedEncounterCount = 0;
    this.activeEncounterId = null;
    this.currentCheckpointIndex = -1;
    this.checkpointCompletedEncounterCount = 0;
    this.defeatedSpawnIds.clear();
    this.applyGateStates(this.deriveGateStates(0, null));
  }

  /** Restores the last activated relic checkpoint and resets all later encounters. */
  restoreLastCheckpoint(): EncounterDirectorSnapshot {
    this.completedEncounterCount = this.checkpointCompletedEncounterCount;
    this.activeEncounterId = null;
    this.defeatedSpawnIds.clear();
    this.applyGateStates(this.deriveGateStates(this.completedEncounterCount, null));
    return this.getSnapshot();
  }

  updatePlayerPosition(position: Vec2Tuple, radius = 0): EncounterDirectorUpdate {
    const activatedCheckpointId = this.activateCheckpointAt(position, radius);
    const activatedEncounterId = this.activateNextEncounterAt(position, radius);
    return { activatedEncounterId, activatedCheckpointId };
  }

  activateNextEncounterAt(position: Vec2Tuple, radius = 0): string | null {
    if (this.activeEncounterId) return null;
    const encounter = this.nextEncounter;
    if (!encounter || !shapeIntersectsCircle(encounter.activation, position, radius)) return null;
    return this.activateEncounter(encounter.id) ? encounter.id : null;
  }

  activateEncounter(encounterId: string): boolean {
    if (this.activeEncounterId) return false;
    const encounter = this.nextEncounter;
    if (!encounter || encounter.id !== encounterId) return false;
    this.activeEncounterId = encounter.id;
    this.defeatedSpawnIds.clear();
    this.applyGateStates(this.deriveGateStates(this.completedEncounterCount, encounter.id));
    return true;
  }

  completeEncounter(encounterId: string): boolean {
    if (this.activeEncounterId !== encounterId) return false;
    this.completedEncounterCount += 1;
    this.activeEncounterId = null;
    this.defeatedSpawnIds.clear();
    this.applyGateStates(this.deriveGateStates(this.completedEncounterCount, null));
    return true;
  }

  /**
   * Makes the currently cleared encounter prefix survive death without moving
   * the player's physical relic checkpoint. Used for one-time boss victories,
   * whose rewards must never coexist with a respawned boss.
   */
  commitProgressBoundary(): boolean {
    if (this.activeEncounterId !== null) return false;
    this.checkpointCompletedEncounterCount = Math.max(
      this.checkpointCompletedEncounterCount,
      this.completedEncounterCount,
    );
    return true;
  }

  markEnemyDefeated(spawnId: string): EnemyDefeatResult {
    const encounter = this.activeEncounter;
    if (!encounter || this.spawnEncounterId.get(spawnId) !== encounter.id || this.defeatedSpawnIds.has(spawnId)) {
      return { accepted: false, encounterCompleted: false };
    }
    this.defeatedSpawnIds.add(spawnId);
    const encounterCompleted = encounter.spawns.every((spawn) => this.defeatedSpawnIds.has(spawn.id));
    if (encounterCompleted) this.completeEncounter(encounter.id);
    return { accepted: true, encounterCompleted };
  }

  isEnemyEnabled(spawnId: string): boolean {
    return this.activeEncounterId !== null && this.spawnEncounterId.get(spawnId) === this.activeEncounterId && !this.defeatedSpawnIds.has(spawnId);
  }

  getEncounterState(encounterId: string): EncounterState {
    const encounter = this.encounterById.get(encounterId);
    if (!encounter) throw new Error(`Unknown encounter "${encounterId}".`);
    return this.deriveEncounterState(encounter.order, this.completedEncounterCount, this.activeEncounterId);
  }

  getGateState(gateId: string): GateState {
    const state = this.gateStates.get(gateId);
    if (!state) throw new Error(`Unknown gate "${gateId}".`);
    return state;
  }

  isGateClosed(gateId: string): boolean {
    return this.getGateState(gateId) === 'closed';
  }

  findAvailableCheckpointAt(position: Vec2Tuple, radius = 0): CheckpointDefinition | null {
    if (this.activeEncounterId) return null;
    const checkpoint = this.route.checkpoints[this.currentCheckpointIndex + 1];
    if (!checkpoint || !this.isCheckpointUnlocked(checkpoint)) return null;
    return checkpointIntersectsCircle(checkpoint, position, radius) ? checkpoint : null;
  }

  activateCheckpointAt(position: Vec2Tuple, radius = 0): string | null {
    const checkpoint = this.findAvailableCheckpointAt(position, radius);
    if (!checkpoint) return null;
    return this.activateCheckpoint(checkpoint.id) ? checkpoint.id : null;
  }

  activateCheckpoint(checkpointId: string): boolean {
    if (this.activeEncounterId) return false;
    const checkpoint = this.route.checkpoints[this.currentCheckpointIndex + 1];
    if (!checkpoint || checkpoint.id !== checkpointId || !this.isCheckpointUnlocked(checkpoint)) return false;
    this.currentCheckpointIndex += 1;
    this.checkpointCompletedEncounterCount = this.completedEncounterCount;
    return true;
  }

  getSnapshot(): EncounterDirectorSnapshot {
    return this.buildSnapshot(
      this.completedEncounterCount,
      this.activeEncounterId,
      this.currentCheckpointIndex,
      this.checkpointCompletedEncounterCount,
      [...this.defeatedSpawnIds],
      this.gateStates,
    );
  }

  /** Restores a serialized snapshot only when every derived state is internally consistent. */
  restore(snapshot: EncounterDirectorSnapshot): void {
    if (snapshot.version !== 1) throw new Error(`Unsupported encounter snapshot version "${snapshot.version}".`);
    const completedCount = snapshot.completedEncounterIds.length;
    if (completedCount > this.route.encounters.length) throw new Error('Snapshot completes more encounters than the route contains.');
    const expectedCompletedIds = this.route.encounters.slice(0, completedCount).map((encounter) => encounter.id);
    if (!arraysEqual(snapshot.completedEncounterIds, expectedCompletedIds, (a, b) => a === b)) {
      throw new Error('Completed encounters must be a strict prefix of the campaign route.');
    }

    const expectedNextId = this.route.encounters[completedCount]?.id ?? null;
    if (snapshot.nextEncounterId !== expectedNextId) throw new Error('Snapshot next encounter is inconsistent with completed progress.');
    if (snapshot.activeEncounterId !== null && snapshot.activeEncounterId !== expectedNextId) {
      throw new Error('Only the next ordered encounter may be active.');
    }

    let checkpointIndex = -1;
    if (snapshot.currentCheckpointId !== null) {
      checkpointIndex = this.route.checkpoints.findIndex((checkpoint) => checkpoint.id === snapshot.currentCheckpointId);
      if (checkpointIndex < 0) throw new Error(`Snapshot references unknown checkpoint "${snapshot.currentCheckpointId}".`);
    }
    const checkpointCompletedCount = snapshot.checkpointCompletedEncounterCount;
    if (!Number.isInteger(checkpointCompletedCount) || checkpointCompletedCount < 0 || checkpointCompletedCount > completedCount) {
      throw new Error('Checkpoint encounter count is outside completed progress.');
    }
    if (checkpointIndex < 0 && checkpointCompletedCount !== 0) throw new Error('A missing checkpoint cannot retain encounter progress.');
    if (checkpointIndex >= 0) {
      const checkpoint = this.route.checkpoints[checkpointIndex];
      const unlockOrder = this.encounterById.get(checkpoint.unlocksAfterEncounterId)?.order ?? Number.POSITIVE_INFINITY;
      if (checkpointCompletedCount <= unlockOrder) throw new Error('Checkpoint snapshot predates its unlock encounter.');
    }

    const activeEncounter = snapshot.activeEncounterId ? this.encounterById.get(snapshot.activeEncounterId) ?? null : null;
    if (!activeEncounter && snapshot.defeatedSpawnIds.length > 0) throw new Error('Defeated active spawns require an active encounter.');
    const defeated = new Set(snapshot.defeatedSpawnIds);
    if (defeated.size !== snapshot.defeatedSpawnIds.length) throw new Error('Defeated spawn IDs must be unique.');
    if (activeEncounter) {
      const validSpawnIds = new Set(activeEncounter.spawns.map((spawn) => spawn.id));
      for (const spawnId of defeated) {
        if (!validSpawnIds.has(spawnId)) throw new Error(`Defeated spawn "${spawnId}" does not belong to the active encounter.`);
      }
      if (defeated.size === activeEncounter.spawns.length) throw new Error('A fully defeated encounter must be completed, not active.');
    }

    const derivedGates = this.deriveGateStates(completedCount, snapshot.activeEncounterId);
    const expected = this.buildSnapshot(
      completedCount,
      snapshot.activeEncounterId,
      checkpointIndex,
      checkpointCompletedCount,
      snapshot.defeatedSpawnIds,
      derivedGates,
    );
    if (!arraysEqual(snapshot.gates, expected.gates, (a, b) => a.id === b.id && a.state === b.state)) {
      throw new Error('Snapshot gate states are inconsistent with encounter progress.');
    }
    if (!arraysEqual(snapshot.encounters, expected.encounters, (a, b) => a.id === b.id && a.state === b.state)) {
      throw new Error('Snapshot encounter states are inconsistent with encounter progress.');
    }
    if (!arraysEqual(snapshot.checkpoints, expected.checkpoints, (a, b) => a.id === b.id && a.state === b.state)) {
      throw new Error('Snapshot checkpoint states are inconsistent with encounter progress.');
    }
    if (snapshot.campaignComplete !== expected.campaignComplete) throw new Error('Snapshot completion flag is inconsistent with encounter progress.');

    this.completedEncounterCount = completedCount;
    this.activeEncounterId = snapshot.activeEncounterId;
    this.currentCheckpointIndex = checkpointIndex;
    this.checkpointCompletedEncounterCount = checkpointCompletedCount;
    this.defeatedSpawnIds.clear();
    snapshot.defeatedSpawnIds.forEach((spawnId) => this.defeatedSpawnIds.add(spawnId));
    this.applyGateStates(derivedGates);
  }

  private isCheckpointUnlocked(checkpoint: CheckpointDefinition): boolean {
    const encounter = this.encounterById.get(checkpoint.unlocksAfterEncounterId);
    return Boolean(encounter && encounter.order < this.completedEncounterCount);
  }

  private deriveGateStates(completedCount: number, activeEncounterId: string | null): Map<string, GateState> {
    const states = new Map(this.route.gates.map((gate) => [gate.id, gate.initialState] as const));
    for (let index = 0; index < completedCount; index += 1) {
      const encounter = this.route.encounters[index];
      if (encounter.rearGateId) states.set(encounter.rearGateId, 'open');
      if (encounter.exitGateId) states.set(encounter.exitGateId, 'open');
    }
    if (activeEncounterId) {
      const encounter = this.encounterById.get(activeEncounterId);
      if (encounter?.rearGateId) states.set(encounter.rearGateId, 'closed');
      if (encounter?.exitGateId) states.set(encounter.exitGateId, 'closed');
    }
    return states;
  }

  private deriveEncounterState(order: number, completedCount: number, activeEncounterId: string | null): EncounterState {
    if (order < completedCount) return 'cleared';
    const encounter = this.route.encounters[order];
    if (encounter?.id === activeEncounterId) return 'active';
    if (order === completedCount) return 'available';
    return 'locked';
  }

  private deriveCheckpointState(
    order: number,
    currentCheckpointIndex: number,
    completedCount: number,
    activeEncounterId: string | null,
  ): CheckpointState {
    if (order < currentCheckpointIndex) return 'activated';
    if (order === currentCheckpointIndex) return 'current';
    if (order !== currentCheckpointIndex + 1 || activeEncounterId) return 'locked';
    const checkpoint = this.route.checkpoints[order];
    const encounter = checkpoint ? this.encounterById.get(checkpoint.unlocksAfterEncounterId) : null;
    return encounter && encounter.order < completedCount ? 'available' : 'locked';
  }

  private buildSnapshot(
    completedCount: number,
    activeEncounterId: string | null,
    currentCheckpointIndex: number,
    checkpointCompletedCount: number,
    defeatedSpawnIds: readonly string[],
    gateStates: ReadonlyMap<string, GateState>,
  ): EncounterDirectorSnapshot {
    const completedEncounterIds = this.route.encounters.slice(0, completedCount).map((encounter) => encounter.id);
    const activeSpawnOrder = new Map((activeEncounterId ? this.encounterById.get(activeEncounterId)?.spawns ?? [] : []).map((spawn, index) => [spawn.id, index]));
    const orderedDefeated = [...defeatedSpawnIds].sort((a, b) => (activeSpawnOrder.get(a) ?? 0) - (activeSpawnOrder.get(b) ?? 0));
    const gates: GateStateSnapshot[] = this.route.gates.map((gate) => ({ id: gate.id, state: gateStates.get(gate.id) ?? gate.initialState }));
    return {
      version: 1,
      activeEncounterId,
      nextEncounterId: this.route.encounters[completedCount]?.id ?? null,
      currentCheckpointId: currentCheckpointIndex >= 0 ? this.route.checkpoints[currentCheckpointIndex]?.id ?? null : null,
      checkpointCompletedEncounterCount: checkpointCompletedCount,
      completedEncounterIds,
      defeatedSpawnIds: orderedDefeated,
      encounters: this.route.encounters.map((encounter) => ({
        id: encounter.id,
        state: this.deriveEncounterState(encounter.order, completedCount, activeEncounterId),
      })),
      checkpoints: this.route.checkpoints.map((checkpoint) => ({
        id: checkpoint.id,
        state: this.deriveCheckpointState(checkpoint.order, currentCheckpointIndex, completedCount, activeEncounterId),
      })),
      gates,
      campaignComplete: completedCount === this.route.encounters.length && activeEncounterId === null,
    };
  }

  private applyGateStates(states: ReadonlyMap<string, GateState>): void {
    this.gateStates.clear();
    this.route.gates.forEach((gate) => this.gateStates.set(gate.id, states.get(gate.id) ?? gate.initialState));
  }
}
