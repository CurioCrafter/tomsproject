import * as THREE from 'three';

export type GameAction =
  | 'melee'
  | 'lunar'
  | 'aurora'
  | 'dodge'
  | 'lock'
  | 'interact'
  | 'pause'
  | 'restart';

type PointerState = {
  active: boolean;
  id: number | null;
  centerX: number;
  centerY: number;
  radius: number;
};

type IntentEventDetail = {
  action?: GameAction;
  pressed?: boolean;
};

type ButtonBinding = {
  element: HTMLElement;
  action: GameAction;
  down: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
};

const ACTION_BY_KEY: Partial<Record<string, GameAction>> = {
  Space: 'dodge',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyJ: 'melee',
  KeyQ: 'lunar',
  KeyE: 'aurora',
  Tab: 'lock',
  KeyF: 'interact',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'restart',
  Enter: 'restart',
};

const isGameAction = (value: string): value is GameAction =>
  value === 'melee' ||
  value === 'lunar' ||
  value === 'aurora' ||
  value === 'dodge' ||
  value === 'lock' ||
  value === 'interact' ||
  value === 'pause' ||
  value === 'restart';

export class InputController {
  private readonly keys = new Set<string>();
  private readonly heldActions = new Set<GameAction>();
  private readonly pressedActions = new Set<GameAction>();
  private readonly movementPointer = new THREE.Vector2();
  private readonly keyVector = new THREE.Vector2();
  private readonly pointerAim = new THREE.Vector2();
  private pointerAimActive = false;
  private readonly buttonBindings: ButtonBinding[] = [];
  private readonly pointerState: PointerState = {
    active: false,
    id: null,
    centerX: 0,
    centerY: 0,
    radius: 1,
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.keys.has(event.code)) {
      const action = ACTION_BY_KEY[event.code];
      if (action) this.pressAction(action);
    }
    this.keys.add(event.code);

