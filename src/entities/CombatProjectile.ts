import * as THREE from 'three';

export type ProjectileFaction = 'player' | 'enemy';
export type ProjectileKind = 'lunar' | 'aurora' | 'star' | 'eclipse';

export class CombatProjectile {
  readonly group = new THREE.Group();
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly radius: number;
  active = true;
  lifetime: number;
  private surfaceHeight = 0;

  private readonly geometry: THREE.BufferGeometry;
  private readonly ringGeometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly ringMaterial: THREE.MeshBasicMaterial;

  constructor(
    readonly faction: ProjectileFaction,
    readonly kind: ProjectileKind,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    readonly damage: number,
    radius = 0.22,
    lifetime = 3.2,
  ) {
    this.radius = radius;
    this.lifetime = lifetime;
    const color = this.getColor();
    this.geometry = kind === 'eclipse'
      ? new THREE.OctahedronGeometry(radius * 1.35, 0)
      : new THREE.IcosahedronGeometry(radius, 1);
    this.ringGeometry = new THREE.TorusGeometry(radius * 1.65, Math.max(0.018, radius * 0.08), 6, 18);
    this.material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: kind === 'lunar' ? 2.6 : 2.1,
      roughness: 0.15,
      metalness: 0.08,
      transparent: true,
      opacity: 0.94,
    });
    this.ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false });
    const core = new THREE.Mesh(this.geometry, this.material);
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    this.group.add(core, ring);
    this.group.position.copy(position);
    this.surfaceHeight = position.y - 0.78;
    this.previousPosition.copy(position);
    this.velocity.copy(direction).setY(0).normalize().multiplyScalar(speed);
  }

  update(delta: number, elapsed: number): void {
    if (!this.active) return;
    this.previousPosition.copy(this.group.position);
    this.group.position.addScaledVector(this.velocity, delta);
    this.group.position.y = this.surfaceHeight + 0.78 + Math.sin(elapsed * 16 + this.group.id) * 0.055;
    this.group.rotation.y += delta * 7;
    this.group.rotation.z += delta * 4;
    this.lifetime -= delta;
    if (this.lifetime <= 0) this.active = false;
    this.material.opacity = Math.min(0.94, Math.max(0, this.lifetime * 2));
    this.ringMaterial.opacity = this.material.opacity * 0.75;
  }

  deactivate(): void {
    this.active = false;
    this.group.visible = false;
  }

  setSurfaceHeight(height: number): void {
    if (!Number.isFinite(height)) return;
    this.surfaceHeight = height;
    this.group.position.y = height + 0.78;
  }

  dispose(): void {
    this.geometry.dispose();
    this.ringGeometry.dispose();
    this.material.dispose();
    this.ringMaterial.dispose();
  }

  private getColor(): THREE.ColorRepresentation {
    if (this.kind === 'lunar') return '#bbdcff';
    if (this.kind === 'aurora') return '#6fffd0';
    if (this.kind === 'eclipse') return '#d32667';
    return this.faction === 'enemy' ? '#ff6b71' : '#f0efff';
  }
}
