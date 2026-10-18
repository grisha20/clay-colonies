# Ходьба и переноска v2

Встроенный OpenAI ImageGen, прозрачный RGBA. Конечные PNG скопированы в проект без редактирования пикселей.

- [Обычная ходьба](resident-walk-v2.png), [регистрация](resident-walk-v2.json).
- [Переноска](resident-carry-walk-v2.png), [регистрация](resident-carry-walk-v2.json).

Источник переноски — исходные `resident-atlas.png` и `resident-actions-atlas.png`. Обычная ходьба получена редактированием финальной переноски, чтобы сохранить соответствующие ноги и ракурсы.

PNG содержат 4 столбца × 8 рядов. В рендер выбраны 7 пригодных фаз: последний ряд меняет пропорции слишком сильно и не включён в JSON. Итого 28 кадров в каждом наборе, 56 рабочих кадров. Столбцы: вперёд, вправо, назад, влево. Неровные промежутки между рядами зарегистрированы через `inspect-sprite-atlas.py --row-edges 0,250,474,696,915,1138,1358,1580 --columns 4 --rows 7 --head-anchors`. Альфа-канал используется только для измерений; опоры головы и размер сохраняются в JSON.

## Запрос переноски (полный)

Use case: stylized-concept. Production Clayfolk CARRYING WALK sprite sheet. Match EXACT same bald terracotta clay person, grass waist cord, proportions, orthographic elevated view, warm soft light and tactile clay style of the references. Second reference shows the carrying arm position. No actual carried object, hands held together in FRONT of the belly/chest to support a future object. Make exactly 32 separate full body sprites in a STRICT equal 4 COLUMN x 8 ROW grid. This must contain EIGHT COMPLETE ROWS, not seven, fill all eight rows. Columns left-to-right FRONT, RIGHT, BACK, LEFT. Rows are eight sequential equally spaced phases of one calm walking cycle, smoothly looping, first4 rows left-foot step, last4 right-foot step, alternate contact/loading/passing/reach. Arms stay held in front for carrying throughout; even when viewed from back, arms reach toward the far/front side and never behind the back. Relaxed small strides, no running or jumping, head/torso almost level, identical size/shape/identity in all frames. One character centered in EACH of 32 identical cells. Head and feet entirely within own cell, generous transparent gutters, common ground baseline relative to each cell. Prefer tall canvas, shrink every figure equally as needed so all 8 rows fit. GENUINE transparent RGBA background and gaps, NO ground or baked shadows, no text, no borders, no extra objects.

## Запрос обычной ходьбы (полный)

Edit target: provided EXACTLY 4 columns by 8 rows Clayfolk sprite sheet. Preserve all 32 character positions, all EIGHT rows, column headings directions (front/right/back/left), exact identity, head, torso size, legs and walking phase, feet, material, lighting, transparent background and canvas layout. Change ONLY the carrying arms: relax hands down by the hips, arms swinging gently opposite the stepping leg, so this becomes normal empty-handed walking instead of carrying. Small natural arm swing, no oversized gestures. Every frame must keep the original HEAD and LEGS from its corresponding source frame, same size and registration; don't regenerate the walking phases. No actual objects, text, shadows or ground. Need ALL 32 complete sprites, 4x8, same source canvas dimensions, preserve RGBA transparency. Do not remove or combine any rows, especially the last row. This is the matching empty-handed variation of the carrying walk.
