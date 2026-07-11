import * as THREE from 'three';
import type { ArenaBounds } from '../entities/Player';
import type {
  GateDefinition,
  GateStateSnapshot,
  RouteShape,
  ThickSegmentCollider,
} from '../game/content/RouteTypes';

export type CircleObstacle = {
  x: number;
  z: number;
  radius: number;
};

export type GateSweepHit = {
  readonly gateId: string;
  readonly t: number;
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
};

type DynamicGateCollider = {
  readonly collider: ThickSegmentCollider;
  closed: boolean;
};

const EPSILON = 0.000_001;

export class CollisionSystem {
  private readonly closest = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private routeWalkableRegions: readonly RouteShape[] = [];
  private readonly dynamicGates = new Map<string, DynamicGateCollider>();
  activeContacts = 0;

  get routeRegionCount(): number {
    return this.routeWalkableRegions.length;
  }

  get dynamicGateCount(): number {
    return this.dynamicGates.size;
  }

  get closedGateCount(): number {
    let count = 0;
    this.dynamicGates.forEach((gate) => {
      if (gate.closed) count += 1;
    });
    return count;
  }

  beginStep(): void {
    this.activeContacts = 0;
  }

  configureRouteCollision(
    regions: readonly RouteShape[],
    gates: readonly GateDefinition[],
    states?: readonly GateStateSnapshot[],
  ): void {
    this.setRouteWalkableRegions(regions);
    this.configureDynamicGates(gates);
    if (states) this.syncGateStates(states);
  }

  setRouteWalkableRegions(regions: readonly RouteShape[]): void {
    this.routeWalkableRegions = regions;
  }

  configureDynamicGates(gates: readonly GateDefinition[]): void {
    this.dynamicGates.clear();
    gates.forEach((gate) => {
      this.dynamicGates.set(gate.id, {
        collider: gate.collider,
        closed: gate.initialState === 'closed',
      });
    });
  }

  syncGateStates(states: readonly GateStateSnapshot[]): void {
    states.forEach((state) => this.setGateClosed(state.id, state.state === 'closed'));
  }

  setGateClosed(gateId: string, closed: boolean): boolean {
    const gate = this.dynamicGates.get(gateId);
    if (!gate) return false;
    gate.closed = closed;
    return true;
  }

  isGateClosed(gateId: string): boolean {
    return this.dynamicGates.get(gateId)?.closed ?? false;
  }

  clearRouteCollision(): void {
    this.routeWalkableRegions = [];
    this.dynamicGates.clear();
  }

  circlesOverlap(a: THREE.Vector3, aRadius: number, b: THREE.Vector3, bRadius: number): boolean {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    const radius = aRadius + bRadius;
    const hit = dx * dx + dz * dz <= radius * radius;
    if (hit) this.activeContacts += 1;
    return hit;
  }

  isInCone(origin: THREE.Vector3, forward: THREE.Vector3, range: number, halfAngle: number, target: THREE.Vector3, targetRadius = 0): boolean {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const distanceSq = dx * dx + dz * dz;
    const reach = range + targetRadius;
    if (distanceSq > reach * reach) return false;
    if (distanceSq < 0.0001) return true;
    const inverseDistance = 1 / Math.sqrt(distanceSq);
    const dot = (dx * forward.x + dz * forward.z) * inverseDistance;
    const hit = dot >= Math.cos(halfAngle);
    if (hit) this.activeContacts += 1;
    return hit;
  }

  sweepCircle(start: THREE.Vector3, end: THREE.Vector3, movingRadius: number, target: THREE.Vector3, targetRadius: number): boolean {
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    let t = 0;
    if (lengthSq > 0.000001) {
      t = THREE.MathUtils.clamp(((target.x - start.x) * segmentX + (target.z - start.z) * segmentZ) / lengthSq, 0, 1);
    }
    this.closest.set(start.x + segmentX * t, 0, start.z + segmentZ * t);
    const dx = this.closest.x - target.x;
    const dz = this.closest.z - target.z;
    const radius = movingRadius + targetRadius;
    const hit = dx * dx + dz * dz <= radius * radius;
    if (hit) this.activeContacts += 1;
    return hit;
  }

