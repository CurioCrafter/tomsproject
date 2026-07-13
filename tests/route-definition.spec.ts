import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { FIRMAMENT_ROUTE, FIRMAMENT_ROUTE_WALKABLE } from '../src/game/content/FirmamentRoute';
import {
  getAllRouteSections,
  resolveRouteSurface,
  routeElevationAtClosest,
  routeSectionElevationAt,
} from '../src/game/content/RouteGeometry';
import type { CampaignRouteDefinition, EncounterDefinition } from '../src/game/content/RouteTypes';
import {
  probeRouteGatePartitions,
  gateColliderSeparation,
  ROUTE_GATE_PARTITION_PLAYER_RADIUS,
  ROUTE_INTERACTION_CLEARANCE,
  ROUTE_MIN_GATE_SEPARATION,
  ROUTE_MIN_SPAWN_CHECKPOINT_DISTANCE,
  ROUTE_MIN_SPAWN_SEPARATION,
  validateRouteDefinition,
} from '../src/game/content/validateRoute';
import { CollisionSystem } from '../src/systems/CollisionSystem';

test('every encounter-referenced spine gate partitions the player-walkable route', () => {
  const result = probeRouteGatePartitions(FIRMAMENT_ROUTE);
  const referencedGateIds = new Set(
    (FIRMAMENT_ROUTE.encounters as readonly EncounterDefinition[]).flatMap((encounter) =>
      [encounter.rearGateId, encounter.exitGateId].filter((gateId): gateId is string => Boolean(gateId)),
    ),
  );
  const expectedGateIds = FIRMAMENT_ROUTE.gates
    .filter((gate) => referencedGateIds.has(gate.id))
    .map((gate) => gate.id);

  expect(result.playerRadius).toBe(ROUTE_GATE_PARTITION_PLAYER_RADIUS);
  expect(result.baselineReachable).toBe(true);
  expect(result.checkedGateIds).toEqual(expectedGateIds);
  expect(result.bypassableGateIds).toEqual([]);
  expect(result.cellCount).toBeLessThanOrEqual(250_000);
});

test('the authored campaign contains five biomes, four two-arm choices, vertical routes, and the new enemy roster', () => {
  const branchSections = FIRMAMENT_ROUTE.branchSections ?? [];
  const choices = FIRMAMENT_ROUTE.choices ?? [];
  const allSections = getAllRouteSections(FIRMAMENT_ROUTE);
  const sectionById = new Map(allSections.map((section) => [section.id, section]));
  const mainSectionIds = new Set<string>(FIRMAMENT_ROUTE.sections.map((section) => section.id));
  const biomes = new Set(allSections.map((section) => section.biome ?? 'moonless-tundra'));

  expect(validateRouteDefinition(FIRMAMENT_ROUTE)).toEqual([]);
  expect(biomes).toEqual(
    new Set([
      'moonless-tundra',
      'drowned-cloister',
      'verdant-cathedral',
      'ember-basilica',
      'amethyst-archives',
    ]),
  );
  expect(choices.length).toBeGreaterThanOrEqual(4);

  for (const choice of choices) {
    expect(choice.options, `${choice.id} should present exactly two consequences`).toHaveLength(2);
    const downstreamByOption: string[][] = [];

    for (const option of choice.options) {
      const optionSections = option.sectionIds.map((sectionId) => sectionById.get(sectionId));
      expect(optionSections, `${choice.id}/${option.id} should only reference authored sections`).not.toContain(undefined);

      const ownedSections = optionSections.filter((section) => section !== undefined);
      const ownedIds = new Set(ownedSections.map((section) => section.id));
      const visited = new Set<string>();
      const queue = ownedSections.length > 0 ? [ownedSections[0].id] : [];
      while (queue.length > 0) {
        const sectionId = queue.shift();
        if (!sectionId || visited.has(sectionId)) continue;
        visited.add(sectionId);
        const section = sectionById.get(sectionId);
        section?.connectsTo.forEach((connectedId) => {
          if (ownedIds.has(connectedId) && !visited.has(connectedId)) queue.push(connectedId);
        });
      }
      expect(visited, `${choice.id}/${option.id} should be one connected branch arm`).toEqual(ownedIds);

      const mainConnections = new Set(
        ownedSections.flatMap((section) => section.connectsTo).filter((sectionId) => mainSectionIds.has(sectionId)),
      );
      expect(mainConnections, `${choice.id}/${option.id} should leave from its choice section`).toContain(choice.sectionId);
      const downstream = [...mainConnections].filter((sectionId) => sectionId !== choice.sectionId);
      expect(downstream.length, `${choice.id}/${option.id} should reconnect to the main pilgrimage`).toBeGreaterThan(0);
      downstreamByOption.push(downstream);

      const stairs = ownedSections.filter((section) => section.kind === 'stair');
      expect(stairs.length, `${choice.id}/${option.id} should include an outbound and return stair`).toBeGreaterThanOrEqual(2);
      expect(
        stairs.every(
          (section) => section.elevation && Math.abs(section.elevation.end - section.elevation.start) > 0.01,
        ),
        `${choice.id}/${option.id} stairs should change elevation`,
      ).toBe(true);
    }

    expect(
      downstreamByOption[0].some((sectionId) => downstreamByOption[1].includes(sectionId)),
      `${choice.id} arms should rejoin at the same downstream section`,
    ).toBe(true);
  }

  const stairDeltas = branchSections
    .filter((section) => section.kind === 'stair' && section.elevation)
    .map((section) => (section.elevation?.end ?? 0) - (section.elevation?.start ?? 0));
  expect(stairDeltas.some((delta) => delta > 0)).toBe(true);
  expect(stairDeltas.some((delta) => delta < 0)).toBe(true);

  const branchEnemyKinds = new Set(
    (FIRMAMENT_ROUTE.branchEncounters ?? []).flatMap((encounter) => encounter.spawns.map((spawn) => spawn.kind)),
  );
  for (const kind of ['drownedCantor', 'thornReliquary', 'emberPenitent', 'prismScribe'] as const) {
    expect(branchEnemyKinds, `branch encounters should exercise ${kind}`).toContain(kind);
  }
});

