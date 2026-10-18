# Clayfolk resident atlas

Generated with the built-in OpenAI image generation tool on 2026-10-18.
Original PNG retained without pixel edits; the renderer selects frames using texture rectangles.
4 columns: front, right, back, left. 4 rows: idle, step A, step B, carrying/working.

## Prompt

Use case: stylized-concept
Asset type: production 2D game character sprite atlas for Clayfolk, a top-down colony simulation about a tiny hand-sculpted clay people.
Create a polished, charming but robust terracotta clay villager, with a slightly irregular sculpted head, expressive small inset dark eyes, a small modeled nose and brow, short stocky limbs, broad simple clay feet, a subtle woven grass cord at the waist. A living handmade clay miniature, with restrained fingerprints and soft material shading, appealing animation-ready silhouette. No hair, no helmet, no weapons, no carried objects. Natural warm burnt-ochre terracotta with lighter clay on the face and shoulders. No pixel art, no flat circle-and-rectangle body, no gingerbread man. Premium stylized game asset with clean readable forms, as if a beautifully sculpted miniature photographed for a game.
Composition: ONE square sprite atlas, exactly 4 columns and 4 rows, sixteen evenly spaced full-body poses of THE EXACT SAME character. Equal square cells, no grid lines. Column 1 faces south/front (toward viewer), column 2 faces east/right, column 3 faces north/back, column 4 faces west/left. Camera fixed orthographic, elevated overhead about 60 degrees above ground, suitable for a top-down game; never change camera, perspective, character proportions, material or lighting between cells.
Row 1: standing idle neutral, arms relaxed.
Row 2: walking contact pose A, left foot forward and right foot back, opposing arm swing.
Row 3: walking contact pose B, right foot forward and left foot back, opposing arm swing.
Row 4: stationary working/carrying pose, both hands held together in front of the lower chest as if holding an invisible bundle. Hands EMPTY, no object.
Registration: every character has identical scale, body centered horizontally within its cell. Each character's ground-contact foot baseline at exactly 86 percent of its cell height, and top of head near 15 percent; maintain same centered root position across all poses. Generous transparent gutter around each figure. Characters never overlap cells.
Lighting: softly lit from upper left, subtle ambient occlusion in joints only, no cast ground shadow, no platform, no background. Genuinely transparent alpha throughout the empty space. No text, labels, logos, borders, watermarks or props.
