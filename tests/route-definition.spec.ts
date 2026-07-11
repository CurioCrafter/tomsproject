import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { FIRMAMENT_ROUTE, FIRMAMENT_ROUTE_WALKABLE } from '../src/game/content/FirmamentRoute';
import type { CampaignRouteDefinition } from '../src/game/content/RouteTypes';
import {
  probeRouteGatePartitions,
  ROUTE_GATE_PARTITION_PLAYER_RADIUS,
  validateRouteDefinition,
} from '../src/game/content/validateRoute';
import { CollisionSystem } from '../src/systems/CollisionSystem';

test('every authored encounter gate partitions the player-walkable route', () => {
  const result = probeRouteGatePartitions(FIRMAMENT_ROUTE);

  expect(result.playerRadius).toBe(ROUTE_GATE_PARTITION_PLAYER_RADIUS);
  expect(result.baselineReachable).toBe(true);
  expect(result.checkedGateIds).toEqual(FIRMAMENT_ROUTE.gates.map((gate) => gate.id));
  expect(result.bypassableGateIds).toEqual([]);
  expect(result.cellCount).toBeLessThanOrEqual(250_000);
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
