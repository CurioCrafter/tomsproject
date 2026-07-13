import type {
  BranchEncounterDefinition,
  CampaignRouteDefinition,
  EnemySpawnDefinition,
  ObbRouteShape,
  RouteBranchSectionDefinition,
  RouteSectionDefinition,
  RouteShape,
  ThickSegmentCollider,
  Vec2Tuple,
} from './RouteTypes';

export type RouteValidationIssue = {
  readonly path: string;
  readonly message: string;
};

const EPSILON = 0.000_001;

export const ROUTE_GATE_PARTITION_PLAYER_RADIUS = 0.52;
export const ROUTE_MIN_GATE_SEPARATION = 0.9;
export const ROUTE_MIN_SPAWN_SEPARATION = 1.75;
export const ROUTE_INTERACTION_CLEARANCE = 0.5;
export const ROUTE_MIN_SPAWN_CHECKPOINT_DISTANCE = 2.5;

export type RouteGatePartitionProbeOptions = {
  /** Grid spacing in world units. Lower values are more precise and more expensive. */
  readonly resolution?: number;
  /** Radius of the largest player body that must be contained by the route. */
  readonly playerRadius?: number;
  /**
   * Amount removed from the physical gate capsule during validation. Requiring
   * a gate to partition with a slightly smaller capsule gives endpoint overlap
   * enough tolerance for floating-point and authored-layout drift.
   */
  readonly gateClearanceMargin?: number;
  /** Hard guard against accidentally rasterizing an unbounded or enormous route. */
  readonly maximumCellCount?: number;
};

export type RouteGatePartitionProbeResult = {
  readonly checkedGateIds: readonly string[];
  readonly bypassableGateIds: readonly string[];
  readonly baselineReachable: boolean;
  readonly resolution: number;
  readonly playerRadius: number;
  readonly gateClearanceMargin: number;
  readonly cellCount: number;
};

const DEFAULT_GATE_PARTITION_RESOLUTION = 0.2;
const DEFAULT_GATE_CLEARANCE_MARGIN = 0.04;
const DEFAULT_MAXIMUM_PARTITION_CELLS = 250_000;
const defaultGatePartitionProbeCache = new WeakMap<CampaignRouteDefinition, RouteGatePartitionProbeResult>();

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finitePoint(point: Vec2Tuple): boolean {
  return finite(point[0]) && finite(point[1]);
}

function shapeCenter(shape: RouteShape): Vec2Tuple {
  return shape.center;
}

function routeShapeContainsCoordinates(shape: RouteShape, x: number, z: number, radius = 0): boolean {
  const safeRadius = Math.max(0, radius);
  const dx = x - shape.center[0];
  const dz = z - shape.center[1];
  if (shape.kind === 'circle') {
    const allowed = shape.radius - safeRadius;
    return allowed >= 0 && dx * dx + dz * dz <= allowed * allowed + EPSILON;
  }

  const cosine = Math.cos(shape.rotation);
  const sine = Math.sin(shape.rotation);
  const localX = cosine * dx + sine * dz;
  const localZ = -sine * dx + cosine * dz;
  return (
    Math.abs(localX) <= shape.halfExtents[0] - safeRadius + EPSILON &&
    Math.abs(localZ) <= shape.halfExtents[1] - safeRadius + EPSILON
  );
}

export function routeShapeContainsPoint(shape: RouteShape, point: Vec2Tuple, radius = 0): boolean {
  return routeShapeContainsCoordinates(shape, point[0], point[1], radius);
}

type AnyRouteSection = RouteSectionDefinition | RouteBranchSectionDefinition;

function pointInSection(section: AnyRouteSection, point: Vec2Tuple, radius = 0): boolean {
  return section.walkable.some((shape) => routeShapeContainsPoint(shape, point, radius));
}

function circleObbOverlap(circle: Extract<RouteShape, { kind: 'circle' }>, obb: ObbRouteShape): boolean {
  const dx = circle.center[0] - obb.center[0];
  const dz = circle.center[1] - obb.center[1];
  const cosine = Math.cos(obb.rotation);
  const sine = Math.sin(obb.rotation);
  const localX = cosine * dx + sine * dz;
  const localZ = -sine * dx + cosine * dz;
  const closestX = Math.max(-obb.halfExtents[0], Math.min(obb.halfExtents[0], localX));
  const closestZ = Math.max(-obb.halfExtents[1], Math.min(obb.halfExtents[1], localZ));
  const separationX = localX - closestX;
  const separationZ = localZ - closestZ;
  return separationX * separationX + separationZ * separationZ <= circle.radius * circle.radius + EPSILON;
}

function obbAxes(shape: ObbRouteShape): readonly [Vec2Tuple, Vec2Tuple] {
  const cosine = Math.cos(shape.rotation);
  const sine = Math.sin(shape.rotation);
  return [[cosine, sine], [-sine, cosine]];
}

function dot(a: Vec2Tuple, b: Vec2Tuple): number {
  return a[0] * b[0] + a[1] * b[1];
}

function obbOverlap(first: ObbRouteShape, second: ObbRouteShape): boolean {
  const firstAxes = obbAxes(first);
  const secondAxes = obbAxes(second);
  const centerDelta: Vec2Tuple = [second.center[0] - first.center[0], second.center[1] - first.center[1]];
  const axes = [...firstAxes, ...secondAxes];

  for (const axis of axes) {
    const distance = Math.abs(dot(centerDelta, axis));
    const firstRadius =
      first.halfExtents[0] * Math.abs(dot(firstAxes[0], axis)) +
      first.halfExtents[1] * Math.abs(dot(firstAxes[1], axis));
    const secondRadius =
      second.halfExtents[0] * Math.abs(dot(secondAxes[0], axis)) +
      second.halfExtents[1] * Math.abs(dot(secondAxes[1], axis));
    if (distance > firstRadius + secondRadius + EPSILON) return false;
  }
  return true;
}

