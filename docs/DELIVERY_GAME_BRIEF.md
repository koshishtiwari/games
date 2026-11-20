# "Delivery": fly Nepal, drop packages, learn the 77 districts

New game at `games/delivery/index.html` (the folder exists and is empty). Do NOT modify `games/air-raid/`; copy from it.

## 1. The game in one paragraph

You fly a jet over a beautiful, realistic 3D Nepal. **Nothing on the land is labeled and no borders are drawn.** The game gives you a mission: "Deliver a package to DOLAKHA." You fly to where you think Dolakha is and press DROP. You keep flying. A few seconds later the package lands and the game reveals where it fell: the district lights up, and you learn whether you were right, and if not, which district you hit and how far off you were. Then the next mission starts, with no loading and no landing required. It is a relaxing geography game. The only way to get good is to learn Nepal's shape: the Terai, the Chure and Mahabharat hills, the rivers, the valleys, the great peaks.

Inspiration: Sebastian Lague's globe-flying delivery game. Same calm, same beauty, same "where do I think this country is" tension. Ours is Nepal at district level.

## 2. Core loop and structure

- **Start on the ground.** The run starts at a real Nepali airport, on the runway, and the HUD names the airport and its district ("Pokhara Airport, Kaski"). That is the player's one anchor in an unlabeled world. Use a pool of real airports (Tribhuvan/Kathmandu, Pokhara, Lukla, Biratnagar, Bhairahawa, Nepalgunj, Dhangadhi, Janakpur, Simara, Surkhet, Jomsom, Tumlingtar and so on, verify coordinates and districts from data) and pick one per run. A short takeoff roll is the tutorial: throttle up, rotate, climb.
- **Missions.** One at a time: a target district name and a package. Show the Nepali name too only if you have a verified source for it (see section 3). Missions chain continuously.
- **DROP.** One big button (also Space). The package leaves the jet at the jet's position and velocity, and falls on a parachute for ~4 to 6 seconds, drifting forward with your momentum. The player must lead the drop. The camera stays on the jet. A small parachute stays visible behind you.
- **Reveal.** When it lands: the landing district fills with color on the terrain and the camera swings to a brief overview of the landing point and the target district. Show clearly: HIT or MISS, the district you landed in, distance from the target district boundary in km, and a small arrow or line to where the target actually is. Keep it a few seconds; the player can tap to skip. Then the next mission begins while they are still flying.
- **Hints** (cost points, optional, one tap): 1) the province, 2) the largest nearby city or the district headquarters, 3) names of neighboring districts. Nothing more. Hints are the on-ramp for beginners.
- **Scoring.** Hit = full points, scaled down by hint count. Miss = partial points by distance to the target district (so "one district over" is still rewarded, "wrong side of the country" is not). A streak multiplier for consecutive hits.
- **Learning and repetition (this is what makes it replayable):** keep per-district stats in localStorage (times asked, times hit, best miss distance). Choose missions with weighting: districts the player has missed come back more often, mastered ones less, plus a few never-seen ones. Start the game with large, distinctive districts (Dolpa, Mustang, Morang, Chitwan...) and grow toward the small ones (Bhaktapur, Kathmandu, Lalitpur). A "districts mastered N/77" counter on the pre-flight and results screens is the long-term goal. A run is 8 to 10 missions.
- **Results screen as an atlas:** an unlabeled-then-revealed map of Nepal showing every drop of the run as a dot, green for hit, amber for near, red for far, with the target district outlined. This is the "aha" moment that teaches the geography. Make it beautiful.
- **No fail state.** No fuel, no enemies, no timer pressure. Mountains: do not kill the player. Use a soft terrain-avoidance (gentle pull-up/push, a brief warning tone) so crossing the Himalaya is spectacular rather than frustrating.

## 3. The world: real Nepal, believable and detailed

### Scale and framing
- Nepal is roughly 880 km east to west and 150 to 240 km north to south. Use real geographic proportions (project lon/lat with a local equirectangular or UTM-like projection centered on Nepal). Do not distort the country's shape.
- Horizontal scale is compressed for gameplay: choose it so crossing the country edge to edge at cruise takes roughly 3 minutes and at boost roughly 90 seconds. Report your chosen scale. Small districts (Bhaktapur ~119 km2) will be small targets; that is part of the challenge, but the package lead/drop timing must make them achievable with practice.
- Vertical exaggeration of about 2x to 3x so the Himalaya reads as mountains from jet altitude. Make it a single constant you can tune.
- Include a generous border of surrounding land (Indian plains to the south, Tibetan plateau to the north) fading to haze, so the player can tell when they have left Nepal, and the country has context. Outside Nepal, packages that land count as "outside Nepal" misses.
- The existing air-raid "planet curves away as you climb, sky fades to space with stars" look is worth keeping if it works at this scale. Do it only if it does not fight the terrain; a pure flat-earth projection with a horizon haze is acceptable if curvature looks wrong.

