export type AudioGroup = 'ambience' | 'sfx' | 'ui';
export type CastSchool = 'lunar' | 'aurora';
export type UiAudioEvent = 'hover' | 'confirm' | 'cancel' | 'pause';

type ToneOptions = {
  frequency: number;
  endFrequency?: number;
  type?: OscillatorType;
  volume: number;
  attack?: number;
  sustain?: number;
  release: number;
  delay?: number;
  group?: Exclude<AudioGroup, 'ambience'>;
  detune?: number;
};

type NoiseOptions = {
  volume: number;
  duration: number;
  frequency: number;
  endFrequency?: number;
  filter?: BiquadFilterType;
  attack?: number;
  delay?: number;
};

type AudioIntentDetail = {
  intent?: string;
  action?: string;
  phase?: string;
  active?: boolean;
  pressed?: boolean;
};

type CelestialAudioDetail = {
  name?: string;
  intensity?: number;
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private uiGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlockPromise: Promise<void> | null = null;
  private readonly activeSources = new Set<AudioScheduledSourceNode>();
  private readonly ambienceSources: AudioScheduledSourceNode[] = [];
  private readonly ambienceNodes: AudioNode[] = [];
  private readonly cooldowns = new Map<string, number>();
  private readonly abortController = new AbortController();

  private masterVolume = 0.72;
  private muted = false;
  private unlocked = false;
  private gamePaused = false;
  private hiddenPaused = false;
  private disposed = false;

  constructor() {
    this.muted = this.readBoolean('last-firmament-muted') ?? false;
    this.bindUnlock();
    this.bindInterfaceAudio();
    this.syncMuteControls();
  }

  async unlock(): Promise<void> {
    if (this.disposed || this.unlocked) {
      if (this.context?.state === 'suspended' && !this.gamePaused && !this.hiddenPaused) {
        await this.context.resume().catch(() => undefined);
      }
      return;
    }
    if (this.unlockPromise) return this.unlockPromise;

    this.unlockPromise = this.initializeContext().finally(() => {
      this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = this.clamp(volume, 0, 1);
    this.applyMasterGain();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.writeBoolean('last-firmament-muted', muted);
    this.applyMasterGain();
    this.syncMuteControls();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setGroupVolume(group: AudioGroup, volume: number): void {
    const gain = this.groupGain(group);
    if (!gain || !this.context) return;
    gain.gain.cancelScheduledValues(this.context.currentTime);
    gain.gain.linearRampToValueAtTime(this.clamp(volume, 0, 1), this.context.currentTime + 0.08);
  }

  startAmbience(): void {
    const context = this.context;
    const destination = this.ambienceGain;
    if (!context || !destination || this.ambienceSources.length > 0 || context.state === 'closed') return;

    const now = context.currentTime;
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 210;
    droneFilter.Q.value = 0.8;
    droneFilter.connect(destination);
    this.ambienceNodes.push(droneFilter);

    const fundamentals = [41.2, 61.8];
    fundamentals.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 0 ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 0 ? -7 : 6;
      gain.gain.value = index === 0 ? 0.055 : 0.018;
      oscillator.connect(gain).connect(droneFilter);
      oscillator.start(now);
      this.ambienceSources.push(oscillator);
      this.ambienceNodes.push(gain);
    });

    const wind = context.createBufferSource();
    const windFilter = context.createBiquadFilter();
    const windGain = context.createGain();
    wind.buffer = this.getNoiseBuffer();
    wind.loop = true;
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 720;
    windFilter.Q.value = 0.42;
    windGain.gain.value = 0.016;
    wind.connect(windFilter).connect(windGain).connect(destination);
    wind.start(now);
    this.ambienceSources.push(wind);
    this.ambienceNodes.push(windFilter, windGain);

    const windLfo = context.createOscillator();
    const windLfoDepth = context.createGain();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.073;
    windLfoDepth.gain.value = 0.009;
    windLfo.connect(windLfoDepth).connect(windGain.gain);
    windLfo.start(now);
    this.ambienceSources.push(windLfo);
    this.ambienceNodes.push(windLfoDepth);

    const shimmer = context.createOscillator();
    const shimmerGain = context.createGain();
    const shimmerLfo = context.createOscillator();
    const shimmerDepth = context.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = 1248;
    shimmer.detune.value = -11;
    shimmerGain.gain.value = 0.0007;
    shimmerLfo.frequency.value = 0.11;
    shimmerDepth.gain.value = 0.00045;
    shimmer.connect(shimmerGain).connect(destination);
    shimmerLfo.connect(shimmerDepth).connect(shimmerGain.gain);
    shimmer.start(now);
    shimmerLfo.start(now);
    this.ambienceSources.push(shimmer, shimmerLfo);
    this.ambienceNodes.push(shimmerGain, shimmerDepth);
  }

  stopAmbience(): void {
    for (const source of this.ambienceSources.splice(0)) {
      try {
        source.stop();
      } catch {
        // A source may already have ended during browser teardown.
      }
      source.disconnect();
    }
    for (const node of this.ambienceNodes.splice(0)) node.disconnect();
  }

  /** Backward-compatible scaffold event. */
  pickup(index: number): void {
    this.playWhenReady(`pickup-${index}`, 55, () => {
      const step = Math.max(0, Math.min(index, 12));
      this.tone({ frequency: 285 + step * 18, endFrequency: 610 + step * 24, type: 'triangle', volume: 0.09, attack: 0.012, sustain: 0.035, release: 0.19 });
      this.tone({ frequency: 760 + step * 22, endFrequency: 1180 + step * 28, type: 'sine', volume: 0.035, attack: 0.025, sustain: 0.02, release: 0.28, delay: 0.055 });
    });
  }

  melee(): void {
    this.playWhenReady('melee', 90, () => {
      this.noise({ volume: 0.085, duration: 0.23, frequency: 1450, endFrequency: 310, filter: 'bandpass', attack: 0.008 });
      this.tone({ frequency: 142, endFrequency: 68, type: 'triangle', volume: 0.065, attack: 0.004, release: 0.16 });
    });
  }

  cast(school: CastSchool = 'lunar'): void {
    if (school === 'aurora') {
      this.playWhenReady('cast-aurora', 105, () => {
        [392, 587.3, 784].forEach((frequency, index) => {
          this.tone({ frequency, endFrequency: frequency * 1.12, type: 'sine', volume: 0.025 - index * 0.004, attack: 0.025, sustain: 0.055, release: 0.38, delay: index * 0.018, detune: index * 4 });
        });
        this.noise({ volume: 0.018, duration: 0.34, frequency: 2600, endFrequency: 4100, filter: 'highpass', attack: 0.08 });
      });
      return;
    }

    this.playWhenReady('cast-lunar', 105, () => {
      this.tone({ frequency: 214, endFrequency: 720, type: 'sine', volume: 0.06, attack: 0.018, sustain: 0.045, release: 0.31 });
      this.tone({ frequency: 428, endFrequency: 1050, type: 'triangle', volume: 0.023, attack: 0.035, sustain: 0.03, release: 0.24, delay: 0.025, detune: -7 });
      this.noise({ volume: 0.014, duration: 0.24, frequency: 1900, endFrequency: 3300, filter: 'bandpass', attack: 0.04 });
    });
  }

  hit(intensity = 1): void {
    const strength = this.clamp(intensity, 0.2, 1.5);
    this.playWhenReady('hit', 60, () => {
      this.noise({ volume: 0.12 * strength, duration: 0.16, frequency: 740, endFrequency: 170, filter: 'lowpass', attack: 0.002 });
      this.tone({ frequency: 96, endFrequency: 48, type: 'sine', volume: 0.11 * strength, attack: 0.002, release: 0.2 });
    });
  }

  dodge(): void {
    this.playWhenReady('dodge', 115, () => {
      this.noise({ volume: 0.055, duration: 0.27, frequency: 2100, endFrequency: 520, filter: 'bandpass', attack: 0.018 });
      this.tone({ frequency: 310, endFrequency: 118, type: 'sine', volume: 0.018, attack: 0.005, release: 0.2 });
    });
  }

  discovery(): void {
    this.playWhenReady('discovery', 700, () => {
      [293.66, 440, 587.33, 880].forEach((frequency, index) => {
        this.tone({ frequency, endFrequency: frequency * 1.015, type: 'sine', volume: 0.038 - index * 0.004, attack: 0.035, sustain: 0.15, release: 0.75, delay: index * 0.13, detune: index % 2 === 0 ? -4 : 4 });
      });
      this.noise({ volume: 0.014, duration: 1.05, frequency: 3600, endFrequency: 5600, filter: 'highpass', attack: 0.25, delay: 0.12 });
    });
  }

  death(): void {
    this.playWhenReady('death', 900, () => {
      this.tone({ frequency: 174, endFrequency: 42, type: 'sawtooth', volume: 0.055, attack: 0.025, sustain: 0.18, release: 1.25 });
      this.tone({ frequency: 116, endFrequency: 38, type: 'sine', volume: 0.09, attack: 0.02, sustain: 0.25, release: 1.4, delay: 0.08 });
      this.noise({ volume: 0.028, duration: 1.15, frequency: 690, endFrequency: 120, filter: 'lowpass', attack: 0.06 });
    });
  }

  boss(): void {
    this.playWhenReady('boss', 1200, () => {
      [0, 0.24, 0.48].forEach((delay, index) => {
        this.tone({ frequency: index === 2 ? 55 : 46.25, endFrequency: 38, type: 'sawtooth', volume: 0.075, attack: 0.006, sustain: 0.07, release: 0.38, delay });
        this.noise({ volume: 0.045, duration: 0.22, frequency: 260, endFrequency: 95, filter: 'lowpass', attack: 0.003, delay });
      });
      this.tone({ frequency: 277.18, endFrequency: 261.63, type: 'sine', volume: 0.026, attack: 0.18, sustain: 0.4, release: 0.8, delay: 0.16 });
    });
  }

  ui(event: UiAudioEvent = 'confirm'): void {
    this.playWhenReady(`ui-${event}`, event === 'hover' ? 45 : 80, () => {
      switch (event) {
        case 'hover':
          this.tone({ frequency: 540, endFrequency: 580, type: 'sine', volume: 0.012, attack: 0.004, release: 0.055, group: 'ui' });
          break;
        case 'cancel':
          this.tone({ frequency: 330, endFrequency: 210, type: 'triangle', volume: 0.026, attack: 0.004, release: 0.13, group: 'ui' });
          break;
        case 'pause':
          this.tone({ frequency: 392, endFrequency: 294, type: 'sine', volume: 0.024, attack: 0.006, release: 0.18, group: 'ui' });
          this.tone({ frequency: 523.25, endFrequency: 392, type: 'sine', volume: 0.014, attack: 0.01, release: 0.16, delay: 0.035, group: 'ui' });
          break;
        case 'confirm':
          this.tone({ frequency: 430, endFrequency: 650, type: 'sine', volume: 0.025, attack: 0.004, release: 0.12, group: 'ui' });
          this.tone({ frequency: 860, endFrequency: 920, type: 'sine', volume: 0.009, attack: 0.012, release: 0.11, delay: 0.025, group: 'ui' });
          break;
      }
    });
  }

  pause(paused = true): void {
    this.gamePaused = paused;
    void this.syncContextState();
  }

  async resume(): Promise<void> {
    this.gamePaused = false;
    await this.unlock();
    await this.syncContextState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.stopAmbience();
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Source already ended.
      }
      source.disconnect();
    }
    this.activeSources.clear();
    this.masterGain?.disconnect();
    this.ambienceGain?.disconnect();
    this.sfxGain?.disconnect();
    this.uiGain?.disconnect();
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
    this.ambienceGain = null;
    this.sfxGain = null;
    this.uiGain = null;
    this.noiseBuffer = null;
    this.unlocked = false;
  }

  private async initializeContext(): Promise<void> {
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass({ latencyHint: 'interactive' });
    this.context = context;
    this.masterGain = context.createGain();
    this.ambienceGain = context.createGain();
    this.sfxGain = context.createGain();
    this.uiGain = context.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    this.ambienceGain.gain.value = 0.24;
    this.sfxGain.gain.value = 0.78;
    this.uiGain.gain.value = 0.5;
    this.ambienceGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.uiGain.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    await context.resume().catch(() => undefined);
    if (context.state === 'closed') return;
    this.unlocked = true;
    this.startAmbience();
    await this.syncContextState();
  }

  private bindUnlock(): void {
    const signal = this.abortController.signal;
    const unlock = () => void this.unlock();
    window.addEventListener('pointerdown', unlock, { signal, passive: true });
    window.addEventListener('keydown', unlock, { signal });
  }

  private bindInterfaceAudio(): void {
    const signal = this.abortController.signal;

    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-sound]') : null;
        if (!target) return;
        const sound = target.dataset.uiSound;
        this.ui(sound === 'cancel' || sound === 'pause' ? sound : 'confirm');
      },
      { signal },
    );

    document.addEventListener(
      'pointerover',
      (event) => {
        if (event.pointerType === 'touch') return;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ui-sound]') : null;
        if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
        this.ui('hover');
      },
      { signal, passive: true },
    );

    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element) || !event.target.closest('[data-audio-toggle]')) return;
        this.toggleMute();
      },
      { signal },
    );

    const muteSetting = document.querySelector<HTMLInputElement>('#mute-setting');
    muteSetting?.addEventListener('change', () => this.setMuted(muteSetting.checked), { signal });

    window.addEventListener(
      'celestial-game-intent',
      (event) => this.handleGameIntent(event as CustomEvent<AudioIntentDetail | string>),
      { signal },
    );

    window.addEventListener(
      'celestial-audio',
      (event) => this.handleCelestialAudio(event as CustomEvent<CelestialAudioDetail>),
      { signal },
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        this.hiddenPaused = document.hidden;
        void this.syncContextState();
      },
      { signal },
    );
  }

  private handleGameIntent(event: CustomEvent<AudioIntentDetail | string>): void {
    const detail = event.detail;
    const intent = typeof detail === 'string' ? detail : detail?.intent ?? detail?.action;
    if (!intent) return;
    if (typeof detail !== 'string') {
      if (detail.active === false || detail.pressed === false || detail.phase === 'end' || detail.phase === 'release') return;
    }

    switch (intent) {
      case 'melee':
        this.melee();
        break;
      case 'lunar':
        this.cast('lunar');
        break;
      case 'aurora':
        this.cast('aurora');
        break;
      case 'dodge':
        this.dodge();
        break;
      case 'interact':
      case 'lock':
      case 'restart':
        this.ui('confirm');
        break;
      case 'pause':
        this.ui('pause');
        break;
    }
  }

  private handleCelestialAudio(event: CustomEvent<CelestialAudioDetail>): void {
    const { name, intensity = 1 } = event.detail ?? {};
    switch (name) {
      case 'melee':
        this.melee();
        break;
      case 'lunar-cast':
        this.cast('lunar');
        break;
      case 'aurora-cast':
        this.cast('aurora');
        break;
      case 'dodge':
        this.dodge();
        break;
      case 'enemy-hit':
      case 'player-hit':
        this.hit(intensity);
        break;
      case 'death':
        this.death();
        break;
      case 'boss-awaken':
        this.boss();
        break;
      case 'checkpoint':
      case 'victory':
        this.discovery();
        break;
      case 'lock':
        this.ui('confirm');
        break;
      case 'pause':
        this.ui('pause');
        break;
    }
  }

  private playWhenReady(id: string, cooldownMs: number, build: () => void): void {
    const play = () => {
      const context = this.context;
      if (!context || context.state !== 'running' || this.muted || this.disposed) return;
      const now = performance.now();
      if ((this.cooldowns.get(id) ?? -Infinity) + cooldownMs > now) return;
      this.cooldowns.set(id, now);
      build();
    };

    if (!this.context || this.context.state !== 'running') {
      void this.unlock().then(play);
      return;
    }
    play();
  }

  private tone(options: ToneOptions): void {
    const context = this.context;
    const destination = this.groupGain(options.group ?? 'sfx');
    if (!context || !destination || context.state !== 'running') return;

    const start = context.currentTime + (options.delay ?? 0);
    const attack = Math.max(0.002, options.attack ?? 0.008);
    const sustain = Math.max(0, options.sustain ?? 0);
    const end = start + attack + sustain + Math.max(0.025, options.release);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.type ?? 'sine';
    oscillator.frequency.setValueAtTime(Math.max(20, options.frequency), start);
    oscillator.detune.value = options.detune ?? 0;
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.endFrequency), end);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.volume), start + attack);
    gain.gain.setValueAtTime(Math.max(0.0002, options.volume), start + attack + sustain);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
    this.trackSource(oscillator, gain);
  }

  private noise(options: NoiseOptions): void {
    const context = this.context;
    const destination = this.sfxGain;
    if (!context || !destination || context.state !== 'running') return;

    const start = context.currentTime + (options.delay ?? 0);
    const attack = Math.max(0.002, options.attack ?? 0.006);
    const end = start + Math.max(0.035, options.duration);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.getNoiseBuffer();
    filter.type = options.filter ?? 'bandpass';
    filter.Q.value = options.filter === 'lowpass' || options.filter === 'highpass' ? 0.5 : 0.9;
    filter.frequency.setValueAtTime(Math.max(30, options.frequency), start);
    if (options.endFrequency) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.endFrequency), end);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start);
    source.stop(end + 0.02);
    this.trackSource(source, filter, gain);
  }

  private trackSource(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    this.activeSources.add(source);
    source.addEventListener(
      'ended',
      () => {
        this.activeSources.delete(source);
        source.disconnect();
        for (const node of nodes) node.disconnect();
      },
      { once: true },
    );
  }

  private getNoiseBuffer(): AudioBuffer {
    const context = this.context;
    if (!context) throw new Error('Audio context is not initialized.');
    if (this.noiseBuffer) return this.noiseBuffer;
    const frameCount = context.sampleRate * 2;
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.02 * white) / 1.02;
      data[index] = this.clamp(white * 0.72 + brown * 1.7, -1, 1);
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private groupGain(group: AudioGroup): GainNode | null {
    if (group === 'ambience') return this.ambienceGain;
    if (group === 'ui') return this.uiGain;
    return this.sfxGain;
  }

  private applyMasterGain(): void {
    const context = this.context;
    const gain = this.masterGain;
    if (!context || !gain || context.state === 'closed') return;
    const target = this.muted ? 0 : this.masterVolume;
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(target, context.currentTime + 0.045);
  }

  private async syncContextState(): Promise<void> {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    if (this.gamePaused || this.hiddenPaused) {
      if (context.state === 'running') await context.suspend().catch(() => undefined);
    } else if (this.unlocked && context.state === 'suspended') {
      await context.resume().catch(() => undefined);
    }
  }

  private syncMuteControls(): void {
    for (const button of document.querySelectorAll<HTMLElement>('[data-audio-toggle]')) {
      button.setAttribute('aria-pressed', String(this.muted));
      button.setAttribute('aria-label', this.muted ? 'Unmute sound' : 'Mute sound');
      const icon = button.querySelector<HTMLElement>('[data-audio-icon]');
      if (icon) icon.textContent = this.muted ? '×' : '◖';
    }
    const setting = document.querySelector<HTMLInputElement>('#mute-setting');
    if (setting) setting.checked = this.muted;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  private readBoolean(key: string): boolean | null {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? null : value === 'true';
    } catch {
      return null;
    }
  }

  private writeBoolean(key: string, value: boolean): void {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Muting remains active for this session when storage is unavailable.
    }
  }
}
