# The Last Firmament

A playable celestial-magic Souls-inspired campaign built with TypeScript, Vite, and Three.js.

You are the last initiate of a failing astrology school. Shape a pilgrim, leave the spiral blackstone spire, cross a deliberately linear pilgrimage of courts, broken bridges, refuges, and sealed causeways, restore three absent celestial bodies, defeat the Orrery Castellan, and confront the Eclipse Archon at Moonfall Observatory.

This is a complete browser-game vertical slice rather than a static scene. It includes combat, checkpoints, death and recovery, two multi-phase bosses, victory, restart, responsive touch controls, and persistent character appearance.

## Run locally

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

The production preview runs at <http://127.0.0.1:4197/>.

## Controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Left astral stick |
| Dodge | Space or Shift | Dodge seal |
| Melee | Left mouse or J | Melee seal |
| Lunar Dart | Right mouse or Q | Lunar seal |
| Aurora Veil | Middle mouse or E | Aurora seal |
| Lock target | Tab | Automatic nearest-target assist |
| Interact | F | Use seal |
| Pause | Escape or P | Pause button |
| Retry / new pilgrimage | R or Enter when prompted | Menu action |

## Campaign content

- A proper keyboard- and touch-friendly main menu with controls and settings.
- A persistent creator with name, life stage, frame, veil, robe dye, astral metal, and catalyst choices.
- A live animated 3D portrait that uses the same authored sorcerer model and materials as gameplay.
- Eleven connected route sections, including four bridges/causeways, three celestial checkpoints, two courts, a refuge, the spiral-school threshold, and Moonfall Observatory.
- Five ordered encounters whose physical portcullises cannot be bypassed through the walkable route.
- Eight enemy archetypes: Veil Wraith, Astral Sentinel, Rime Seer, Ashen Initiate, Astral Lancer, Eclipse Chorister, Orrery Castellan, and Eclipse Archon.
- A midpoint boss whose defeat remains committed across death, plus a final three-phase victory encounter.
- Enemy leash regions, swept projectile and gate collision, fixed-step movement, stamina, focus, dodge invulnerability, melee, lunar projectiles, and aurora area magic.
- Spell comprehension, affinity, charms, named equipment, restoration-driven sky changes, and checkpoint recovery.
- Generated celestial-blackstone and midnight-starweave texture assets, layered procedural sky/aurora effects, authored low-poly models, pooled VFX, and procedural Web Audio.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

The Playwright suite covers desktop Chrome and mobile Safari layouts. It verifies the menu/creator persistence and focus contracts, touch targets, gameplay/death/victory loop, every campaign transition, and a gate-partition probe that rejects deliberately bypassable route geometry.

Canvas inspection while the dev server is running:

```powershell
npm run inspect:canvas
npm run inspect:canvas:mobile
node scripts/inspect-threejs-canvas.mjs --state bridge
node scripts/inspect-threejs-canvas.mjs --state midboss
node scripts/inspect-threejs-canvas.mjs --state finalboss
node scripts/inspect-threejs-canvas.mjs --state victory --mobile
```

Longer runtime soak against a production preview:

```powershell
npm run build
npm run preview
npm run playtest:soak
```

## Project layout

- `src/game`: orchestration, character profile and appearance mapping, progression, diagnostics, and data-authored route definitions.
- `src/ui`: the front-end controller and live 3D character portrait.
- `src/entities`: player, enemy, relic, and projectile rules.
- `src/core`: renderer, loop, and unified desktop/touch input.
- `src/assets`: shared materials, procedural textures, and authored model factories.
- `src/world`: the linear environment, gates, astrology school, sky, and open observatory.
- `src/systems`: encounters, collision, camera, HUD, audio, VFX, and debug tooling.
- `public/assets/textures`: image-generated environment and character texture sources used directly at runtime.
- `tests`: desktop/mobile visual, creator, route-definition, and full campaign Playwright tests.
- `docs/PRODUCTION_BRIEF.md`: concept decisions and expansion seams.

External Tripo and ElevenLabs credentials were not available in the build environment, so this release uses authored procedural geometry and Web Audio. The requested environment and character texture work was completed with the available image-generation pipeline and is checked into `public/assets/textures`.