test('gates, interactions, and encounter spawns keep authored clearance', () => {
  for (let first = 0; first < FIRMAMENT_ROUTE.gates.length; first += 1) {
    for (let second = first + 1; second < FIRMAMENT_ROUTE.gates.length; second += 1) {
      const a = FIRMAMENT_ROUTE.gates[first];
      const b = FIRMAMENT_ROUTE.gates[second];
      expect(
        gateColliderSeparation(a.collider, b.collider),
        `${a.id} and ${b.id} must not intersect or nest`,
      ).toBeGreaterThanOrEqual(ROUTE_MIN_GATE_SEPARATION);
    }
  }

  for (const choice of FIRMAMENT_ROUTE.choices ?? []) {
    for (const checkpoint of FIRMAMENT_ROUTE.checkpoints) {
      const distance = Math.hypot(
        choice.position[0] - checkpoint.position[0],
        choice.position[1] - checkpoint.position[1],
      );
      expect(distance, `${choice.id} must not compete with ${checkpoint.id}`).toBeGreaterThanOrEqual(
        choice.activationRadius + checkpoint.activationRadius + ROUTE_INTERACTION_CLEARANCE,
      );
    }
  }

  const encounters = [...FIRMAMENT_ROUTE.encounters, ...(FIRMAMENT_ROUTE.branchEncounters ?? [])];
  for (const encounter of encounters) {
    for (let first = 0; first < encounter.spawns.length; first += 1) {
      for (let second = first + 1; second < encounter.spawns.length; second += 1) {
        const a = encounter.spawns[first];
        const b = encounter.spawns[second];
        expect(
          Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]),
          `${a.id} and ${b.id} must not spawn on each other`,
        ).toBeGreaterThanOrEqual(ROUTE_MIN_SPAWN_SEPARATION);
      }
    }
  }

  for (const checkpoint of FIRMAMENT_ROUTE.checkpoints) {
    for (const encounter of encounters) {
      for (const spawn of encounter.spawns) {
        expect(
          Math.hypot(checkpoint.position[0] - spawn.position[0], checkpoint.position[1] - spawn.position[1]),
          `${spawn.id} must not spawn on ${checkpoint.id}`,
        ).toBeGreaterThanOrEqual(ROUTE_MIN_SPAWN_CHECKPOINT_DISTANCE);
      }
    }
  }
});

