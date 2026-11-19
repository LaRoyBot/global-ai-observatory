# Realistic Globe & Stealth Polish — Execution Plan

## Problem
The current globe reads as a generic dashboard widget: flat vector country fills,
uniform graticule, glowing dots and thin arcs on a flat navy disc. The UI is
competent but template-like. Target: a quiet, precision-instrument "stealth"
observatory with a photoreal Earth.

## Design direction
- **Real Earth**: NASA Blue Marble day texture + Black Marble city lights at night,
  mapped onto the orthographic sphere per-pixel in Canvas 2D (no WebGL — locked
  constraint, older-ThinkPad target).
- **Real terminator**: day/night boundary computed from the actual current UTC
  solar position (subsolar lat/lon), soft twilight band. Night side = dark earth
  + faint amber city lights. This is a genuine, checkable detail, not decoration.
- **Atmosphere**: thin blue fresnel limb, limb darkening, subtle specular on oceans.
- **Stealth flows**: arcs become tapered hairlines with directional gradient;
  particles become small comets with short trails; node glow reduced; borders
  near-invisible until hover/selection; graticule removed from realistic mode.
- **Instrument UI**: live readouts (rotation λ/φ, UTC clock, subsolar point,
  frame budget), hairline panels instead of boxed cards, quieter nav, vignette
  stage. No neon, no decorative stars.

## Workstreams
1. **Textures** — acquire public-domain NASA equirectangular day + night maps
   (2048×1024), vendor locally under `public/textures/`, attribution recorded.
2. **Sphere mapper** (`src/geography/earth-texture.js`) — precomputed per-pixel
   unit-sphere lookup at capped resolution (≤420px), typed-array rotation +
   equirectangular sampling, day/night blend from real solar geometry, limb
   darkening. Fast path for λ-only auto-rotation; recompute base on tilt change.
   Throttled to ~30fps texture updates; particles stay 60fps.
3. **Engine integration** — realistic base layer replaces the vector fill when
   textures load and low-power is off; vector globe remains the fallback
   (CDN/texture failure, low-power, reduced-motion). Borders/selection/hit-testing
   unchanged and aligned to the same projection.
4. **Flow refinement** — tapered gradient arcs, comet-trail particles, quieter
   palette usage, refined node rendering.
5. **Stealth UI polish** — hairline surfaces, refined type scale, instrument
   readouts in the globe stage footer, vignette, quieter sidebar/topbar.
6. **Verification** — browser screenshots (day side + night side), frame-time
   measurement, low-power fallback test, reduced-motion test, texture-failure
   fallback test. Commit + push.

## Honesty constraints (unchanged)
- Synthetic-flow disclaimer stays visible; realistic imagery is NASA public-domain
  basemap, not data. City lights are a 2012 composite, labelled as such in sources.
- No fabricated "live" claims: the terminator is real astronomy; the flows are not.
