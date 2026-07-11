# The Last Firmament

A playable 3D celestial-magic soulslike vertical slice built with TypeScript, Vite, and Three.js.

You are the last initiate of a failing astrology school. Cross the black-slate tundra, defeat the wardens surrounding three celestial relics, restore the absent sky, and face the Eclipse Archon. The slice includes a complete combat, death/checkpoint, boss, victory, and restart loop rather than a static concept scene.

## Run

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5197/>.

Production build and preview:

```powershell
npm run build
npm run preview
```

The preview runs at <http://127.0.0.1:4197/>.

## Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Left stick |
| Dodge | Space or Shift | Dodge button |
| Melee | Left mouse or J | Melee button |
| Lunar Dart | Right mouse or Q | Lunar button |
| Aurora Veil | Middle mouse or E | Aurora button |
| Lock target | Tab | Automatic nearest-target assist |
| Interact | F | Use button |
| Pause | Escape or P | Pause button |
| Retry / new pilgrimage | R or Enter when prompted | Menu action |

## Systems in the slice

- Fixed-step movement and custom circle/swept-projectile collision.
- Stamina, focus, dodge invulnerability, melee, lunar projectile, and aurora area magic.
- Three enemy families and a telegraphed three-phase boss.
- Three guarded celestial relics, checkpoints, sky restoration, death/retry, and victory.
- Spell-use comprehension, challenge-gated tiers, affinities, charms, and named equipment.
- Authored procedural sorcerer/boss models, layered tundra/spire world, shared materials, procedural textures, and pooled VFX.
- Responsive soulslike HUD, discovery/pause/settings/death/victory states, reduced motion, mobile controls, and safe-area layout.
- Procedural Web Audio ambience and interaction cues with persisted mute state.
- Read-only runtime diagnostics plus development-only deterministic test hooks.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Canvas and renderer inspection while the dev server is running:

```powershell
npm run inspect:canvas
npm run inspect:canvas:mobile
node scripts/inspect-threejs-canvas.mjs --state boss
node scripts/inspect-threejs-canvas.mjs --state victory --mobile
```

## Project layout

- `src/game`: orchestration, progression, state transitions, diagnostics.
- `src/entities`: player, enemy, relic, and projectile rules.
- `src/core`: renderer, loop, and unified desktop/touch input.
- `src/assets`: shared materials, procedural textures, authored model factories.
- `src/world`: layered environment and celestial restoration.
- `src/systems`: collision, camera, HUD, audio, VFX, and debug tooling.
- `tests`: desktop/mobile visual smoke and full state-loop Playwright tests.
- `docs/PRODUCTION_BRIEF.md`: concept decisions and expansion seams.

The external Tripo, Gemini, and ElevenLabs credentials were not available in the build environment, so the shipping slice uses authored procedural models, textures, and Web Audio. The architecture retains clean asset-layer seams for later GLB, texture, and audio-file replacement.