test('stacked route elevation stays on the current authored surface', () => {
  const section = getAllRouteSections(FIRMAMENT_ROUTE).find((candidate) => candidate.id === 'graveglass-crypt');
  expect(section).toBeDefined();
  const point = [13, 17.2] as const;
  const ownerElevation = routeSectionElevationAt(section!, point);
  expect(routeElevationAtClosest(FIRMAMENT_ROUTE, point, ownerElevation)).toBeCloseTo(ownerElevation, 5);
});

test('a selected branch stair owns height continuously from its hub landing to its arena', () => {
  const sections = getAllRouteSections(FIRMAMENT_ROUTE);
  const moonCourt = sections.find((section) => section.id === 'moon-court');
  const ascent = sections.find((section) => section.id === 'drowned-belfry-ascent');
  const belfry = sections.find((section) => section.id === 'drowned-pale-belfry');
  expect(moonCourt).toBeDefined();
  expect(ascent?.kind).toBe('stair');
  expect(belfry).toBeDefined();
  const shape = ascent?.walkable[0];
  if (!moonCourt || !ascent || !belfry || !shape || shape.kind !== 'obb') throw new Error('Missing Drowned branch geometry.');

  const eligible = [moonCourt, ascent, belfry];
  const forwardLength = Math.hypot(ascent.cameraForward[0], ascent.cameraForward[1]) || 1;
  const forward: readonly [number, number] = [
    ascent.cameraForward[0] / forwardLength,
    ascent.cameraForward[1] / forwardLength,
  ];
  let sectionId: string | null = moonCourt.id;
  let elevation = 0;
  let maximumStep = 0;
  for (let sample = 0; sample <= 80; sample += 1) {
    const distance = THREE.MathUtils.lerp(-shape.halfExtents[1] + 0.1, shape.halfExtents[1] - 0.1, sample / 80);
    const surface = resolveRouteSurface(
      eligible,
      [shape.center[0] + forward[0] * distance, shape.center[1] + forward[1] * distance],
      elevation,
      sectionId,
    );
    expect(surface, `Drowned stair sample ${sample} should own a surface`).not.toBeNull();
    if (!surface) continue;
    maximumStep = Math.max(maximumStep, Math.abs(surface.elevation - elevation));
    elevation = surface.elevation;
    sectionId = surface.section.id;
  }

  expect(sectionId).toBe(belfry.id);
  expect(elevation).toBeCloseTo(3.2, 5);
  expect(maximumStep).toBeLessThan(0.12);
  const arenaSurface = resolveRouteSurface(eligible, belfry.walkable[0].center, elevation, sectionId);
  expect(arenaSurface?.section.id).toBe(belfry.id);
  expect(arenaSurface?.elevation).toBeCloseTo(3.2, 5);
});

test('every branch stair transfers continuously from its declared start section to its destination', () => {
  const sectionById = new Map(getAllRouteSections(FIRMAMENT_ROUTE).map((section) => [section.id, section]));
  const stairs = (FIRMAMENT_ROUTE.branchSections ?? []).filter((section) => section.kind === 'stair');

  for (const stair of stairs) {
    const start = sectionById.get(stair.connectsTo[0]);
    const destination = sectionById.get(stair.connectsTo[1]);
    const shape = stair.walkable[0];
    expect(start, `${stair.id} should have an authored start section`).toBeDefined();
    expect(destination, `${stair.id} should have an authored destination section`).toBeDefined();
    if (!start || !destination || shape.kind !== 'obb' || !stair.elevation) continue;

    const eligible = [start, stair, destination];
    const forwardLength = Math.hypot(stair.cameraForward[0], stair.cameraForward[1]) || 1;
    const forward: readonly [number, number] = [
      stair.cameraForward[0] / forwardLength,
      stair.cameraForward[1] / forwardLength,
    ];
    let currentSectionId: string | null = start.id;
    let elevation = stair.elevation.start;
    let maximumStep = 0;
    for (let sample = 0; sample <= 100; sample += 1) {
      const distance = THREE.MathUtils.lerp(-shape.halfExtents[1] + 0.1, shape.halfExtents[1] - 0.1, sample / 100);
      const surface = resolveRouteSurface(
        eligible,
        [shape.center[0] + forward[0] * distance, shape.center[1] + forward[1] * distance],
        elevation,
        currentSectionId,
      );
      expect(surface, `${stair.id} sample ${sample} should own a surface`).not.toBeNull();
      if (!surface) continue;
      maximumStep = Math.max(maximumStep, Math.abs(surface.elevation - elevation));
      elevation = surface.elevation;
      currentSectionId = surface.section.id;
    }
    expect(maximumStep, `${stair.id} should not snap vertically`).toBeLessThan(0.15);
    expect(elevation, `${stair.id} should reach its authored destination height`).toBeCloseTo(stair.elevation.end, 5);
    const destinationSurface = resolveRouteSurface(
      eligible,
      destination.walkable[0].center,
      elevation,
      currentSectionId,
    );
    expect(destinationSurface?.section.id, `${stair.id} should hand ownership to ${destination.id}`).toBe(destination.id);
  }
});