export function routeShapesOverlap(first: RouteShape, second: RouteShape): boolean {
  if (first.kind === 'circle' && second.kind === 'circle') {
    const dx = first.center[0] - second.center[0];
    const dz = first.center[1] - second.center[1];
    const radius = first.radius + second.radius;
    return dx * dx + dz * dz <= radius * radius + EPSILON;
  }
  if (first.kind === 'circle' && second.kind === 'obb') return circleObbOverlap(first, second);
  if (first.kind === 'obb' && second.kind === 'circle') return circleObbOverlap(second, first);
  return obbOverlap(first as ObbRouteShape, second as ObbRouteShape);
}

export function routeShapesOverlapForRadius(first: RouteShape, second: RouteShape, radius: number): boolean {
  const inset = (shape: RouteShape): RouteShape | null => {
    const safeRadius = Math.max(0, radius);
    if (shape.kind === 'circle') {
      const nextRadius = shape.radius - safeRadius;
      return nextRadius > 0 ? { ...shape, radius: nextRadius } : null;
    }
    const halfX = shape.halfExtents[0] - safeRadius;
    const halfZ = shape.halfExtents[1] - safeRadius;
    return halfX > 0 && halfZ > 0 ? { ...shape, halfExtents: [halfX, halfZ] } : null;
  };
  const firstInset = inset(first);
  const secondInset = inset(second);
  return Boolean(firstInset && secondInset && routeShapesOverlap(firstInset, secondInset));
}

function pointToSegmentDistanceSquared(
  x: number,
  z: number,
  a: Vec2Tuple,
  b: Vec2Tuple,
): number {
  const segmentX = b[0] - a[0];
  const segmentZ = b[1] - a[1];
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  const parameter = lengthSquared <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, ((x - a[0]) * segmentX + (z - a[1]) * segmentZ) / lengthSquared));
  const closestX = a[0] + segmentX * parameter;
  const closestZ = a[1] + segmentZ * parameter;
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz;
}

