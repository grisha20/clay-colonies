# Clayfolk: ground and building gardens

Generated with the built-in image_gen tool on 2026-10-18. PNGs are copied without pixel edits; texture windows and masks are applied by the game renderer.

- `terrain-soft-atlas.png`: opaque 1254×1254, 2×2 quadrants: clay, moss, damp clay, sandy clay. Final edit output `exec-f0f47bc1-c525-43fc-a6f1-632366e70cee.png`.
- `garden-atlas.png`: transparent 1774×887, 4×2 props. Output `exec-cb1d6a66-1ccc-4549-8d13-dab203bc6c12.png`. Reference: `assets/buildings/clay-v2/buildings-atlas.png`.
- `garden-atlas.json`: alpha bounds measured by `scripts/inspect-sprite-atlas.py`; source PNG alpha preserved.

## Initial terrain reference (intermediate, not shipped)

```text
Use case: stylized-concept. Production game terrain texture atlas for Clayfolk tactile clay miniature colony-sim. Square image, EXACT 2x2 equal quadrants, each quadrant a seamless top-down ORTHOGRAPHIC flat tile texture, no perspective. Top left warm muted ochre compressed clay earth; top right muted olive-green fine moss and short grass woven into clay earth; bottom left slightly darker damp umber clay mud; bottom right warm sandy clay path with a few tiny grains. Overall low contrast, matte hand-sculpted polymer clay microtexture, very soft nearly ambient overhead lighting, small organic irregular dimples, subtle clay tool marks. Earth colors harmonize with terracotta clay huts and little clay people. No checkerboard pixels, no harsh grain, no big rocks or leaves, no text, no gridlines, no cast shadows, no highlights/shadows revealing tile boundaries, no large streaks or cracks. Each of FOUR quadrants is an independently seamless tile with consistent brightness across opposite edges. Image completely filled, no margins. Fine understated natural surface intended as game floor behind detailed clay characters, readable calm background.
```

## Garden props

```text
Use case: stylized-concept. Clayfolk production ground-cover prop atlas, matching the tactile hand-sculpted miniature clay style of the reference huts (style reference only). Exactly EIGHT isolated tiny ground-cover props in strict equal 4 columns by 2 rows grid. Row1: short olive grass tuft, tiny clover patch, three minute cream/yellow wildflowers with green leaves, small patch of violet flowers. Row2: short broad-leaf plant, small moss cushion, cluster of three tiny clay pebbles with grass, little daisy tuft. GENUINE TRANSPARENT RGBA around each separate object. Orthographic elevated top-down game camera matching reference buildings; plants low and small, not tall bushes; each prop fully in own cell with generous gutters and common ground-root. Soft warm diffuse upper-left light; subtle contact shade only within the prop, NO oval shadows or ground disks. Muted sage/olive greens, subdued cream/pale yellow/lavender petals; no saturated neon, no labels, no borders, no pots, no characters or buildings. These grow around base of earthen huts to anchor them to the world; deliberately understated miniature details readable at 8-18 pixels tall.
```

## Final terrain edit

```text
Edit this FOUR-quadrant game terrain material atlas. Preserve exact 2x2 quadrant layout, no margins or lines; preserve upper-right moss palette and bottom-left damp clay. Change ALL quadrants to have MUCH LOWER CONTRAST and MUCH FINER even material: remove pebbles/lumps and every diagonal streak or broad sweeping stripe. Top-left and bottom-right become soft pale warm beige/ochre matte polymer clay, no orange saturation, fine shallow irregular dimples like hand-worked clay. Upper-right subdued sage olive moss on clay, no diagonal streaks. Bottom-left muted brown moist clay. Every tile evenly lit overhead, zero directional shadows, each independently seamless across opposite edges. Should look calm and soft behind highly detailed clay miniature characters, not gravel or photographic dirt, no recurring motifs or large forms. Subtle tactile finish with tiny imperfections only. Fully opaque texture fills image. Avoid high contrast noise, repeated diagonal bands and hard bumps.
```

The intermediate terrain image is retained in the original generated-images directory as `exec-48502764-2ddb-4b29-b4c8-5ec7bf4e5a7d.png`. The final terrain edit used that image as its reference. Runtime materials use linear filtering, a 0.26 tile scale, muted tints, and a feathered camp clearing. Gardens appear only beside completed building foundations; door approaches remain clear.