test('closed gates only block characters on the gate owner elevation', () => {
  const gate = FIRMAMENT_ROUTE.gates.find((candidate) => candidate.id === 'drowned-direct-seal');
  expect(gate).toBeDefined();
  if (!gate) return;
  const midpoint = new THREE.Vector3(
    (gate.collider.a[0] + gate.collider.b[0]) * 0.5,
    0,
    (gate.collider.a[1] + gate.collider.b[1]) * 0.5,
  );
  const tangent = new THREE.Vector3(
    gate.collider.b[0] - gate.collider.a[0],
    0,
    gate.collider.b[1] - gate.collider.a[1],
  ).normalize();
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const collision = new CollisionSystem();
  collision.configureRouteCollision(
    FIRMAMENT_ROUTE_WALKABLE,
    [gate],
    [{ id: gate.id, state: 'closed' }],
    new Map([[gate.id, 0]]),
  );

  expect(collision.sweepClosedGates(
    midpoint.clone().addScaledVector(normal, 1.5),
    midpoint.clone().addScaledVector(normal, -1.5),
    ROUTE_GATE_PARTITION_PLAYER_RADIUS,
  )?.gateId).toBe(gate.id);
  expect(collision.sweepClosedGates(
    midpoint.clone().setY(3.2).addScaledVector(normal, 1.5),
    midpoint.clone().setY(3.2).addScaledVector(normal, -1.5),
    ROUTE_GATE_PARTITION_PLAYER_RADIUS,
  )).toBeNull();
});

test('the runtime player collider can traverse every ordered section when seals are open', () => {
  const collision = new CollisionSystem();
  collision.configureRouteCollision(
    FIRMAMENT_ROUTE_WALKABLE,
    FIRMAMENT_ROUTE.gates,
    FIRMAMENT_ROUTE.gates.map((gate) => ({ id: gate.id, state: 'open' as const })),
  );
  const position = new THREE.Vector3(FIRMAMENT_ROUTE.start.position[0], 0.02, FIRMAMENT_ROUTE.start.position[1]);
  const velocity = new THREE.Vector3();

  for (const section of [...FIRMAMENT_ROUTE.sections].sort((a, b) => a.order - b.order)) {
    const targetShape = section.walkable[0];
    const target = new THREE.Vector3(targetShape.center[0], 0.02, targetShape.center[1]);
    for (let step = 0; step < 600 && position.distanceToSquared(target) > 0.08 ** 2; step += 1) {
      const previous = position.clone();
      const movement = target.clone().sub(position).setY(0);
      const distance = movement.length();
      if (distance > 0.08) movement.multiplyScalar(0.08 / distance);
      position.add(movement);
      velocity.copy(movement).multiplyScalar(60);
      collision.resolveRouteMovement(previous, position, velocity, ROUTE_GATE_PARTITION_PLAYER_RADIUS);
    }
    expect(position.distanceTo(target), `runtime traversal should reach ${section.id}`).toBeLessThanOrEqual(0.12);
  }
});

