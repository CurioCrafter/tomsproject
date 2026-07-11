# The Last Firmament

## Campaign vertical-slice brief

**Fantasy:** Become the last initiate of a dying astrology school and fight through a black-slate tundra to relight a sky that has forgotten its stars.

**Playable loop:** Shape a pilgrim, leave the spiral spire, read enemy telegraphs, combine catalyst attacks with lunar and aurora sorcery, cross sealed bridges and causeways, recover celestial relics, deepen spell comprehension, defeat the Orrery Castellan, and confront the intelligence that keeps the firmament dark at Moonfall Observatory.

The shipped slice is a linear campaign rather than an arena or open world. It supports a complete death/retry path, three restoration checkpoints, five ordered encounters, a midpoint and final boss, and systemic hooks for a larger RPG.

## Product decisions

- The working title is **The Last Firmament**.
- The visual era is approximately AD 800–1100, but the setting is an original mythic world rather than historical Europe.
- “Celestial body” is the umbrella term for planets, moons, stars, comets, systems, and constellations.
- The ambiguous handwritten tower height is interpreted as roughly **275 feet** for this slice. The exact number has no mechanical effect.
- Character life stage, frame, veil, robe dye, astral metal, and catalyst are persistent presentation choices with a live 3D preview.
- Spell comprehension is ordered as Novice, Apprentice, Mage, Seer, Warlock, Ancient, and Celestial. “Primal” is treated as an alternate name for the final tier until the broader narrative distinguishes it.
- Affinity is surfaced through player conduct and combat choices. The slice may compress the full future reputation simulation into a small set of readable axes while preserving the intended buff/nerf relationship.
- Custom deterministic collision is preferred over rigid-body simulation. Combat timing and authored dodge windows matter more here than physical realism.

## Shipped campaign shape

- Eleven connected linear sections from the spiral astrology spire to Moonfall Observatory.
- Four authored bridge/causeway stretches with dynamic rear and exit seals.
- A readable checkpoint/rest point and a fast death/retry loop.
- Staff melee, a lunar projectile, an aurora spell, focus and stamina economies, dodge invulnerability, hit reactions, and telegraphed attacks.
- Eight enemy reads, one multi-phase midpoint boss, and one multi-phase final boss encounter.
- Multiple celestial restorations that visibly alter the sky and unlock or strengthen magic.
- Spell comprehension, affinity, charm, and equipment state represented in the live game rather than only in prose.
- A compact soulslike HUD, onboarding, pause/settings, death, discovery, and victory states.
- Keyboard/mouse and responsive touch controls.
- Saved settings and a sanitized, versioned character profile; boss completion is committed at a death-safe progression boundary.
- Event-driven VFX and an interaction-focused audio mix.
- Image-generated celestial blackstone and starweave fabric textures used by the environment and character materials.

## Art direction

- Pitch-black sky with the moon and green/red aurora as the opening light sources.
- Gray slate, black stone, tarnished metal, bone, wool, and pale gold as the principal material language.
- The tower, observatories, armillary spheres, relics, UI glyphs, and spell trails repeat circles, orbital arcs, eclipses, and broken halos.
- Darkness creates depth but never hides a combat telegraph, objective, or traversal edge.
- The player, enemy families, rewards, and hazards must differ by silhouette as well as color.

## Expansion seams

The architecture should be able to accept imported GLB characters, additional regions, data-authored spell schools, narrative NPC affinity events, equipment inventories, save-slot migration, and larger celestial graphs without requiring a rewrite of the render loop or core state model.