function segmentOrientation(a: Vec2Tuple, b: Vec2Tuple, c: Vec2Tuple): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: Vec2Tuple, a: Vec2Tuple, b: Vec2Tuple): boolean {
  return (
    Math.abs(segmentOrientation(a, b, point)) <= EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function segmentsIntersect(first: ThickSegmentCollider, second: ThickSegmentCollider): boolean {
  const firstA = segmentOrientation(first.a, first.b, second.a);
  const firstB = segmentOrientation(first.a, first.b, second.b);
  const secondA = segmentOrientation(second.a, second.b, first.a);
  const secondB = segmentOrientation(second.a, second.b, first.b);
  if (
    ((firstA > EPSILON && firstB < -EPSILON) || (firstA < -EPSILON && firstB > EPSILON)) &&
    ((secondA > EPSILON && secondB < -EPSILON) || (secondA < -EPSILON && secondB > EPSILON))
  ) return true;
  return (
    pointOnSegment(second.a, first.a, first.b) ||
    pointOnSegment(second.b, first.a, first.b) ||
    pointOnSegment(first.a, second.a, second.b) ||
    pointOnSegment(first.b, second.a, second.b)
  );
}

export function gateColliderSeparation(first: ThickSegmentCollider, second: ThickSegmentCollider): number {
  if (segmentsIntersect(first, second)) return 0;
  return Math.sqrt(Math.min(
    pointToSegmentDistanceSquared(first.a[0], first.a[1], second.a, second.b),
    pointToSegmentDistanceSquared(first.b[0], first.b[1], second.a, second.b),
    pointToSegmentDistanceSquared(second.a[0], second.a[1], first.a, first.b),
    pointToSegmentDistanceSquared(second.b[0], second.b[1], first.a, first.b),
  ));
}

function pointDistance(first: Vec2Tuple, second: Vec2Tuple): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function validateSpawnSeparation(
  spawns: readonly EnemySpawnDefinition[],
  path: string,
  issues: RouteValidationIssue[],
): void {
  for (let first = 0; first < spawns.length; first += 1) {
    for (let second = first + 1; second < spawns.length; second += 1) {
      if (pointDistance(spawns[first].position, spawns[second].position) + EPSILON >= ROUTE_MIN_SPAWN_SEPARATION) continue;
      issues.push({
        path: `${path}.spawns[${second}].position`,
        message: `Encounter spawns must remain at least ${ROUTE_MIN_SPAWN_SEPARATION} world units apart.`,
      });
    }
  }
}

function routeGridBounds(
  shapes: readonly RouteShape[],
  resolution: number,
): { readonly minX: number; readonly minZ: number; readonly columns: number; readonly rows: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const shape of shapes) {
    let extentX: number;
    let extentZ: number;
    if (shape.kind === 'circle') {
      extentX = shape.radius;
      extentZ = shape.radius;
    } else {
      const cosine = Math.cos(shape.rotation);
      const sine = Math.sin(shape.rotation);
      extentX = Math.abs(cosine) * shape.halfExtents[0] + Math.abs(sine) * shape.halfExtents[1];
      extentZ = Math.abs(sine) * shape.halfExtents[0] + Math.abs(cosine) * shape.halfExtents[1];
    }
    minX = Math.min(minX, shape.center[0] - extentX);
    maxX = Math.max(maxX, shape.center[0] + extentX);
    minZ = Math.min(minZ, shape.center[1] - extentZ);
    maxZ = Math.max(maxZ, shape.center[1] + extentZ);
  }

  const snappedMinX = Math.floor((minX - resolution) / resolution) * resolution;
  const snappedMinZ = Math.floor((minZ - resolution) / resolution) * resolution;
  const snappedMaxX = Math.ceil((maxX + resolution) / resolution) * resolution;
  const snappedMaxZ = Math.ceil((maxZ + resolution) / resolution) * resolution;
  return {
    minX: snappedMinX,
    minZ: snappedMinZ,
    columns: Math.round((snappedMaxX - snappedMinX) / resolution) + 1,
    rows: Math.round((snappedMaxZ - snappedMinZ) / resolution) + 1,
  };
}

/**
 * Checks whether each encounter gate actually cuts the playable route between
 * the campaign start and final section. The walkable union is rasterized once,
 * then reused for every gate so the invariant is inexpensive enough to run as
 * part of authored-route validation.
 */
export function probeRouteGatePartitions(
  route: CampaignRouteDefinition,
  options: RouteGatePartitionProbeOptions = {},
): RouteGatePartitionProbeResult {
  const usesDefaultOptions =
    options.resolution === undefined &&
    options.playerRadius === undefined &&
    options.gateClearanceMargin === undefined &&
    options.maximumCellCount === undefined;
  if (usesDefaultOptions) {
    const cached = defaultGatePartitionProbeCache.get(route);
    if (cached) return cached;
  }
  const resolution = options.resolution ?? DEFAULT_GATE_PARTITION_RESOLUTION;
  const playerRadius = options.playerRadius ?? ROUTE_GATE_PARTITION_PLAYER_RADIUS;
  const gateClearanceMargin = options.gateClearanceMargin ?? DEFAULT_GATE_CLEARANCE_MARGIN;
  const maximumCellCount = options.maximumCellCount ?? DEFAULT_MAXIMUM_PARTITION_CELLS;
  if (!finite(resolution) || resolution <= 0) throw new Error('Gate partition resolution must be positive and finite.');
  if (!finite(playerRadius) || playerRadius < 0) throw new Error('Gate partition player radius must be finite and non-negative.');
  if (!finite(gateClearanceMargin) || gateClearanceMargin < 0) {
    throw new Error('Gate partition clearance margin must be finite and non-negative.');
  }
  if (!Number.isInteger(maximumCellCount) || maximumCellCount <= 0) {
    throw new Error('Gate partition maximum cell count must be a positive integer.');
  }

  const shapes = route.sections.flatMap<RouteShape>((section) => section.walkable);
  const referencedGateIds = new Set<string>();
  route.encounters.forEach((encounter) => {
    if (encounter.rearGateId) referencedGateIds.add(encounter.rearGateId);
    if (encounter.exitGateId) referencedGateIds.add(encounter.exitGateId);
  });
  const gates = route.gates.filter((gate) => referencedGateIds.has(gate.id));
  if (shapes.length === 0) {
    const result: RouteGatePartitionProbeResult = {
      checkedGateIds: [],
      bypassableGateIds: [],
      baselineReachable: false,
      resolution,
      playerRadius,
      gateClearanceMargin,
      cellCount: 0,
    };
    if (usesDefaultOptions) defaultGatePartitionProbeCache.set(route, result);
    return result;
  }

  const bounds = routeGridBounds(shapes, resolution);
  const cellCount = bounds.columns * bounds.rows;
  if (!Number.isSafeInteger(cellCount) || cellCount > maximumCellCount) {
    throw new Error(
      `Gate partition grid requires ${cellCount} cells, exceeding the ${maximumCellCount}-cell validation limit.`,
    );
  }

  const walkable = new Uint8Array(cellCount);
  for (let row = 0; row < bounds.rows; row += 1) {
    const z = bounds.minZ + row * resolution;
    for (let column = 0; column < bounds.columns; column += 1) {
      const x = bounds.minX + column * resolution;
      const index = row * bounds.columns + column;
      walkable[index] = shapes.some((shape) => routeShapeContainsCoordinates(shape, x, z, playerRadius)) ? 1 : 0;
    }
  }

  const nearestWalkableIndex = (point: Vec2Tuple): number => {
    let nearest = -1;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (let index = 0; index < cellCount; index += 1) {
      if (walkable[index] === 0) continue;
      const column = index % bounds.columns;
      const row = Math.floor(index / bounds.columns);
      const dx = bounds.minX + column * resolution - point[0];
      const dz = bounds.minZ + row * resolution - point[1];
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= nearestDistanceSquared) continue;
      nearest = index;
      nearestDistanceSquared = distanceSquared;
    }
    return nearest;
  };

  const orderedSections = [...route.sections].sort((first, second) => first.order - second.order);
  const finalSection = orderedSections[orderedSections.length - 1];
  const finalPoint = finalSection?.walkable[0]?.center;
  const startIndex = nearestWalkableIndex(route.start.position);
  const goalIndex = finalPoint ? nearestWalkableIndex(finalPoint) : -1;
  if (startIndex < 0 || goalIndex < 0) {
    throw new Error('Gate partition probe could not locate the campaign start or final section on the walkable grid.');
  }

  const queue = new Int32Array(cellCount);
  const visitGeneration = new Uint32Array(cellCount);
  let generation = 0;
  const bypassableGateIds: string[] = [];
  const neighborOffsets = [-1, 1, -bounds.columns, bounds.columns] as const;

  const canReachGoal = (isBlocked: (index: number) => boolean): boolean => {
    generation += 1;
    if (isBlocked(startIndex) || isBlocked(goalIndex)) return false;
    if (startIndex === goalIndex) return true;
    let head = 0;
    let tail = 0;
    queue[tail] = startIndex;
    tail += 1;
    visitGeneration[startIndex] = generation;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const currentColumn = current % bounds.columns;
      for (const offset of neighborOffsets) {
        if (offset === -1 && currentColumn === 0) continue;
        if (offset === 1 && currentColumn === bounds.columns - 1) continue;
        const next = current + offset;
        if (next < 0 || next >= cellCount || walkable[next] === 0 || visitGeneration[next] === generation) continue;
        if (isBlocked(next)) continue;
        if (next === goalIndex) return true;
        visitGeneration[next] = generation;
        queue[tail] = next;
        tail += 1;
      }
    }
    return false;
  };

  const baselineReachable = canReachGoal(() => false);

  for (const gate of gates) {
    const blockedRadius = Math.max(0, playerRadius + gate.collider.thickness * 0.5 - gateClearanceMargin);
    const blockedRadiusSquared = blockedRadius * blockedRadius;
    const isBlocked = (index: number): boolean => {
      const column = index % bounds.columns;
      const row = Math.floor(index / bounds.columns);
      const x = bounds.minX + column * resolution;
      const z = bounds.minZ + row * resolution;
      return pointToSegmentDistanceSquared(x, z, gate.collider.a, gate.collider.b) <= blockedRadiusSquared + EPSILON;
    };

    if (canReachGoal(isBlocked)) bypassableGateIds.push(gate.id);
  }

  const result: RouteGatePartitionProbeResult = {
    checkedGateIds: gates.map((gate) => gate.id),
    bypassableGateIds,
    baselineReachable,
    resolution,
    playerRadius,
    gateClearanceMargin,
    cellCount,
  };
  if (usesDefaultOptions) defaultGatePartitionProbeCache.set(route, result);
  return result;
}