test('the runtime player collider can traverse every complete branch arm when its seals are open', () => {
  const sectionById = new Map(getAllRouteSections(FIRMAMENT_ROUTE).map((section) => [section.id, section]));
  const mainSectionIds = new Set<string>(FIRMAMENT_ROUTE.sections.map((section) => section.id));
  const failures: string[] = [];

  for (const choice of FIRMAMENT_ROUTE.choices ?? []) {
    for (const option of choice.options) {
      const optionSections = option.sectionIds.map((sectionId) => sectionById.get(sectionId));
      expect(optionSections, `${choice.id}/${option.id} should only reference authored sections`).not.toContain(undefined);
      const downstreamId = optionSections
        .flatMap((section) => section?.connectsTo ?? [])
        .find((sectionId) => mainSectionIds.has(sectionId) && sectionId !== choice.sectionId);
      const downstream = downstreamId ? sectionById.get(downstreamId) : undefined;
      const choiceSection = sectionById.get(choice.sectionId);
      expect(choiceSection, `${choice.id} should own an authored section`).toBeDefined();
      expect(downstream, `${choice.id}/${option.id} should reconnect downstream`).toBeDefined();

      const routeSections = [choiceSection, ...optionSections, downstream].filter(
        (section): section is NonNullable<typeof section> => Boolean(section),
      );
      const regions = routeSections.flatMap((section) => section.walkable);
      const collision = new CollisionSystem();
      collision.configureRouteCollision(
        regions,
        FIRMAMENT_ROUTE.gates,
        FIRMAMENT_ROUTE.gates.map((gate) => ({ id: gate.id, state: 'open' as const })),
      );
      const position = new THREE.Vector3(choice.position[0], 0.02, choice.position[1]);
      const velocity = new THREE.Vector3();

      const visit = (target: THREE.Vector3, label: string): void => {
        for (let step = 0; step < 1_000 && position.distanceToSquared(target) > 0.08 ** 2; step += 1) {
          const previous = position.clone();
          const movement = target.clone().sub(position).setY(0);
          const distance = movement.length();
          if (distance > 0.08) movement.multiplyScalar(0.08 / distance);
          position.add(movement);
          velocity.copy(movement).multiplyScalar(60);
          collision.resolveRouteMovement(previous, position, velocity, ROUTE_GATE_PARTITION_PLAYER_RADIUS, regions);
        }
        const remainingDistance = position.distanceTo(target);
        if (remainingDistance > 0.12) {
          failures.push(
            `${choice.id}/${option.id} could not reach ${label}; stopped at `
            + `[${position.x.toFixed(3)}, ${position.z.toFixed(3)}], ${remainingDistance.toFixed(3)} units short`,
          );
          position.copy(target);
        }
      };

      for (const section of [...optionSections, downstream]) {
        if (!section) continue;
        const shape = section.walkable[0];
        const target = new THREE.Vector3(shape.center[0], 0.02, shape.center[1]);
        visit(target, section.id);
        if (section.kind === 'stair' && shape.kind === 'obb') {
          const forwardLength = Math.hypot(section.cameraForward[0], section.cameraForward[1]) || 1;
          const distance = Math.max(0, shape.halfExtents[1] - ROUTE_GATE_PARTITION_PLAYER_RADIUS - 0.05);
          visit(new THREE.Vector3(
            shape.center[0] + section.cameraForward[0] / forwardLength * distance,
            0.02,
            shape.center[1] + section.cameraForward[1] / forwardLength * distance,
          ), `${section.id} exit`);
        }
      }
    }
  }

  expect(failures).toEqual([]);
});

