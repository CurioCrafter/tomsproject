import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { FIRMAMENT_ROUTE, FIRMAMENT_ROUTE_WALKABLE } from '../src/game/content/FirmamentRoute';
import { getAllRouteSections, routeSectionElevationAt } from '../src/game/content/RouteGeometry';
import type { CampaignRouteDefinition, EncounterDefinition } from '../src/game/content/RouteTypes';
import {
  probeRouteGatePartitions,
  ROUTE_GATE_PARTITION_PLAYER_RADIUS,
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
