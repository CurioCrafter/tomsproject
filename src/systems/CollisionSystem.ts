import * as THREE from 'three';
import type { ArenaBounds } from '../entities/Player';

export type CircleObstacle = {
  x: number;
  z: number;
  radius: number;
};

export class CollisionSystem {
  private readonly closest = new THREE.Vector3();
  activeContacts = 0;

  beginStep(): void {
    this.activeContacts = 0;
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
}