  containsInWalkableUnion(
    position: THREE.Vector3,
    radius = 0,
    regions: readonly RouteShape[] = this.routeWalkableRegions,
  ): boolean {
    return regions.some((region) => this.routeShapeContainsCircle(region, position.x, position.z, radius));
  }

  /** Projects a circle center to the nearest point that fits inside any route region. */
  projectToWalkableUnion(
    position: THREE.Vector3,
    radius = 0,
    target: THREE.Vector3 = position,
    regions: readonly RouteShape[] = this.routeWalkableRegions,
  ): boolean {
    let found = false;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestX = position.x;
    let bestZ = position.z;
    const safeRadius = Math.max(0, radius);

    for (const region of regions) {
      let candidateX = position.x;
      let candidateZ = position.z;
      if (region.kind === 'circle') {
        const allowedRadius = region.radius - safeRadius;
        if (allowedRadius < 0) continue;
        const dx = position.x - region.center[0];
        const dz = position.z - region.center[1];
        const distance = Math.hypot(dx, dz);
        if (distance > allowedRadius && distance > EPSILON) {
          const scale = allowedRadius / distance;
          candidateX = region.center[0] + dx * scale;
          candidateZ = region.center[1] + dz * scale;
        } else if (distance > allowedRadius) {
          candidateX = region.center[0];
          candidateZ = region.center[1];
        }
      } else {
        const allowedX = region.halfExtents[0] - safeRadius;
        const allowedZ = region.halfExtents[1] - safeRadius;
        if (allowedX < 0 || allowedZ < 0) continue;
        const dx = position.x - region.center[0];
        const dz = position.z - region.center[1];
        const cosine = Math.cos(region.rotation);
        const sine = Math.sin(region.rotation);
        const localX = THREE.MathUtils.clamp(cosine * dx + sine * dz, -allowedX, allowedX);
        const localZ = THREE.MathUtils.clamp(-sine * dx + cosine * dz, -allowedZ, allowedZ);
        candidateX = region.center[0] + cosine * localX - sine * localZ;
        candidateZ = region.center[1] + sine * localX + cosine * localZ;
      }

      const correctionX = candidateX - position.x;
      const correctionZ = candidateZ - position.z;
      const distanceSq = correctionX * correctionX + correctionZ * correctionZ;
      if (distanceSq >= bestDistanceSq) continue;
      found = true;
      bestDistanceSq = distanceSq;
      bestX = candidateX;
      bestZ = candidateZ;
    }

    if (!found) return false;
    target.set(bestX, position.y, bestZ);
    return true;
  }

  /**
   * Resolves one character movement against the walkable union and closed
   * dynamic gates. Existing arena collision remains available through
   * resolveWorld for the currently shipped runtime.
   */
  resolveRouteMovement(
    previous: THREE.Vector3,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    radius: number,
    regions: readonly RouteShape[] = this.routeWalkableRegions,
  ): void {
    if (regions.length > 0 && !this.containsInWalkableUnion(position, radius, regions)) {
      const outsideX = position.x;
      const outsideZ = position.z;
      if (this.projectToWalkableUnion(position, radius, this.projected, regions)) {
        position.copy(this.projected);
        this.removeVelocityIntoCorrection(velocity, position.x - outsideX, position.z - outsideZ);
      } else {
        position.copy(previous);
        velocity.x = 0;
        velocity.z = 0;
      }
      this.activeContacts += 1;
    }

    const hit = this.sweepClosedGates(previous, position, radius);
    if (hit) {
      const movementX = position.x - previous.x;
      const movementY = position.y - previous.y;
      const movementZ = position.z - previous.z;
      const movementLength = Math.hypot(movementX, movementZ);
      const safeT = Math.max(0, hit.t - (movementLength > EPSILON ? 0.002 / movementLength : 0));
      position.set(
        previous.x + movementX * safeT + hit.normal.x * 0.002,
        previous.y + movementY * safeT,
        previous.z + movementZ * safeT + hit.normal.z * 0.002,
      );
      this.removeVelocityIntoCorrection(velocity, hit.normal.x, hit.normal.z);
    }
    this.resolveDynamicGateOverlaps(position, velocity, radius);
  }

