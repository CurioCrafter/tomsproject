export type Vec2Tuple = readonly [x: number, z: number];

export type RouteSectionKind =
  | 'safe'
  | 'processional'
  | 'bridge'
  | 'court'
  | 'refuge'
  | 'causeway'
  | 'boss-arena';

export type RouteRelicKind = 'moon' | 'aurora' | 'constellation';

export type RouteEnemyKind =
  | 'wisp'
  | 'sentinel'
  | 'seer'
  | 'ashenInitiate'
  | 'astralLancer'
  | 'eclipseChorister'
  | 'orreryCastellan'
  | 'eclipseArchon';

export type EnemyImplementationState = 'existing' | 'planned';
export type EnemyEncounterRole = 'skirmisher' | 'guard' | 'artillery' | 'charger' | 'support' | 'boss';
export type GateState = 'open' | 'closed';
export type EncounterState = 'locked' | 'available' | 'active' | 'cleared';
export type CheckpointState = 'locked' | 'available' | 'activated' | 'current';

export type CircleRouteShape = {
  readonly kind: 'circle';
  readonly center: Vec2Tuple;
  readonly radius: number;
};

export type ObbRouteShape = {
  readonly kind: 'obb';
  readonly center: Vec2Tuple;
  readonly halfExtents: Vec2Tuple;
  /** Rotation around world-up in radians. */
  readonly rotation: number;
};

export type RouteShape = CircleRouteShape | ObbRouteShape;

export type ThickSegmentCollider = {
  readonly a: Vec2Tuple;
  readonly b: Vec2Tuple;
  /** Full collider thickness in world units. */
  readonly thickness: number;
};

export type RouteAnchorDefinition = {
  readonly id: string;
  readonly position: Vec2Tuple;
};

export type RouteSectionDefinition = {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly kind: RouteSectionKind;
  readonly safe: boolean;
  readonly connectsTo: readonly string[];
  readonly walkable: readonly RouteShape[];
  readonly cameraForward: Vec2Tuple;
  readonly enemyAnchors: readonly RouteAnchorDefinition[];
};

export type GateDefinition = {
  readonly id: string;
  readonly name: string;
  readonly sectionId: string;
  readonly collider: ThickSegmentCollider;
  readonly initialState: GateState;
};

export type EnemySpawnDefinition = {
  readonly id: string;
  readonly kind: RouteEnemyKind;
  readonly implementation: EnemyImplementationState;
  readonly role: EnemyEncounterRole;
  readonly sectionId: string;
  readonly position: Vec2Tuple;
  readonly facingRadians: number;
  readonly leashSectionIds: readonly string[];
  readonly anchorId?: string;
  readonly wakeDelaySeconds?: number;
};

export type EncounterDefinition = {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly sectionIds: readonly string[];
  readonly activation: RouteShape;
  readonly rearGateId?: string;
  readonly exitGateId?: string;
  readonly spawns: readonly EnemySpawnDefinition[];
  readonly boss: 'none' | 'midpoint' | 'final';
  readonly objective: string;
};

export type CheckpointDefinition = {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly sectionId: string;
  readonly position: Vec2Tuple;
  readonly facingRadians: number;
  readonly activationRadius: number;
  readonly relicKind: RouteRelicKind;
  readonly unlocksAfterEncounterId: string;
};

export type RouteStartDefinition = {
  readonly sectionId: string;
  readonly position: Vec2Tuple;
  readonly facingRadians: number;
};

export type RouteRequirements = {
  readonly encounterCount: number;
  readonly minimumBridgeSections: number;
  readonly relicOrder: readonly RouteRelicKind[];
  readonly enemyKinds: readonly RouteEnemyKind[];
};

export type CampaignRouteDefinition = {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly start: RouteStartDefinition;
  readonly requirements: RouteRequirements;
  readonly sections: readonly RouteSectionDefinition[];
  readonly gates: readonly GateDefinition[];
  readonly checkpoints: readonly CheckpointDefinition[];
  readonly encounters: readonly EncounterDefinition[];
};

export type GateStateSnapshot = {
  readonly id: string;
  readonly state: GateState;
};

export type EncounterStateSnapshot = {
  readonly id: string;
  readonly state: EncounterState;
};

export type CheckpointStateSnapshot = {
  readonly id: string;
  readonly state: CheckpointState;
};

export type EncounterDirectorSnapshot = {
  readonly version: 1;
  readonly activeEncounterId: string | null;
  readonly nextEncounterId: string | null;
  readonly currentCheckpointId: string | null;
  /** Number of encounters retained when restoring the current checkpoint. */
  readonly checkpointCompletedEncounterCount: number;
  readonly completedEncounterIds: readonly string[];
  readonly defeatedSpawnIds: readonly string[];
  readonly encounters: readonly EncounterStateSnapshot[];
  readonly checkpoints: readonly CheckpointStateSnapshot[];
  readonly gates: readonly GateStateSnapshot[];
  readonly campaignComplete: boolean;
};
