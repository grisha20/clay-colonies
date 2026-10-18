# Clayfolk: плавание, кувшинки и забор

Создано встроенным ImageGen 18.10.2026. PNG скопированы без изменения пикселей. Обрезки, поворот хвоста, прозрачность предпросмотра и контакт с поверхностью задаются рендером.

| Файл | Назначение | Исходный результат |
|---|---|---|
| `characters/creatures/lake-swim-atlas.png` | 4 ракурса плавания + 4 ракурса отдыха | `exec-bdb2eb4d-5430-4760-b286-fa8c918f51f1.png` |
| `environment/clay-v2/lilies-atlas.png` | 4 вида кувшинок, прозрачный фон | `exec-1221d7b4-0ac2-4d13-9e77-013d39395171.png` |
| `buildings/clay-v2/fences-atlas.png` | забор/ворота, два направления | `exec-aaee908f-d243-4dc7-8a46-a71a3a5abb57.png` |

JSON содержит измеренные границы непрозрачных компонентов. У плавания и забора использованы реальные компоненты целого изображения: сгенерированные интервалы между объектами не везде совпадают с равномерной сеткой. Исходные PNG сохранены целиком.

## swim

Референсы: F:/GitHub/Clayfolk/client/public/assets/characters/creatures/lake-monster-atlas.png

```text
Use case: stylized-concept. Production Clayfolk transparent sprite atlas. Reference is creature identity and clay material only. Same cute green crocodile-toad lake predator with golden eyes, bumpy moss green clay hide, broad snout and thick tapering tail. EXACT 4 columns x 2 rows, eight separate sprites, generous transparent gutters. Row 1 SWIMMING low horizontally like a crocodile: body submerged, ONLY eyes, nostrils, flattened upper head, narrow ridge of back and tail tip above an INVISIBLE horizontal waterline. NO legs or feet visible, NO upright torso, NO belly, no standing or walking. Four directions in columns: front facing bottom, right-facing profile, back facing top, left-facing profile. Row 2 same four directions RESTING sprawled very low with bent tucked limbs on an invisible lily pad; fully visible but lying belly down, not standing. Elevated orthographic top-down game view matching reference. Soft diffuse warm upper-left lighting, sculpted clay miniature. Genuine transparent RGBA around each object; NO water, ripples, lily pads, background, cast shadows, text, grid lines or ground. Keep same scale and proportions across directions. Waterline silhouettes for first row are low and flat, as a real crocodile swims.
```

## lilies

Референсы: нет (новая генерация).

```text
Use case: stylized-concept. Clayfolk game prop sprite atlas, tactile hand-sculpted polymer clay miniature, elevated orthographic top down camera. EXACT 2 columns by 2 rows, four separate large floating water lily leaf clusters. Each cluster is one broad flat round sage/olive green lily pad with a wedge notch and softly sculpted veins, plus one or two small companion leaves; top-left plain pad, top-right pad with tiny cream lily flower on the edge, bottom-left plain pad of slightly different shape, bottom-right pad with a tiny pale pink flower. Central flat unobstructed space on each pad can support a small green crocodile creature. Matte material, subtle clay finger marks, very low height, muted natural greens, warm diffuse upper-left light. Each object contained in equal cell with generous transparent gutters, GENUINE TRANSPARENT RGBA, no pond, water background, rectangular tiles, ground, cast shadows, borders, text, characters. Four isolated low flat horizontal objects only.
```

## fences

Референсы: F:/GitHub/Clayfolk/client/public/assets/buildings/clay-v2/buildings-atlas.png

```text
Use case: stylized-concept. Clayfolk modular fence wall and gate sprites matching clay miniature huts in reference (material and lighting reference only). Transparent atlas EXACT 2 columns by 2 rows. Top left: short horizontal fence section facing camera, irregular upright wooden stakes embedded firmly in a low terracotta clay berm, two rough cross rails and fiber lashings. Top right: same short fence section running north-south away from camera, elevated game view with visible depth. Bottom left: horizontal gate section, two sturdy clay-and-wood posts with wooden lintel over a visibly OPEN passage at centre, no door leaf obstructing view. Bottom right: corresponding north-south gate section with open passage. Four separate modules fully contained in equal cells with ample transparent gutters. Elevated orthographic 2D top-down view, warm soft upper-left light, tactile matte hand-worked clay and carved wood, subdued earthy brown/terracotta palette matching reference. Common ground-root, no levitation, no ground disk, no drop shadow, no grass, no characters, no buildings or text. GENUINE TRANSPARENT RGBA background. Width of horizontal fence only about twice its physical height; compact colony-sim palisade modules.
```

## Очистка фона кувшинок

Референс — первый вариант `exec-367ad0a6-4d20-4454-a9a0-5e078d5035a8.png`.

```text
Edit target: this lily pad atlas. Preserve the four clay lily pad clusters, their arrangement, colors, details, flowers and shape exactly. Remove ALL background and ALL broad green/brown atmospheric halos around the pads. Genuine clean transparent RGBA everywhere outside the physical leaf and flower shapes. No glow, no ground plane, no vignette, no shadows outside leaves. Four isolated clean sprite cutouts with fully transparent empty gutters. Keep 2 by 2 atlas layout and all leaf surfaces unchanged.
```