### Terrain data (must be real)
- **Elevation:** AWS Terrain Tiles (Terrarium PNG, public, no key), e.g. `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Verified reachable. Elevation = (R*256 + G + B/256) - 32768 meters. Zoom 8 to 9 over Nepal gives roughly 150 to 300 m per pixel; use higher zoom only for the Kathmandu valley or if budget allows. Bake it offline in a script into a heightmap image (16-bit if possible, or two 8-bit channels) shipped next to `index.html`.
- **Districts: use the official OCHA / Survey Department COD-AB dataset on HDX (already verified, 77 districts).**
  - Download: `https://data.humdata.org/dataset/07db728a-4f0f-4e98-8eb0-8fa9df61f01c/resource/dea34e50-37d5-4e36-98ae-2b7b1b4c43de/download/npl_admin_boundaries.geojson.zip` (60 MB zip, send a browser `User-Agent`). Dataset page: `https://data.humdata.org/dataset/cod-ab-npl`.
  - Use `npl_admin2.geojson` (or `npl_admin2_em.geojson`, the edge-matched variant whose borders share exact edges with neighbors, which is better for rasterizing with no gaps). Both have exactly 77 Polygon features, version v02, valid 2024-03-14.
  - Properties you want: `adm2_name` (English), `adm2_pcode` (e.g. NP0101, stable ID), `adm1_name` (province: Koshi, Madhesh, Bagmati, Gandaki, Lumbini, Karnali, Sudur Paschim), `area_sqkm`, `center_lat`, `center_lon`. `npl_adminlines.geojson` has the border lines if useful. Note: the Nepali-name fields (`adm2_name1` etc.) are null in this release, so there is no Devanagari name in the data. Do not invent them. Either show English only, or get verified Devanagari names from OSM `name:ne` tags / Wikidata and say where they came from.
  - Already sanity-checked: smallest is Bhaktapur (123 km2), then Lalitpur (397) and Kathmandu (414); largest is Dolpa (7,945), Humla (6,007), Gorkha (3,646). Nawalparasi is split as "Nawalparasi East" and "Nawalparasi West" (same units as Nawalpur and Parasi), and Rukum as "Rukum East" and "Rukum West". Show friendly alternates (Nawalpur, Parasi) in the UI as an alias.
  - License: CC BY 3.0 IGO. Put a credit line ("Boundaries: Survey Department of Nepal / UN OCHA, CC BY 3.0 IGO") on the results screen or an about line.
  - Not usable: GADM (old 14 zones) and the geoBoundaries 2006 release (75 districts). The newer geoBoundaries 2020 releases (`gbHumanitarian`, `gbAuthoritative` ADM2) derive from this same source and are a fallback.
  - Assert in the bake script that there are exactly 77 districts and that every pixel inside Nepal maps to one.
- Bake the districts into an **ID raster** the same size as the heightmap (one district index per pixel, 0 = outside Nepal), plus a small JSON table of index, name, Nepali name, province, HQ, centroid, bounding box and area. The drop test is then an O(1) pixel lookup. The distance-to-target-boundary calculation can use the raster (nearest pixel of that district) or a distance field. No runtime polygon work.
- The tooling to bake data can be Node or Python in a scripts folder (python3 here has no numpy or PIL: use a venv or Node). Keep scripts in `scripts/delivery-data/` and commit them so the data can be rebuilt. Commit the baked outputs too.

### Looking real (this is where it earns "beautiful")
No satellite imagery (licensing and size). Color the terrain procedurally from elevation, slope, latitude and distance to rivers, with detail noise:
- The Terai: flat, lush green and golden farmland, dense and bright, slightly hazy.
- The Chure / Siwalik and Mahabharat hills: terraced, forested, green going to brown, ridgelines clearly lit.
- The mid-hills valleys: Kathmandu valley, Pokhara valley should be recognizable shapes, with a lake at Pokhara (Phewa) and visible urban sprawl texture in Kathmandu.
- High Himalaya: rock, glaciers, permanent snow above ~5000 m, long sharp lit ridges. Everest, Kanchenjunga, Annapurna, Dhaulagiri, Manaslu, Langtang must read as the big peaks.
- Trans-Himalaya (Mustang, Dolpo): dry, tan and ochre, Tibetan-plateau feel.
- Rivers: the big ones carve visible valleys and render as water ribbons (Koshi system, Gandaki, Karnali, Mahakali, Bagmati). Pull river lines from Natural Earth or OSM waterways, rasterized into a mask; widen them by stream order.
- Atmosphere: soft sun, long shadows, aerial perspective haze (blue in the distance), scattered clouds with their shadows on the ground, the sky-to-space fade from air-raid at high altitude. Morning/golden hour lighting as default.
- Landmarks are the learning tool, so do not randomize the world: every run looks the same, always. No procedural trees scattered at random positions that would hide real shapes; vegetation is a shading effect, plus optionally instanced trees in forest belts seeded from the same land-cover logic.
- Do not draw district borders, names or markers in the world at any time, except in the reveal (a district fills with color for a few seconds).

