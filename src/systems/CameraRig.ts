import * as THREE from 'three';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly framedTarget = new THREE.Vector3();
  private readonly shakeOffset = new THREE.Vector3();
  private readonly occlusionDirection = new THREE.Vector3();
  private readonly occlusionRay = new THREE.Raycaster();
  private readonly occlusionRoots: THREE.Object3D[] = [];
  private readonly hiddenOccluders: THREE.Object3D[] = [];
  private shakeStrength = 0;
  private shakeTime = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly offset = new THREE.Vector3(0, 6.6, 10.8),
  ) {}

  setOcclusionRoots(roots: readonly THREE.Object3D[]): void {
    this.restoreOccluders();
    this.occlusionRoots.length = 0;
    this.occlusionRoots.push(...roots);
  }

  snapTo(target: THREE.Vector3): void {
    this.desiredPosition.copy(target).add(this.offset);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(target).add(new THREE.Vector3(0, 0.9, -2.2));
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, lag: number, combatTarget: THREE.Vector3 | null = null): void {
    this.restoreOccluders();
    const portrait = this.camera.aspect < 0.82;
    const heightScale = portrait ? 1.32 : 1;
    const distanceScale = portrait ? 1.4 : 1;
    this.desiredPosition.set(
      target.x + this.offset.x,
      target.y + this.offset.y * heightScale,
      target.z + this.offset.z * distanceScale,
    );
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag));
    this.camera.position.lerp(this.desiredPosition, factor);

    this.framedTarget.copy(target).addScaledVector(this.offset, 0);
    if (combatTarget) {
      this.framedTarget.lerp(combatTarget, portrait ? 0.15 : 0.24);
    } else {
      this.framedTarget.z -= 2.2;
    }
    this.framedTarget.y += 0.72;
    this.lookTarget.lerp(this.framedTarget, 1 - Math.exp(-delta * 12));

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      const decay = Math.min(1, this.shakeTime * 7);
      this.shakeOffset.set(
        Math.sin(this.shakeTime * 73) * this.shakeStrength * decay,
        Math.sin(this.shakeTime * 101 + 1.2) * this.shakeStrength * 0.55 * decay,
        Math.cos(this.shakeTime * 83) * this.shakeStrength * 0.35 * decay,
      );
      this.camera.position.add(this.shakeOffset);
    }
    this.camera.lookAt(this.lookTarget);
    this.hideBlockingWorldGeometry();
  }

  kick(strength = 0.16, duration = 0.18): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  private hideBlockingWorldGeometry(): void {
    if (this.occlusionRoots.length === 0) return;
    this.occlusionDirection.copy(this.camera.position).sub(this.lookTarget);
    const distance = this.occlusionDirection.length();
    if (distance < 1) return;
    this.occlusionRay.set(this.lookTarget, this.occlusionDirection.multiplyScalar(1 / distance));
    this.occlusionRay.near = 0.8;
    this.occlusionRay.far = Math.max(0.8, distance - 0.45);
    const seen = new Set<THREE.Object3D>();
    for (const intersection of this.occlusionRay.intersectObjects(this.occlusionRoots, true)) {
      const object = intersection.object;
      if (seen.has(object) || object.userData.neverCameraOcclude) continue;
      seen.add(object);
      object.visible = false;
      this.hiddenOccluders.push(object);
      if (this.hiddenOccluders.length >= 8) break;
    }
  }

  private restoreOccluders(): void {
    for (const object of this.hiddenOccluders) object.visible = true;
    this.hiddenOccluders.length = 0;
  }
}