function validateUniqueIds(
  values: readonly { readonly id: string }[],
  path: string,
  issues: RouteValidationIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (value.id.trim().length === 0) issues.push({ path: `${path}[${index}].id`, message: 'ID must not be empty.' });
    if (ids.has(value.id)) issues.push({ path: `${path}[${index}].id`, message: `Duplicate ID "${value.id}".` });
    ids.add(value.id);
  });
  return ids;
}

function validateContiguousOrder(
  values: readonly { readonly order: number }[],
  path: string,
  issues: RouteValidationIssue[],
): void {
  values.forEach((value, index) => {
    if (!Number.isInteger(value.order) || value.order !== index) {
      issues.push({ path: `${path}[${index}]`, message: `Items must be stored in contiguous order 0..${Math.max(0, values.length - 1)}.` });
    }
  });
}

function validateShape(shape: RouteShape, path: string, issues: RouteValidationIssue[]): void {
  if (!finitePoint(shape.center)) issues.push({ path: `${path}.center`, message: 'Shape center must be finite.' });
  if (shape.kind === 'circle') {
    if (!finite(shape.radius) || shape.radius <= 0) issues.push({ path: `${path}.radius`, message: 'Circle radius must be positive.' });
    return;
  }
  if (!finitePoint(shape.halfExtents) || shape.halfExtents[0] <= 0 || shape.halfExtents[1] <= 0) {
    issues.push({ path: `${path}.halfExtents`, message: 'OBB half extents must be finite and positive.' });
  }
  if (!finite(shape.rotation)) issues.push({ path: `${path}.rotation`, message: 'OBB rotation must be finite.' });
}