test('every authored stair samples a monotonic playable elevation from entry to exit', () => {
  const stairs = (FIRMAMENT_ROUTE.branchSections ?? []).filter((section) => section.kind === 'stair');
  expect(stairs.length).toBeGreaterThanOrEqual(16);
  for (const stair of stairs) {
    const shape = stair.walkable.find((candidate) => candidate.kind === 'obb');
    if (!shape || shape.kind !== 'obb' || !stair.elevation) throw new Error(`Stair ${stair.id} lacks its OBB elevation profile.`);
    const length = Math.hypot(stair.cameraForward[0], stair.cameraForward[1]);
    const forward: readonly [number, number] = [stair.cameraForward[0] / length, stair.cameraForward[1] / length];
    const entry: readonly [number, number] = [
      shape.center[0] - forward[0] * shape.halfExtents[1] * 0.9,
      shape.center[1] - forward[1] * shape.halfExtents[1] * 0.9,
    ];
    const exit: readonly [number, number] = [
      shape.center[0] + forward[0] * shape.halfExtents[1] * 0.9,
      shape.center[1] + forward[1] * shape.halfExtents[1] * 0.9,
    ];
    const entryHeight = routeSectionElevationAt(stair, entry);
    const midpointHeight = routeSectionElevationAt(stair, shape.center);
    const exitHeight = routeSectionElevationAt(stair, exit);
    const direction = Math.sign(stair.elevation.end - stair.elevation.start);
    expect((midpointHeight - entryHeight) * direction, `${stair.id} entry-to-midpoint`).toBeGreaterThan(0);
    expect((exitHeight - midpointHeight) * direction, `${stair.id} midpoint-to-exit`).toBeGreaterThan(0);
    expect(entryHeight).toBeCloseTo(stair.elevation.start, 0);
    expect(exitHeight).toBeCloseTo(stair.elevation.end, 0);
  }
});

test('route validation rejects a campaign whose ungated walkable union is disconnected', () => {
  const disconnectedRoute: CampaignRouteDefinition = {
    ...FIRMAMENT_ROUTE,
    sections: FIRMAMENT_ROUTE.sections.map((section) =>
      section.id === 'aurora-span'
        ? {
            ...section,
            walkable: section.walkable.map((shape) => ({ ...shape, center: [28, -14.5] as const })),
          }
        : section,
    ),
  };

  expect(probeRouteGatePartitions(disconnectedRoute).baselineReachable).toBe(false);
  expect(validateRouteDefinition(disconnectedRoute)).toContainEqual({
    path: 'sections',
    message: 'Ungated player-walkable route does not connect the campaign start to the final section.',
  });
});

test('route validation rejects a gate whose endpoints leave a walkable bypass', () => {
  const shortenedRoute: CampaignRouteDefinition = {
    ...FIRMAMENT_ROUTE,
    gates: FIRMAMENT_ROUTE.gates.map((gate) =>
      gate.id === 'eclipse-seal'
        ? {
            ...gate,
            collider: {
              a: [4.1, -53.39],
              b: [4.9, -53.61],
              thickness: gate.collider.thickness,
            },
          }
        : gate,
    ),
  };

  const result = probeRouteGatePartitions(shortenedRoute);
  expect(result.bypassableGateIds).toContain('eclipse-seal');

  const issues = validateRouteDefinition(shortenedRoute);
  expect(issues).toContainEqual({
    path: 'gates[4].collider',
    message: 'Closed gate "eclipse-seal" does not form a valid partition of the player-walkable route union.',
  });
});

test('route validation rejects intersecting gates and coincident encounter spawns', () => {
  const overlappingRoute: CampaignRouteDefinition = {
    ...FIRMAMENT_ROUTE,
    gates: FIRMAMENT_ROUTE.gates.map((gate, index) => (
      index === 1 ? { ...gate, collider: { ...FIRMAMENT_ROUTE.gates[0].collider } } : gate
    )),
    encounters: FIRMAMENT_ROUTE.encounters.map((encounter, encounterIndex) => (
      encounterIndex === 0
        ? {
            ...encounter,
            spawns: encounter.spawns.map((spawn, spawnIndex) => (
              spawnIndex === 1 ? { ...spawn, position: encounter.spawns[0].position } : spawn
            )),
          }
        : encounter
    )),
  };

  const issues = validateRouteDefinition(overlappingRoute);
  expect(issues).toContainEqual({
    path: 'gates[1].collider',
    message: `Gate colliders must remain at least ${ROUTE_MIN_GATE_SEPARATION} world units apart in plan view.`,
  });
  expect(issues).toContainEqual({
    path: 'encounters[0].spawns[1].position',
    message: `Encounter spawns must remain at least ${ROUTE_MIN_SPAWN_SEPARATION} world units apart.`,
  });
});