  sweepClosedGates(start: THREE.Vector3, end: THREE.Vector3, movingRadius: number): GateSweepHit | null {
    let earliest: GateSweepHit | null = null;
    this.dynamicGates.forEach((gate, gateId) => {
      if (!gate.closed) return;
      const combinedRadius = Math.max(0, movingRadius) + gate.collider.thickness * 0.5;
      const closestT = this.closestMovementParameterToSegment(start, end, gate.collider);
      const closestDistanceSq = this.distanceAtMovementParameterSq(start, end, closestT, gate.collider);
      if (closestDistanceSq > combinedRadius * combinedRadius + EPSILON) return;

      let hitT = 0;
      if (this.distanceAtMovementParameterSq(start, end, 0, gate.collider) > combinedRadius * combinedRadius) {
        let low = 0;
        let high = closestT;
        for (let iteration = 0; iteration < 20; iteration += 1) {
          const middle = (low + high) * 0.5;
          if (this.distanceAtMovementParameterSq(start, end, middle, gate.collider) <= combinedRadius * combinedRadius) high = middle;
          else low = middle;
        }
        hitT = high;
      }
      if (earliest && hitT >= earliest.t) return;

      const hitX = THREE.MathUtils.lerp(start.x, end.x, hitT);
      const hitY = THREE.MathUtils.lerp(start.y, end.y, hitT);
      const hitZ = THREE.MathUtils.lerp(start.z, end.z, hitT);
      this.closestPointOnSegment(hitX, hitZ, gate.collider, this.closest);
      let normalX = hitX - this.closest.x;
      let normalZ = hitZ - this.closest.z;
      const normalLength = Math.hypot(normalX, normalZ);
      if (normalLength > EPSILON) {
        normalX /= normalLength;
        normalZ /= normalLength;
      } else {
        const gateX = gate.collider.b[0] - gate.collider.a[0];
        const gateZ = gate.collider.b[1] - gate.collider.a[1];
        const gateLength = Math.max(EPSILON, Math.hypot(gateX, gateZ));
        normalX = -gateZ / gateLength;
        normalZ = gateX / gateLength;
        const startSide = (start.x - gate.collider.a[0]) * normalX + (start.z - gate.collider.a[1]) * normalZ;
        if (startSide < 0 || (Math.abs(startSide) <= EPSILON && (end.x - start.x) * normalX + (end.z - start.z) * normalZ > 0)) {
          normalX *= -1;
          normalZ *= -1;
        }
      }
      earliest = {
        gateId,
        t: hitT,
        point: new THREE.Vector3(hitX, hitY, hitZ),
        normal: new THREE.Vector3(normalX, 0, normalZ),
      };
    });
    if (earliest) this.activeContacts += 1;
    return earliest;
  }

