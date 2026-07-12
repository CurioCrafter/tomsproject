/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  score: number;
  targetScore: number;
  complete: boolean;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __CELESTIAL_GAME_TEST__?: {
    start(): void;
    damagePlayer(amount?: number): void;
    restoreNextBody(): void;
    spawnBoss(): void;
    defeatBoss(): void;
    restart(): void;
    activateNextEncounter(): void;
    defeatActiveEncounter(): void;
    claimAvailableCheckpoint(): void;
    showEncounter(encounterId: string): void;
    showSection(sectionId: string): void;
    chooseBranch(choiceId: string, optionId: string): void;
    activateBranchEncounter(encounterId: string): void;
    defeatActiveBranchEncounter(): void;
    claimReward(choiceIndex?: number): void;
    allocateSpec(branch: 'moon' | 'aurora' | 'eclipse'): void;
    victoryTrade(): void;
  };
}
