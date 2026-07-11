# The Last Firmament

## Vertical-slice brief

**Fantasy:** Become the last initiate of a dying astrology school and fight through a black-slate tundra to relight a sky that has forgotten its stars.

**Playable loop:** Leave the spiral spire, read enemy telegraphs, combine staff attacks with lunar and aurora sorcery, recover celestial relics, deepen spell comprehension, rest at the observatory, and defeat the intelligence that keeps the firmament dark.

The first shipped slice is deliberately compact rather than pretending to be the full RPG. It should support a satisfying 10–15 minute run, a complete death/retry path, a visible restoration arc, and enough systemic hooks to grow into the larger concept.

## Product decisions

- The working title is **The Last Firmament**.
- The visual era is approximately AD 800–1100, but the setting is an original mythic world rather than historical Europe.
- “Celestial body” is the umbrella term for planets, moons, stars, comets, systems, and constellations.
- The ambiguous handwritten tower height is interpreted as roughly **275 feet** for this slice. The exact number has no mechanical effect.
- Character age is presentation-only in the slice; the hooded silhouette intentionally leaves the initiate's age ambiguous.
- Spell comprehension is ordered as Novice, Apprentice, Mage, Seer, Warlock, Ancient, and Celestial. “Primal” is treated as an alternate name for the final tier until the broader narrative distinguishes it.
- Affinity is surfaced through player conduct and combat choices. The slice may compress the full future reputation simulation into a small set of readable axes while preserving the intended buff/nerf relationship.
- Custom deterministic collision is preferred over rigid-body simulation. Combat timing and authored dodge windows matter more here than physical realism.

## Slice content target

- One connected exterior region around the spiral astrology spire.
- A readable checkpoint/rest point and a fast death/retry loop.
- Staff melee, a lunar projectile, an aurora spell, focus and stamina economies, dodge invulnerability, hit reactions, and telegraphed attacks.
- At least three enemy reads plus one multi-phase boss encounter.
- Multiple celestial restorations that visibly alter the sky and unlock or strengthen magic.
- Spell comprehension, affinity, charm, and equipment state represented in the live game rather than only in prose.
- A compact soulslike HUD, onboarding, pause/settings, death, discovery, and victory states.
- Keyboard/mouse and responsive touch controls.
- Saved settings and lightweight run/progression persistence where safe.
- Event-driven VFX and an interaction-focused audio mix.

## Art direction

- Pitch-black sky with the moon and green/red aurora as the opening light sources.
- Gray slate, black stone, tarnished metal, bone, wool, and pale gold as the principal material language.
- The tower, observatories, armillary spheres, relics, UI glyphs, and spell trails repeat circles, orbital arcs, eclipses, and broken halos.
- Darkness creates depth but never hides a combat telegraph, objective, or traversal edge.
- The player, enemy families, rewards, and hazards must differ by silhouette as well as color.

## Expansion seams

The architecture should be able to accept imported GLB characters, additional regions, data-authored spell schools, narrative NPC affinity events, equipment inventories, save-slot migration, and larger celestial graphs without requiring a rewrite of the render loop or core state model.