    if (
      ACTION_BY_KEY[event.code] ||
      event.code.startsWith('Arrow') ||
      event.code === 'Space'
    ) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    const action = ACTION_BY_KEY[event.code];
    if (action) this.heldActions.delete(action);
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.heldActions.clear();
    this.movementPointer.set(0, 0);
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.updateKnob();
  };

  private readonly onStickDown = (event: PointerEvent) => {
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect();
    this.pointerState.active = true;
    this.pointerState.id = event.pointerId;
    this.pointerState.centerX = rect.left + rect.width / 2;
    this.pointerState.centerY = rect.top + rect.height / 2;
    this.pointerState.radius = Math.max(1, rect.width * 0.42);
    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic test events do not always have a capturable pointer id.
    }
    this.updateMovementPointer(event.clientX, event.clientY);
  };

  private readonly onStickMove = (event: PointerEvent) => {
    if (!this.pointerState.active || event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.updateMovementPointer(event.clientX, event.clientY);
  };

  private readonly onStickUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerState.id) return;
    event.preventDefault();
    this.pointerState.active = false;
    this.pointerState.id = null;
    this.movementPointer.set(0, 0);
    this.updateKnob();
  };

  private readonly onDashDown = (event: PointerEvent) => {
    event.preventDefault();
    this.pressAction('dodge');
  };

  private readonly onDashUp = (event: PointerEvent) => {
    event.preventDefault();
    this.heldActions.delete('dodge');
  };

  private readonly onWindowPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    this.updateAim(event.clientX, event.clientY);
  };

  private readonly onWindowPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLCanvasElement)) return;
    this.updateAim(event.clientX, event.clientY);
    if (event.button === 0) this.pressAction('melee');
    if (event.button === 1) this.pressAction('aurora');
    if (event.button === 2) this.pressAction('lunar');
  };

  private readonly onWindowPointerUp = (event: PointerEvent) => {
    if (event.button === 0) this.heldActions.delete('melee');
    if (event.button === 1) this.heldActions.delete('aurora');
    if (event.button === 2) this.heldActions.delete('lunar');
  };

  private readonly onContextMenu = (event: MouseEvent) => {
    if (event.target instanceof HTMLCanvasElement) event.preventDefault();
  };

  private readonly onIntentEvent = (event: Event) => {
    const detail = (event as CustomEvent<IntentEventDetail>).detail;
    if (!detail?.action || !isGameAction(detail.action)) return;
    if (detail.pressed === false) this.heldActions.delete(detail.action);
    else this.pressAction(detail.action);
  };

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly dashButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerdown', this.onWindowPointerDown);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('celestial-game-intent', this.onIntentEvent);
    this.stick.addEventListener('pointerdown', this.onStickDown);
    this.stick.addEventListener('pointermove', this.onStickMove);
    this.stick.addEventListener('pointerup', this.onStickUp);
    this.stick.addEventListener('pointercancel', this.onStickUp);
    this.dashButton.addEventListener('pointerdown', this.onDashDown);
    this.dashButton.addEventListener('pointerup', this.onDashUp);
    this.dashButton.addEventListener('pointercancel', this.onDashUp);
    this.dashButton.addEventListener('pointerleave', this.onDashUp);
    this.bindActionButtons();
  }

  readMovement(target: THREE.Vector2): THREE.Vector2 {
    this.keyVector.set(0, 0);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.keyVector.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.keyVector.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.keyVector.y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.keyVector.y += 1;

    target.copy(this.keyVector).add(this.movementPointer);
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  readAim(target: THREE.Vector2): THREE.Vector2 {
    return target.copy(this.pointerAim);
  }

  hasPointerAim(): boolean {
    return this.pointerAimActive;
  }

  consume(action: GameAction): boolean {
    const pressed = this.pressedActions.has(action);
    this.pressedActions.delete(action);
    return pressed;
  }

  isHeld(action: GameAction): boolean {
    return this.heldActions.has(action);
  }

  // Compatibility for the original prototype and external smoke tests.
  isDashHeld(): boolean {
    return this.isHeld('dodge');
  }

  setVirtualIntent(action: GameAction, pressed = true): void {
    if (pressed) this.pressAction(action);
    else this.heldActions.delete(action);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerdown', this.onWindowPointerDown);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('celestial-game-intent', this.onIntentEvent);
    this.stick.removeEventListener('pointerdown', this.onStickDown);
    this.stick.removeEventListener('pointermove', this.onStickMove);
    this.stick.removeEventListener('pointerup', this.onStickUp);
    this.stick.removeEventListener('pointercancel', this.onStickUp);
    this.dashButton.removeEventListener('pointerdown', this.onDashDown);
    this.dashButton.removeEventListener('pointerup', this.onDashUp);
    this.dashButton.removeEventListener('pointercancel', this.onDashUp);
    this.dashButton.removeEventListener('pointerleave', this.onDashUp);
    for (const binding of this.buttonBindings) {
      binding.element.removeEventListener('pointerdown', binding.down);
      binding.element.removeEventListener('pointerup', binding.up);
      binding.element.removeEventListener('pointercancel', binding.up);
      binding.element.removeEventListener('pointerleave', binding.up);
    }
    this.buttonBindings.length = 0;
  }

  private pressAction(action: GameAction): void {
    if (!this.heldActions.has(action)) this.pressedActions.add(action);
    this.heldActions.add(action);
  }

  private bindActionButtons(): void {
    const elements = document.querySelectorAll<HTMLElement>('[data-game-intent]');
    for (const element of elements) {
      if (element === this.dashButton) continue;
      const value = element.dataset.gameIntent;
      if (!value || !isGameAction(value)) continue;
      const down = (event: PointerEvent) => {
        event.preventDefault();
        this.pressAction(value);
      };
      const up = (event: PointerEvent) => {
        event.preventDefault();
        this.heldActions.delete(value);
      };
      element.addEventListener('pointerdown', down);
      element.addEventListener('pointerup', up);
      element.addEventListener('pointercancel', up);
      element.addEventListener('pointerleave', up);
      this.buttonBindings.push({ element, action: value, down, up });
    }
  }

  private updateMovementPointer(clientX: number, clientY: number): void {
    const dx = clientX - this.pointerState.centerX;
    const dy = clientY - this.pointerState.centerY;
    this.movementPointer.set(dx / this.pointerState.radius, dy / this.pointerState.radius);
    if (this.movementPointer.lengthSq() > 1) this.movementPointer.normalize();
    this.updateKnob();
  }

  private updateAim(clientX: number, clientY: number): void {
    this.pointerAim.set(clientX / Math.max(1, window.innerWidth) * 2 - 1, clientY / Math.max(1, window.innerHeight) * 2 - 1);
    this.pointerAimActive = true;
  }

  private updateKnob(): void {
    const distance = 38;
    this.knob.style.transform = `translate(calc(-50% + ${this.movementPointer.x * distance}px), calc(-50% + ${this.movementPointer.y * distance}px))`;
  }
}