export function validateRouteDefinition(route: CampaignRouteDefinition): readonly RouteValidationIssue[] {
  const issues: RouteValidationIssue[] = [];
  if (route.version !== 1) issues.push({ path: 'version', message: 'Only route schema version 1 is supported.' });
  if (route.id.trim().length === 0) issues.push({ path: 'id', message: 'Route ID must not be empty.' });
  if (route.name.trim().length === 0) issues.push({ path: 'name', message: 'Route name must not be empty.' });

  const branchSections = route.branchSections ?? [];
  const allSections: readonly AnyRouteSection[] = [...route.sections, ...branchSections];
  const sectionIds = validateUniqueIds(route.sections, 'sections', issues);
  branchSections.forEach((section, index) => {
    const path = `branchSections[${index}].id`;
    if (section.id.trim().length === 0) issues.push({ path, message: 'ID must not be empty.' });
    if (sectionIds.has(section.id)) issues.push({ path, message: `Duplicate section ID "${section.id}".` });
    sectionIds.add(section.id);
  });
  const gateIds = validateUniqueIds(route.gates, 'gates', issues);
  validateUniqueIds(route.checkpoints, 'checkpoints', issues);
  const encounterIds = validateUniqueIds(route.encounters, 'encounters', issues);
  const branchEncounterIds = new Set<string>();
  (route.branchEncounters ?? []).forEach((encounter, index) => {
    const path = `branchEncounters[${index}].id`;
    if (encounter.id.trim().length === 0) issues.push({ path, message: 'ID must not be empty.' });
    if (encounterIds.has(encounter.id) || branchEncounterIds.has(encounter.id)) {
      issues.push({ path, message: `Duplicate encounter ID "${encounter.id}".` });
    }
    branchEncounterIds.add(encounter.id);
  });
  validateContiguousOrder(route.sections, 'sections.order', issues);
  validateContiguousOrder(route.checkpoints, 'checkpoints.order', issues);
  validateContiguousOrder(route.encounters, 'encounters.order', issues);

  if (route.sections.length === 0) issues.push({ path: 'sections', message: 'At least one route section is required.' });
  if (!sectionIds.has(route.start.sectionId)) issues.push({ path: 'start.sectionId', message: 'Start section does not exist.' });
  if (!finitePoint(route.start.position)) issues.push({ path: 'start.position', message: 'Start position must be finite.' });
  if (!finite(route.start.facingRadians)) issues.push({ path: 'start.facingRadians', message: 'Start facing must be finite.' });

  const sectionById = new Map(allSections.map((section) => [section.id, section]));
  const validateSection = (section: AnyRouteSection, path: string): void => {
    if (section.name.trim().length === 0) issues.push({ path: `${path}.name`, message: 'Section name must not be empty.' });
    if (section.walkable.length === 0) issues.push({ path: `${path}.walkable`, message: 'Section needs at least one walkable shape.' });
    section.walkable.forEach((shape, shapeIndex) => validateShape(shape, `${path}.walkable[${shapeIndex}]`, issues));
    if (!finitePoint(section.cameraForward) || Math.hypot(section.cameraForward[0], section.cameraForward[1]) <= EPSILON) {
      issues.push({ path: `${path}.cameraForward`, message: 'Camera forward must be a finite non-zero vector.' });
    }
    for (const connectedId of section.connectsTo) {
      if (!sectionIds.has(connectedId)) issues.push({ path: `${path}.connectsTo`, message: `Unknown section "${connectedId}".` });
      if (connectedId === section.id) issues.push({ path: `${path}.connectsTo`, message: 'A section cannot connect to itself.' });
    }
    if (section.elevation && (!finite(section.elevation.start) || !finite(section.elevation.end))) {
      issues.push({ path: `${path}.elevation`, message: 'Elevation endpoints must be finite.' });
    }
    if (section.elevation?.landingDepth !== undefined) {
      if (!finite(section.elevation.landingDepth) || section.elevation.landingDepth < 0) {
        issues.push({ path: `${path}.elevation.landingDepth`, message: 'Elevation landing depth must be a finite non-negative number.' });
      }
      if (section.kind !== 'stair') {
        issues.push({ path: `${path}.elevation.landingDepth`, message: 'Only stair sections may reserve elevation landings.' });
      }
    }
    const anchorIds = validateUniqueIds(section.enemyAnchors, `${path}.enemyAnchors`, issues);
    section.enemyAnchors.forEach((anchor, anchorIndex) => {
      if (!pointInSection(section, anchor.position)) {
        issues.push({ path: `${path}.enemyAnchors[${anchorIndex}].position`, message: 'Enemy anchor must lie inside its section.' });
      }
    });
    if (anchorIds.size !== section.enemyAnchors.length) {
      issues.push({ path: `${path}.enemyAnchors`, message: 'Enemy anchor IDs must be unique within a section.' });
    }
  };
  route.sections.forEach((section, index) => validateSection(section, `sections[${index}]`));
  branchSections.forEach((section, index) => validateSection(section, `branchSections[${index}]`));

  const orderedSections = [...route.sections].sort((a, b) => a.order - b.order);
  for (let index = 0; index < orderedSections.length - 1; index += 1) {
    const current = orderedSections[index];
    const next = orderedSections[index + 1];
    if (!current.connectsTo.includes(next.id) || !next.connectsTo.includes(current.id)) {
      issues.push({ path: `sections[${current.order}].connectsTo`, message: `Ordered sections "${current.id}" and "${next.id}" must be linked both ways.` });
    }
    const overlaps = current.walkable.some((first) => next.walkable.some((second) => (
      routeShapesOverlapForRadius(first, second, ROUTE_GATE_PARTITION_PLAYER_RADIUS)
    )));
    if (!overlaps) {
      issues.push({ path: `sections[${current.order}].walkable`, message: `Ordered sections "${current.id}" and "${next.id}" do not overlap.` });
    }
  }

  branchSections.forEach((section, index) => {
    section.connectsTo.forEach((connectedId) => {
      const connected = sectionById.get(connectedId);
      if (!connected) return;
      if (!connected.connectsTo.includes(section.id)) {
        issues.push({
          path: `branchSections[${index}].connectsTo`,
          message: `Connected sections "${section.id}" and "${connected.id}" must link both ways.`,
        });
      }
      const overlaps = section.walkable.some((first) => connected.walkable.some((second) => (
        routeShapesOverlapForRadius(first, second, ROUTE_GATE_PARTITION_PLAYER_RADIUS)
      )));
      if (!overlaps) {
        issues.push({
          path: `branchSections[${index}].walkable`,
          message: `Connected sections "${section.id}" and "${connected.id}" do not overlap.`,
        });
      }
    });
  });

  const startSection = sectionById.get(route.start.sectionId);
  if (startSection && !startSection.safe) issues.push({ path: 'start.sectionId', message: 'Campaign must start in a safe section.' });
  if (startSection && !pointInSection(startSection, route.start.position)) {
    issues.push({ path: 'start.position', message: 'Start position must lie inside the start section.' });
  }

  route.gates.forEach((gate, index) => {
    const path = `gates[${index}]`;
    const section = sectionById.get(gate.sectionId);
    if (!section) issues.push({ path: `${path}.sectionId`, message: 'Gate section does not exist.' });
    if (!finitePoint(gate.collider.a) || !finitePoint(gate.collider.b)) {
      issues.push({ path: `${path}.collider`, message: 'Gate endpoints must be finite.' });
    }
    const length = Math.hypot(gate.collider.b[0] - gate.collider.a[0], gate.collider.b[1] - gate.collider.a[1]);
    if (length <= EPSILON) issues.push({ path: `${path}.collider`, message: 'Gate segment must have non-zero length.' });
    const midpoint: Vec2Tuple = [
      (gate.collider.a[0] + gate.collider.b[0]) * 0.5,
      (gate.collider.a[1] + gate.collider.b[1]) * 0.5,
    ];
    if (section && !pointInSection(section, midpoint)) {
      issues.push({ path: `${path}.collider`, message: 'Gate midpoint must lie inside its declared section.' });
    }
    if (!finite(gate.collider.thickness) || gate.collider.thickness <= 0) {
      issues.push({ path: `${path}.collider.thickness`, message: 'Gate thickness must be positive.' });
    }
  });
  for (let first = 0; first < route.gates.length; first += 1) {
    for (let second = first + 1; second < route.gates.length; second += 1) {
      const separation = gateColliderSeparation(route.gates[first].collider, route.gates[second].collider);
      if (separation + EPSILON >= ROUTE_MIN_GATE_SEPARATION) continue;
      issues.push({
        path: `gates[${second}].collider`,
        message: `Gate colliders must remain at least ${ROUTE_MIN_GATE_SEPARATION} world units apart in plan view.`,
      });
    }
  }

  const encounterById = new Map(route.encounters.map((encounter) => [encounter.id, encounter]));
  const globalSpawnIds = new Set<string>();
  let midpointBosses = 0;
  let finalBosses = 0;
  route.encounters.forEach((encounter, index) => {
    const path = `encounters[${index}]`;
    encounter.sectionIds.forEach((sectionId) => {
      if (!sectionIds.has(sectionId)) issues.push({ path: `${path}.sectionIds`, message: `Unknown section "${sectionId}".` });
    });
    validateShape(encounter.activation, `${path}.activation`, issues);
    const activationCenter = shapeCenter(encounter.activation);
    const activationInside = encounter.sectionIds.some((sectionId) => {
      const section = sectionById.get(sectionId);
      return section ? pointInSection(section, activationCenter) : false;
    });
    if (!activationInside) issues.push({ path: `${path}.activation`, message: 'Encounter activation center must lie in one of its sections.' });
    if (encounter.rearGateId && !gateIds.has(encounter.rearGateId)) issues.push({ path: `${path}.rearGateId`, message: 'Rear gate does not exist.' });
    if (encounter.exitGateId && !gateIds.has(encounter.exitGateId)) issues.push({ path: `${path}.exitGateId`, message: 'Exit gate does not exist.' });
    if (encounter.spawns.length === 0) issues.push({ path: `${path}.spawns`, message: 'Encounter must contain at least one spawn.' });

    let bossRoleCount = 0;
    encounter.spawns.forEach((spawn, spawnIndex) => {
      const spawnPath = `${path}.spawns[${spawnIndex}]`;
      if (globalSpawnIds.has(spawn.id)) issues.push({ path: `${spawnPath}.id`, message: `Duplicate global spawn ID "${spawn.id}".` });
      globalSpawnIds.add(spawn.id);
      const section = sectionById.get(spawn.sectionId);
      if (!section || !encounter.sectionIds.includes(spawn.sectionId)) {
        issues.push({ path: `${spawnPath}.sectionId`, message: 'Spawn section must belong to its encounter.' });
      } else if (!pointInSection(section, spawn.position)) {
        issues.push({ path: `${spawnPath}.position`, message: 'Spawn must lie inside its section.' });
      }
      if (!finite(spawn.facingRadians)) issues.push({ path: `${spawnPath}.facingRadians`, message: 'Spawn facing must be finite.' });
      if (spawn.wakeDelaySeconds !== undefined && (!finite(spawn.wakeDelaySeconds) || spawn.wakeDelaySeconds < 0)) {
        issues.push({ path: `${spawnPath}.wakeDelaySeconds`, message: 'Wake delay must be finite and non-negative.' });
      }
      if (spawn.leashSectionIds.length === 0 || !spawn.leashSectionIds.includes(spawn.sectionId)) {
        issues.push({ path: `${spawnPath}.leashSectionIds`, message: 'Leash sections must include the spawn section.' });
      }
      spawn.leashSectionIds.forEach((sectionId) => {
        if (!encounter.sectionIds.includes(sectionId)) issues.push({ path: `${spawnPath}.leashSectionIds`, message: `Leash section "${sectionId}" is outside the encounter.` });
      });
      if (spawn.anchorId) {
        const anchorExists = section?.enemyAnchors.some((anchor) => anchor.id === spawn.anchorId) ?? false;
        if (!anchorExists) issues.push({ path: `${spawnPath}.anchorId`, message: 'Spawn anchor does not exist in its section.' });
      }
      if (spawn.role === 'boss') bossRoleCount += 1;
    });
    validateSpawnSeparation(encounter.spawns, path, issues);

    if (encounter.boss === 'none' && bossRoleCount > 0) issues.push({ path: `${path}.boss`, message: 'Non-boss encounter cannot contain a boss-role spawn.' });
    if (encounter.boss !== 'none' && bossRoleCount !== 1) issues.push({ path: `${path}.spawns`, message: 'Boss encounter must contain exactly one boss-role spawn.' });
    if (encounter.boss === 'midpoint') {
      midpointBosses += 1;
      if (!encounter.spawns.some((spawn) => spawn.kind === 'orreryCastellan')) {
        issues.push({ path: `${path}.spawns`, message: 'Midpoint boss encounter must contain the Orrery Castellan.' });
      }
    }
    if (encounter.boss === 'final') {
      finalBosses += 1;
      if (!encounter.spawns.some((spawn) => spawn.kind === 'eclipseArchon')) {
        issues.push({ path: `${path}.spawns`, message: 'Final boss encounter must contain the Eclipse Archon.' });
      }
      if (encounter.order !== route.encounters.length - 1) issues.push({ path: `${path}.order`, message: 'Final boss encounter must be last.' });
    }
  });

  const validateBranchSpawn = (
    encounter: BranchEncounterDefinition,
    spawn: EnemySpawnDefinition,
    spawnPath: string,
  ): void => {
    if (globalSpawnIds.has(spawn.id)) issues.push({ path: `${spawnPath}.id`, message: `Duplicate global spawn ID "${spawn.id}".` });
    globalSpawnIds.add(spawn.id);
    const section = sectionById.get(spawn.sectionId);
    if (!section || !encounter.sectionIds.includes(spawn.sectionId)) {
      issues.push({ path: `${spawnPath}.sectionId`, message: 'Spawn section must belong to its encounter.' });
    } else if (!pointInSection(section, spawn.position)) {
      issues.push({ path: `${spawnPath}.position`, message: 'Spawn must lie inside its section.' });
    }
    if (!finite(spawn.facingRadians)) issues.push({ path: `${spawnPath}.facingRadians`, message: 'Spawn facing must be finite.' });
    if (spawn.wakeDelaySeconds !== undefined && (!finite(spawn.wakeDelaySeconds) || spawn.wakeDelaySeconds < 0)) {
      issues.push({ path: `${spawnPath}.wakeDelaySeconds`, message: 'Wake delay must be finite and non-negative.' });
    }
    if (spawn.leashSectionIds.length === 0 || !spawn.leashSectionIds.includes(spawn.sectionId)) {
      issues.push({ path: `${spawnPath}.leashSectionIds`, message: 'Leash sections must include the spawn section.' });
    }
    spawn.leashSectionIds.forEach((sectionId) => {
      if (!encounter.sectionIds.includes(sectionId)) {
        issues.push({ path: `${spawnPath}.leashSectionIds`, message: `Leash section "${sectionId}" is outside the encounter.` });
      }
    });
    if (spawn.anchorId) {
      const anchorExists = section?.enemyAnchors.some((anchor) => anchor.id === spawn.anchorId) ?? false;
      if (!anchorExists) issues.push({ path: `${spawnPath}.anchorId`, message: 'Spawn anchor does not exist in its section.' });
    }
    if (spawn.role === 'boss') {
      issues.push({ path: `${spawnPath}.role`, message: 'Branch encounters cannot contain boss-role spawns.' });
    }
  };

  (route.branchEncounters ?? []).forEach((encounter, index) => {
    const path = `branchEncounters[${index}]`;
    if (encounter.name.trim().length === 0) issues.push({ path: `${path}.name`, message: 'Encounter name must not be empty.' });
    if (encounter.sectionIds.length === 0) issues.push({ path: `${path}.sectionIds`, message: 'Branch encounter needs at least one section.' });
    encounter.sectionIds.forEach((sectionId) => {
      if (!sectionIds.has(sectionId)) issues.push({ path: `${path}.sectionIds`, message: `Unknown section "${sectionId}".` });
    });
    validateShape(encounter.activation, `${path}.activation`, issues);
    const activationCenter = shapeCenter(encounter.activation);
    const activationInside = encounter.sectionIds.some((sectionId) => {
      const section = sectionById.get(sectionId);
      return section ? pointInSection(section, activationCenter) : false;
    });
    if (!activationInside) issues.push({ path: `${path}.activation`, message: 'Encounter activation center must lie in one of its sections.' });
    if (encounter.spawns.length === 0) issues.push({ path: `${path}.spawns`, message: 'Encounter must contain at least one spawn.' });
    encounter.spawns.forEach((spawn, spawnIndex) => validateBranchSpawn(encounter, spawn, `${path}.spawns[${spawnIndex}]`));
    validateSpawnSeparation(encounter.spawns, path, issues);
  });
  if (midpointBosses < 1) issues.push({ path: 'encounters', message: 'Route requires a midpoint boss.' });
  if (finalBosses !== 1) issues.push({ path: 'encounters', message: 'Route requires exactly one final boss.' });

  const choices = route.choices ?? [];
  validateUniqueIds(choices, 'choices', issues);
  const choiceById = new Map(choices.map((choice) => [choice.id, choice]));
  const branchEncounterById = new Map((route.branchEncounters ?? []).map((encounter) => [encounter.id, encounter]));
  choices.forEach((choice, choiceIndex) => {
    const path = `choices[${choiceIndex}]`;
    const section = sectionById.get(choice.sectionId);
    if (!section) issues.push({ path: `${path}.sectionId`, message: 'Choice section does not exist.' });
    else if (!pointInSection(section, choice.position)) issues.push({ path: `${path}.position`, message: 'Choice position must lie inside its section.' });
    if (!finitePoint(choice.position)) issues.push({ path: `${path}.position`, message: 'Choice position must be finite.' });
    if (!finite(choice.activationRadius) || choice.activationRadius <= 0) {
      issues.push({ path: `${path}.activationRadius`, message: 'Choice activation radius must be positive.' });
    }
    route.checkpoints.forEach((checkpoint) => {
      const minimum = choice.activationRadius + checkpoint.activationRadius + ROUTE_INTERACTION_CLEARANCE;
      if (pointDistance(choice.position, checkpoint.position) + EPSILON >= minimum) return;
      issues.push({
        path: `${path}.position`,
        message: `Choice activation must not overlap checkpoint "${checkpoint.id}" activation.`,
      });
    });
    const bufferedChoice: RouteShape = {
      kind: 'circle',
      center: choice.position,
      radius: choice.activationRadius + ROUTE_INTERACTION_CLEARANCE,
    };
    route.encounters.forEach((encounter) => {
      if (!routeShapesOverlap(bufferedChoice, encounter.activation)) return;
      issues.push({
        path: `${path}.position`,
        message: `Choice activation must not overlap encounter "${encounter.id}" activation.`,
      });
    });
    if (!gateIds.has(choice.directGateId)) issues.push({ path: `${path}.directGateId`, message: 'Direct-route gate does not exist.' });
    if (choice.options.length !== 2) issues.push({ path: `${path}.options`, message: 'Each route choice must contain exactly two options.' });
    const optionIds = validateUniqueIds(choice.options, `${path}.options`, issues);
    choice.options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      if (!gateIds.has(option.entryGateId)) issues.push({ path: `${optionPath}.entryGateId`, message: 'Choice entry gate does not exist.' });
      if (!gateIds.has(option.exitGateId)) issues.push({ path: `${optionPath}.exitGateId`, message: 'Choice exit gate does not exist.' });
      const encounter = branchEncounterById.get(option.encounterId);
      if (!encounter) issues.push({ path: `${optionPath}.encounterId`, message: 'Choice branch encounter does not exist.' });
      else if (encounter.choiceId !== choice.id || encounter.optionId !== option.id) {
        issues.push({ path: `${optionPath}.encounterId`, message: 'Branch encounter ownership does not match this choice option.' });
      }
      if (option.sectionIds.length === 0) issues.push({ path: `${optionPath}.sectionIds`, message: 'Choice option needs at least one branch section.' });
      option.sectionIds.forEach((sectionId) => {
        const branch = branchSections.find((candidate) => candidate.id === sectionId);
        if (!branch) issues.push({ path: `${optionPath}.sectionIds`, message: `Unknown branch section "${sectionId}".` });
        else if (branch.choiceId !== choice.id || branch.optionId !== option.id) {
          issues.push({ path: `${optionPath}.sectionIds`, message: `Branch section "${sectionId}" belongs to a different choice option.` });
        }
      });
      if (!finite(option.consequence.affinityDelta) || option.consequence.affinityDelta < 0) {
        issues.push({ path: `${optionPath}.consequence.affinityDelta`, message: 'Affinity delta must be finite and non-negative.' });
      }
      if (!finite(option.consequence.enemyPowerMultiplier) || option.consequence.enemyPowerMultiplier <= 0) {
        issues.push({ path: `${optionPath}.consequence.enemyPowerMultiplier`, message: 'Enemy power multiplier must be positive.' });
      }
    });
    if (optionIds.size !== choice.options.length) {
      issues.push({ path: `${path}.options`, message: 'Choice option IDs must be unique.' });
    }
  });

  branchSections.forEach((section, index) => {
    const choice = choiceById.get(section.choiceId);
    if (!choice) {
      issues.push({ path: `branchSections[${index}].choiceId`, message: 'Branch section choice does not exist.' });
      return;
    }
    const option = choice.options.find((candidate) => candidate.id === section.optionId);
    if (!option) issues.push({ path: `branchSections[${index}].optionId`, message: 'Branch section option does not exist.' });
    else if (!option.sectionIds.includes(section.id)) {
      issues.push({ path: `branchSections[${index}]`, message: 'Branch section is not declared by its owning choice option.' });
    }
  });

  (route.branchEncounters ?? []).forEach((encounter, index) => {
    const choice = choiceById.get(encounter.choiceId);
    if (!choice) {
      issues.push({ path: `branchEncounters[${index}].choiceId`, message: 'Branch encounter choice does not exist.' });
      return;
    }
    const option = choice.options.find((candidate) => candidate.id === encounter.optionId);
    if (!option) issues.push({ path: `branchEncounters[${index}].optionId`, message: 'Branch encounter option does not exist.' });
    else if (option.encounterId !== encounter.id) {
      issues.push({ path: `branchEncounters[${index}]`, message: 'Branch encounter is not declared by its owning choice option.' });
    }
  });

  route.checkpoints.forEach((checkpoint, index) => {
    const path = `checkpoints[${index}]`;
    const section = sectionById.get(checkpoint.sectionId);
    if (!section) issues.push({ path: `${path}.sectionId`, message: 'Checkpoint section does not exist.' });
    else if (!pointInSection(section, checkpoint.position)) issues.push({ path: `${path}.position`, message: 'Checkpoint must lie inside its section.' });
    if (!finite(checkpoint.facingRadians)) issues.push({ path: `${path}.facingRadians`, message: 'Checkpoint facing must be finite.' });
    if (!finite(checkpoint.activationRadius) || checkpoint.activationRadius <= 0) {
      issues.push({ path: `${path}.activationRadius`, message: 'Checkpoint activation radius must be positive.' });
    }
    if (!encounterIds.has(checkpoint.unlocksAfterEncounterId)) {
      issues.push({ path: `${path}.unlocksAfterEncounterId`, message: 'Checkpoint unlock encounter does not exist.' });
    }
    const allEncounters = [...route.encounters, ...(route.branchEncounters ?? [])];
    allEncounters.forEach((encounter) => encounter.spawns.forEach((spawn) => {
      if (pointDistance(checkpoint.position, spawn.position) + EPSILON >= ROUTE_MIN_SPAWN_CHECKPOINT_DISTANCE) return;
      issues.push({
        path: `${path}.position`,
        message: `Checkpoint must remain at least ${ROUTE_MIN_SPAWN_CHECKPOINT_DISTANCE} world units from spawn "${spawn.id}".`,
      });
    }));
    const unlockEncounter = encounterById.get(checkpoint.unlocksAfterEncounterId);
    if (unlockEncounter && index > 0) {
      const previous = route.checkpoints[index - 1];
      const previousEncounter = encounterById.get(previous.unlocksAfterEncounterId);
      if (previousEncounter && unlockEncounter.order <= previousEncounter.order) {
        issues.push({ path: `${path}.unlocksAfterEncounterId`, message: 'Checkpoint unlock encounters must advance in route order.' });
      }
    }
  });

  if (!Number.isInteger(route.requirements.encounterCount) || route.requirements.encounterCount <= 0) {
    issues.push({ path: 'requirements.encounterCount', message: 'Required encounter count must be a positive integer.' });
  } else if (route.encounters.length !== route.requirements.encounterCount) {
    issues.push({ path: 'encounters', message: `Expected exactly ${route.requirements.encounterCount} encounters.` });
  }
  if (!Number.isInteger(route.requirements.minimumBridgeSections) || route.requirements.minimumBridgeSections < 0) {
    issues.push({ path: 'requirements.minimumBridgeSections', message: 'Minimum bridge section count must be a non-negative integer.' });
  }
  const bridgeCount = route.sections.filter((section) => section.kind === 'bridge' || section.kind === 'causeway').length;
  if (bridgeCount < route.requirements.minimumBridgeSections) {
    issues.push({ path: 'sections', message: `Expected at least ${route.requirements.minimumBridgeSections} bridge/causeway sections.` });
  }
  if (route.requirements.minimumBiomeCount !== undefined) {
    if (!Number.isInteger(route.requirements.minimumBiomeCount) || route.requirements.minimumBiomeCount <= 0) {
      issues.push({ path: 'requirements.minimumBiomeCount', message: 'Minimum biome count must be a positive integer.' });
    } else {
      const biomeCount = new Set(allSections.map((section) => section.biome ?? 'moonless-tundra')).size;
      if (biomeCount < route.requirements.minimumBiomeCount) {
        issues.push({ path: 'sections', message: `Expected at least ${route.requirements.minimumBiomeCount} distinct biomes.` });
      }
    }
  }
  if (route.requirements.minimumChoiceCount !== undefined) {
    if (!Number.isInteger(route.requirements.minimumChoiceCount) || route.requirements.minimumChoiceCount < 0) {
      issues.push({ path: 'requirements.minimumChoiceCount', message: 'Minimum choice count must be a non-negative integer.' });
    } else if (choices.length < route.requirements.minimumChoiceCount) {
      issues.push({ path: 'choices', message: `Expected at least ${route.requirements.minimumChoiceCount} route choices.` });
    }
  }
  const actualRelicOrder = [...route.checkpoints].sort((a, b) => a.order - b.order).map((checkpoint) => checkpoint.relicKind);
  if (
    actualRelicOrder.length !== route.requirements.relicOrder.length ||
    actualRelicOrder.some((kind, index) => kind !== route.requirements.relicOrder[index])
  ) {
    issues.push({ path: 'checkpoints', message: `Relic checkpoint order must be ${route.requirements.relicOrder.join(' -> ')}.` });
  }
  const actualEnemyKinds = new Set([
    ...route.encounters.flatMap((encounter) => encounter.spawns.map((spawn) => spawn.kind)),
    ...(route.branchEncounters ?? []).flatMap((encounter) => encounter.spawns.map((spawn) => spawn.kind)),
  ]);
  route.requirements.enemyKinds.forEach((kind) => {
    if (!actualEnemyKinds.has(kind)) issues.push({ path: 'encounters.spawns', message: `Required enemy kind "${kind}" is missing.` });
  });

  if (route.sections.length > 0 && route.gates.length > 0) {
    try {
      const partitionProbe = probeRouteGatePartitions(route);
      if (!partitionProbe.baselineReachable) {
        issues.push({
          path: 'sections',
          message: 'Ungated player-walkable route does not connect the campaign start to the final section.',
        });
      }
      partitionProbe.bypassableGateIds.forEach((gateId) => {
        const gateIndex = route.gates.findIndex((gate) => gate.id === gateId);
        issues.push({
          path: gateIndex >= 0 ? `gates[${gateIndex}].collider` : 'gates',
          message: `Closed gate "${gateId}" does not form a valid partition of the player-walkable route union.`,
        });
      });
    } catch (error) {
      issues.push({
        path: 'gates',
        message: `Gate partition validation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return issues;
}

export function assertValidRouteDefinition<T extends CampaignRouteDefinition>(route: T): T {
  const issues = validateRouteDefinition(route);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    throw new Error(`Invalid campaign route "${route.id}":\n${details}`);
  }
  return route;
}