  resolveWorld(position: THREE.Vector3, velocity: THREE.Vector3, radius: number, bounds: ArenaBounds, obstacles: readonly CircleObstacle[]): void {
    position.x = THREE.MathUtils.clamp(position.x, -bounds.halfWidth + radius, bounds.halfWidth - radius);
    position.z = THREE.MathUtils.clamp(position.z, -bounds.halfDepth + radius, bounds.halfDepth - radius);
    for (const obstacle of obstacles) {
      const dx = position.x - obstacle.x;
      const dz = position.z - obstacle.z;
      const minimum = radius + obstacle.radius;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq >= minimum * minimum) continue;
      this.activeContacts += 1;
      if (distanceSq < 0.000001) {
        position.x += minimum;
        velocity.x = Math.max(0, velocity.x);
        continue;
      }
      const distance = Math.sqrt(distanceSq);
      const normalX = dx / distance;
      const normalZ = dz / distance;
      const penetration = minimum - distance;
      position.x += normalX * penetration;
      position.z += normalZ * penetration;
      const into = velocity.x * normalX + velocity.z * normalZ;
      if (into < 0) {
        velocity.x -= normalX * into;
        velocity.z -= normalZ * into;
      }
    }
  }

  private routeShapeContainsCircle(shape: RouteShape, x: number, z: number, radius: number): boolean {
    const safeRadius = Math.max(0, radius);
    const dx = x - shape.center[0];
    const dz = z - shape.center[1];
    if (shape.kind === 'circle') {
      const allowed = shape.radius - safeRadius;
      return allowed >= 0 && dx * dx + dz * dz <= allowed * allowed + EPSILON;
    }
    const allowedX = shape.halfExtents[0] - safeRadius;
    const allowedZ = shape.halfExtents[1] - safeRadius;
    if (allowedX < 0 || allowedZ < 0) return false;
    const cosine = Math.cos(shape.rotation);
    const sine = Math.sin(shape.rotation);
    const localX = cosine * dx + sine * dz;
    const localZ = -sine * dx + cosine * dz;
    return Math.abs(localX) <= allowedX + EPSILON && Math.abs(localZ) <= allowedZ + EPSILON;
  }

  private resolveDynamicGateOverlaps(position: THREE.Vector3, velocity: THREE.Vector3, radius: number): void {
    this.dynamicGates.forEach((gate) => {
      if (!gate.closed) return;
      this.closestPointOnSegment(position.x, position.z, gate.collider, this.closest);
      let normalX = position.x - this.closest.x;
      let normalZ = position.z - this.closest.z;
      const minimum = Math.max(0, radius) + gate.collider.thickness * 0.5;
      const distanceSq = normalX * normalX + normalZ * normalZ;
      if (distanceSq >= minimum * minimum) return;
      let distance = Math.sqrt(distanceSq);
      if (distance <= EPSILON) {
        const gateX = gate.collider.b[0] - gate.collider.a[0];
        const gateZ = gate.collider.b[1] - gate.collider.a[1];
        const gateLength = Math.max(EPSILON, Math.hypot(gateX, gateZ));
        normalX = -gateZ / gateLength;
        normalZ = gateX / gateLength;
        if (velocity.x * normalX + velocity.z * normalZ > 0) {
          normalX *= -1;
          normalZ *= -1;
        }
        distance = 0;
      } else {
        normalX /= distance;
        normalZ /= distance;
      }
      const penetration = minimum - distance;
      position.x += normalX * penetration;
      position.z += normalZ * penetration;
      this.removeVelocityIntoCorrection(velocity, normalX, normalZ);
      this.activeContacts += 1;
    });
  }

  private removeVelocityIntoCorrection(velocity: THREE.Vector3, correctionX: number, correctionZ: number): void {
    const length = Math.hypot(correctionX, correctionZ);
    if (length <= EPSILON) return;
    const normalX = correctionX / length;
    const normalZ = correctionZ / length;
    const into = velocity.x * normalX + velocity.z * normalZ;
    if (into < 0) {
      velocity.x -= normalX * into;
      velocity.z -= normalZ * into;
    }
  }

  private closestMovementParameterToSegment(start: THREE.Vector3, end: THREE.Vector3, segment: ThickSegmentCollider): number {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const first = (low * 2 + high) / 3;
      const second = (low + high * 2) / 3;
      const firstDistance = this.distanceAtMovementParameterSq(start, end, first, segment);
      const secondDistance = this.distanceAtMovementParameterSq(start, end, second, segment);
      if (firstDistance <= secondDistance) high = second;
      else low = first;
    }
    return (low + high) * 0.5;
  }

  private distanceAtMovementParameterSq(
    start: THREE.Vector3,
    end: THREE.Vector3,
    t: number,
    segment: ThickSegmentCollider,
  ): number {
    const x = THREE.MathUtils.lerp(start.x, end.x, t);
    const z = THREE.MathUtils.lerp(start.z, end.z, t);
    this.closestPointOnSegment(x, z, segment, this.closest);
    const dx = x - this.closest.x;
    const dz = z - this.closest.z;
    return dx * dx + dz * dz;
  }

  private closestPointOnSegment(x: number, z: number, segment: ThickSegmentCollider, target: THREE.Vector3): void {
    const segmentX = segment.b[0] - segment.a[0];
    const segmentZ = segment.b[1] - segment.a[1];
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    const t = lengthSq <= EPSILON
      ? 0
      : THREE.MathUtils.clamp(((x - segment.a[0]) * segmentX + (z - segment.a[1]) * segmentZ) / lengthSq, 0, 1);
    target.set(segment.a[0] + segmentX * t, 0, segment.a[1] + segmentZ * t);
  }
}
