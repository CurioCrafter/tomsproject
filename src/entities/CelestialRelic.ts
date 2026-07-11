import * as THREE from 'three';
import type { AuthoredModel } from '../assets/GameModels';

export type RelicKind = 'moon' | 'aurora' | 'constellation';
export type RelicState = 'sealed' | 'ready' | 'restored';

const COLORS: Record<RelicKind, THREE.ColorRepresentation> = {
  moon: '#bfdcff',
  aurora: '#63ffd0',
  constellation: '#ffbea8',
};

export class CelestialRelic {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  readonly radius = 1.25;
  state: RelicState = 'sealed';

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly core: THREE.Mesh;
  private readonly rings = new THREE.Group();
  private readonly beacon: THREE.Mesh;
  private readonly seal: THREE.Mesh;
  private authoredModel: AuthoredModel | null = null;

  constructor(
    readonly index: number,
    readonly kind: RelicKind,
    position: THREE.Vector3,
  ) {
    const stoneMaterial = this.material(new THREE.MeshStandardMaterial({ color: '#18232c', roughness: 0.86, metalness: 0.08 }));
    const glowMaterial = this.material(new THREE.MeshStandardMaterial({
      color: COLORS[kind],
      emissive: COLORS[kind],
      emissiveIntensity: 0.45,
      roughness: 0.2,
      transparent: true,
      opacity: 0.86,
    }));
    const base = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(1.28, 1.55, 0.48, 10)), stoneMaterial);
    base.position.y = 0.24;
    base.castShadow = true;
    base.receiveShadow = true;
    this.group.add(base);

    this.core = new THREE.Mesh(this.geometry(new THREE.DodecahedronGeometry(0.48, 0)), glowMaterial);
    this.core.position.y = 1.35;
    this.core.castShadow = true;
    this.group.add(this.core);

    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(
        this.geometry(new THREE.TorusGeometry(0.72 + i * 0.18, 0.026, 7, 40)),
        glowMaterial,
      );
      ring.rotation.set(Math.PI / 2 + i * 0.48, i * 0.72, 0);
      this.rings.add(ring);
    }
    this.rings.position.y = 1.35;
    this.group.add(this.rings);

    const beaconMaterial = this.material(new THREE.MeshBasicMaterial({
      color: COLORS[kind],
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.beacon = new THREE.Mesh(this.geometry(new THREE.CylinderGeometry(0.16, 0.72, 14, 14, 1, true)), beaconMaterial);
    this.beacon.position.y = 7.2;
    this.beacon.visible = false;
    this.group.add(this.beacon);

    const sealMaterial = this.material(new THREE.MeshBasicMaterial({ color: '#d32f64', transparent: true, opacity: 0.66, depthWrite: false }));
    this.seal = new THREE.Mesh(this.geometry(new THREE.RingGeometry(1.52, 1.68, 48)), sealMaterial);
    this.seal.rotation.x = -Math.PI / 2;
    this.seal.position.y = 0.04;
    this.group.add(this.seal);
    this.group.position.copy(position);
  }

  setReady(): void {
    if (this.state !== 'sealed') return;
    this.state = 'ready';
    this.beacon.visible = true;
    this.seal.visible = false;
  }

  useAuthoredModel(model: AuthoredModel): void {
    if (this.authoredModel) {
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
    }
    const beaconIndex = this.group.children.indexOf(this.beacon);
    for (let index = 0; index < beaconIndex; index += 1) this.group.children[index].visible = false;
    this.authoredModel = model;
    this.group.add(model.root);
  }

  restore(): boolean {
    if (this.state !== 'ready') return false;
    this.state = 'restored';
    this.beacon.visible = true;
    return true;
  }

  reset(): void {
    this.state = 'sealed';
    this.beacon.visible = false;
    this.seal.visible = true;
    this.core.visible = true;
  }

  update(delta: number, elapsed: number): void {
    this.authoredModel?.update(delta, elapsed, this.state === 'sealed' ? 0.5 : this.state === 'ready' ? 1.25 : 2);
    const readyEnergy = this.state === 'sealed' ? 0.42 : this.state === 'ready' ? 1.4 : 2.4;
    this.rings.rotation.y += delta * (this.state === 'restored' ? 1.25 : 0.55);
    this.rings.rotation.z -= delta * 0.24;
    this.core.rotation.x += delta * 0.5;
    this.core.rotation.y += delta * 0.8;
    this.core.position.y = 1.35 + Math.sin(elapsed * 2.2 + this.index) * 0.12;
    const material = this.core.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = readyEnergy + Math.sin(elapsed * 4 + this.index) * 0.22;
    const scale = this.state === 'ready' ? 1 + Math.sin(elapsed * 5) * 0.08 : 1;
    this.core.scale.setScalar(scale);
    if (this.state === 'restored') {
      const beaconMaterial = this.beacon.material as THREE.MeshBasicMaterial;
      beaconMaterial.opacity = 0.13 + Math.sin(elapsed * 2.5 + this.index) * 0.035;
    }
  }

  dispose(): void {
    if (this.authoredModel) {
      this.authoredModel.root.removeFromParent();
      this.authoredModel.dispose();
      this.authoredModel = null;
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}