### Rendering and performance (non-negotiable)
- Target a Samsung Galaxy A16 in a React Native WebView at steady 30 fps minimum. Test with the user on that device. Do not start any Gradle, EAS or app build.
- A single huge mesh is not acceptable. Use a chunked, LOD terrain around the jet (geoclipmap or quadtree tiles with a height texture sampled in the vertex shader or built from the heightmap on the CPU per chunk). Budget on the order of 300k to 600k visible triangles.
- Color the terrain in a fragment shader from the baked textures (height, slope, a small color-variation noise), not by per-frame CPU vertex painting.
- Cap pixel ratio at about 1.5 on mobile. Keep shadows cheap (small shadow map around the jet only) or skip them and rely on baked slope shading.
- Show a real progress bar while the heightmap and textures load, with actual stages.

## 4. The jet and flight feel (copy from air-raid, strip the combat)

The user loves the air-raid flight characteristics. Reuse them nearly verbatim, from `games/air-raid/index.html` (inlined three.js is lines 315 to ~4123, do not read it; the game script is from line 4124):
- Jet mesh and materials (starts near `// ── Fighter Jet`, ~line 4562), afterburner, wingtip vapor trails, bank and pitch response.
- Flight model in `update(dt)` (~line 6187): heading-based steering, drag-to-steer with deadzone 8 px and range 90 px, `steerEase` smoothing, boost on hold, vertical speed with `ACCEL`, `DRAG`, `MAXUD`, FOV widening on boost and altitude. Keep the feel. Retune only the numbers that must change because of the new scale (speed will need to be much higher in world units), and keep the same ratios: turn rate, bank, response.
- Remove entirely: weapons, towers, drones, SAMs, flares, lock UI, fuel, crash-on-ground, the old HUD and overlay content.
- Add: **takeoff and landing** support at least for takeoff. On the runway the jet accelerates under throttle (hold = throttle) and lifts off at speed. Landing is optional: skip unless it comes cheap; the game never requires it.
- Controls: touch drag to steer, hold to boost, DROP button. Desktop: mouse drag or WASD/arrows, Shift boost, Space drop. Both orientations must work (the host allows rotation for this kind of game).
- Camera: the same chase camera as air-raid, with a slow pull-back and wider FOV at altitude.

## 5. Screens (Swiss minimal; the user's taste)

Plain text labels instead of filled pills, thin left-accent bars, large type, whitespace, single-tap flows. **No em dashes in any on-screen copy.** Do not use the word "beef". Safe-area insets respected.

1. **Boot/loading:** visible immediately, before anything heavy parses. Title, a thin real progress line, one calm line of copy. No white flash.
2. **Pre-flight:** airport name and district, "Districts learned 12/77", a single big TAKE OFF. Nothing else.
3. **In flight HUD:** current mission ("Deliver to: Dolakha") top left with a left-accent bar, a small altimeter and speed readout, hint button (shows remaining hints), and the DROP button. Nothing in the world is labeled. Keep the screen clear; this is a scenery game.
4. **Drop in progress:** a subtle "Package away" line and a falling-timer ring around the parachute.
5. **Reveal:** as described in section 2. Lovely, brief, skippable.
6. **Results:** the atlas map of the run, score, streak, districts newly learned, coins earned, FLY AGAIN.

## 6. Contract with the host app (do not break)

The game runs in `components/GameWebViewModal.tsx` in a WebView. Existing messages, keep the shape:
- Periodic `window.ReactNativeWebView.postMessage(JSON.stringify({type:'stats', score, coins, timer, fuel, targets, kills, health}))`. Send all keys; use `targets` for hits and constants for `fuel` and `health`.
- At the end of a run: `{type:'gameOver', score, coins, combo, duration_ms}` plus extra keys if you like (e.g. `hits`, `missions`, `districts_mastered`).
- `coins` becomes Mana for the player. Check `lib/games-service.ts` for `coins_reward_max` and keep payouts inside it. Do not inflate.
- Guard every call: `try/catch` and `if(window.ReactNativeWebView)`, since the page also runs in a plain browser.

