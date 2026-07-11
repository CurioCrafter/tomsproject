import * as THREE from 'three';
import { createSorcererModel, type AuthoredModel } from '../assets/GameModels';
import { MaterialLibrary } from '../assets/MaterialLibrary';
import { appearanceFromProfile, appearanceSignature } from '../game/CharacterAppearance';
import type { CharacterProfile } from '../game/CharacterProfile';

export class CharacterPreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(31, 1, 0.1, 20);
  private readonly materials: MaterialLibrary;
  private readonly portraitRoot = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private model: AuthoredModel | null = null;
  private signature = '';
  private animationFrame = 0;
  private previousFrameTime = 0;
  private elapsed = 0;
  private needsRender = true;
  private reducedMotion = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    initialProfile: CharacterProfile,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.setClearColor(0x000000, 0);
    this.materials = new MaterialLibrary({
      anisotropy: Math.min(4, this.renderer.capabilities.getMaxAnisotropy()),
    });

    this.scene.add(this.portraitRoot);
    this.camera.position.set(0, 1.42, 5.15);
    this.camera.lookAt(0, 1.18, 0);

    const hemisphere = new THREE.HemisphereLight('#c9e7ff', '#071012', 2.1);
    const key = new THREE.DirectionalLight('#d7eaff', 4.2);
    key.position.set(-3.5, 5.2, 4.5);
    const auroraRim = new THREE.PointLight('#65f0c0', 8.5, 8, 2);
    auroraRim.position.set(2.5, 2.7, -1.8);
    const eclipseRim = new THREE.PointLight('#c23b62', 4, 7, 2);
    eclipseRim.position.set(-2.8, 1.7, -2.4);
    this.scene.add(hemisphere, key, auroraRim, eclipseRim);

    const pedestalMaterial = new THREE.MeshBasicMaterial({
      color: '#78e7c2',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pedestal = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.9, 64), pedestalMaterial);
    pedestal.name = 'characterPreviewPedestal';
    pedestal.rotation.x = -Math.PI / 2;
    pedestal.position.y = 0.012;
    this.portraitRoot.add(pedestal);

    this.resizeObserver = new ResizeObserver(() => {
      this.needsRender = true;
      this.resize();
    });
    this.resizeObserver.observe(canvas);
    this.setProfile(initialProfile);
  }

  start(): void {
    if (this.disposed || this.animationFrame) return;
    this.previousFrameTime = performance.now();
    this.animationFrame = window.requestAnimationFrame(this.renderFrame);
  }

  setProfile(profile: CharacterProfile): void {
    const nextSignature = appearanceSignature(profile);
    if (nextSignature === this.signature) return;
    this.signature = nextSignature;
    if (this.model) {
      this.portraitRoot.remove(this.model.root);
      this.model.dispose();
    }
    this.model = createSorcererModel(this.materials, appearanceFromProfile(profile));
    this.model.root.name = 'characterPreviewModel';
    this.model.root.rotation.y = Math.PI - 0.18;
    this.portraitRoot.add(this.model.root);
    this.needsRender = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    this.resizeObserver.disconnect();
    this.model?.dispose();
    this.model = null;
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly renderFrame = (frameTime: DOMHighResTimeStamp): void => {
    if (this.disposed) return;
    const delta = Math.min(0.05, Math.max(0, (frameTime - this.previousFrameTime) / 1000));
    this.previousFrameTime = frameTime;
    this.elapsed += delta;
    const elapsed = this.elapsed;
    const reducedMotion =
      document.documentElement.dataset.reducedMotion === 'true' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion !== this.reducedMotion) {
      this.reducedMotion = reducedMotion;
      this.needsRender = true;
      if (reducedMotion && this.model) {
        this.model.root.rotation.y = Math.PI - 0.18;
        this.portraitRoot.position.y = 0;
        const pedestal = this.portraitRoot.getObjectByName('characterPreviewPedestal');
        if (pedestal) pedestal.rotation.z = 0;
      }
    }
    if (!this.canvas.closest('[hidden]') && this.resize()) {
      if (!reducedMotion || this.needsRender) {
        if (!reducedMotion) {
          this.model?.update(delta, elapsed, 0.72);
          if (this.model) this.model.root.rotation.y = Math.PI - 0.22 + Math.sin(elapsed * 0.34) * 0.16;
          this.portraitRoot.position.y = Math.sin(elapsed * 0.8) * 0.018;
          const pedestal = this.portraitRoot.getObjectByName('characterPreviewPedestal');
          if (pedestal) pedestal.rotation.z = elapsed * 0.08;
        }
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
    }
    this.animationFrame = window.requestAnimationFrame(this.renderFrame);
  };

  private resize(): boolean {
    const width = Math.floor(this.canvas.clientWidth);
    const height = Math.floor(this.canvas.clientHeight);
    if (width < 2 || height < 2) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.needsRender = true;
    }
    return true;
  }
}