Host-side follow-ups (NOT the game agent's job, the user decides): add `delivery` to `GameId`/labels in `lib/games-service.ts`, add `entry.id === "delivery"` to the `allowRotate` check in `app/mana/index.tsx`, and insert the Supabase `games` row (see `docs/GAME_BUNDLE_DEPLOYMENT.md`). Do not apply database changes or deploy.

## 7. File layout

```
games/delivery/index.html        game (CSS + JS inline, three.js inlined or from one pinned CDN version)
games/delivery/data/height.png   baked elevation
games/delivery/data/districts.png  baked district-ID raster
games/delivery/data/districts.json district table
games/delivery/data/*            any other baked masks (rivers, land cover)
scripts/delivery-data/*                 bake scripts (rebuildable)
```
Games are deployed from `games` to Cloudflare Pages, so sibling data files work. Keep total payload sensible for mobile data in Nepal: aim for under about 8 MB total, and say what you ended at.

## 8. Order of work

1. Data bake: 77 districts verified, heightmap, ID raster, JSON. Print a sanity report (count, list of names, area of each, e.g. check Dolpa is the largest, Bhaktapur the smallest).
2. A flat-shaded terrain viewer with chunked LOD, proving the performance budget on a phone-sized viewport.
3. Port the jet and flight, takeoff from a real airport.
4. Terrain look (colors, rivers, snow, haze, sky). This is the beauty pass; spend real time and compare screenshots against reference photos of Nepal from your own knowledge.
5. Missions, drop, reveal, scoring, hints.
6. Learning stats and weighted mission selection.
7. Screens and results atlas.
8. Audio (synthesized WebAudio: calm engine, wind, drop whoosh, parachute, reveal chime; start after the first tap).
9. Performance pass and cleanups.

## 9. Verification

- Serve the folder statically and test in a real browser using the Chrome tools at a phone portrait size (390x844) and landscape. Read the console after every major step. Take screenshots of every screen.
- Test the drop logic with known coordinates: drop the package at the centroid of every one of the 77 districts and assert the lookup returns that district. Include it as a script.
- Report frame time numbers. Real-device testing on the Samsung A16 is the user's job.
- Final report: data sources used with licenses, the chosen scales, payload size, what you could not verify.

## 10. Definition of done

- A new player can take off, understand the mission, drop, and get the reveal in under two minutes with no instructions.
- All 77 current districts are askable and resolvable, none of them labeled in the world.
- The country is recognizable from the air: Terai flat in the south, the white wall of the Himalaya in the north, Kathmandu and Pokhara valleys, the big rivers.
- The jet feels like the air-raid jet.
- Smooth on a low-end Android phone. No console errors.


## v2 changes

Everything below is in `games/delivery/` with sources in `scripts/delivery-data/` (`src/*.js` modules are assembled by `build.mjs`). Nothing is committed or deployed.

**A. HUD, plane, borders, hints.** District and province borders are drawn in the terrain shader from a baked edge-distance field (`edge.png`), so lines keep a constant on-screen width. The district under the plane gets an accent border and faint tint. A BORDERS toggle (remembered) switches to "expert" mode, worth x1.5 score. New hint "Where am I" (costs score, then province, HQ, neighbours). The jet was replaced by a procedural DHC-6 Twin Otter with a generic livery. Why: the user asked for a Nepal-appropriate aircraft and for borders as a learning aid.

**B. Lived-in sky.** Continuous day-night cycle (about 10 minutes, `?debug&t=18.3` or `__d.setTod`), live sun and moon lighting from heightmap normals (the baked `shadow.png` was removed), a cheap 4-tap cast shadow march only within about 110 units of the camera, alpenglow on high snow and rock, a pink anti-solar band, morning valley fog, sun-coloured drifting clouds, and up to 150 instanced birds (soaring raptors at midday, small flocks at dawn and dusk, V formations).

**C. Lived-in ground.** Overture Maps (OSM and ML footprints) baked into `world.png` (built-up density, dominant building orientation, road class) and `roads.bin` (302k simplified road ways), lazily loaded after take-off. Far tier is shader-only (roofs, city glow, highway light strings). Near tier streams about 5 km of deterministic density-driven instanced houses (not real footprints), lit windows, ribbon roads, street lights and up to 150 vehicles with head and tail lights. Checks are in `test-world.mjs`.

**D. Feedback round.** Circular heading-up moving minimap with three zoom levels (130 km, 300 km, whole country). Complete UI redesign (design tokens in `style.css`, flight-ticket mission card, armed drop button with falling ring, cinematic reveal with letterbox, trip-log results, pause and settings). Detailed Twin Otter with animated control surfaces, gear, props and door. 8 to 10 second takeoff sequence. Airport scenes built when near (runway markings from real heading, lights, terminal, tower, windsock, Lukla slope and wall) with lengths and headings from OSM runways. Detailed crate and canopy with release tumble, chute inflation, landing collapse and dust. Named peak labels (setting, default on). "OUTSIDE NEPAL" notice with India, China or Bhutan from a Natural Earth raster.
