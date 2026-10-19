# Боковые фазы — 19.10.2026

Встроенный imagegen, прозрачный фон. Итоговый исходник без изменения пикселей: `resident-side-walk-v4.png`, 1230×1278. Четыре строки: вправо, влево, с грузом вправо, с грузом влево. Используются столбцы 0, 1, 3; столбец 2 повторяет контакт и исключён из цикла. Для противоположного контакта используется прежний `resident-walk-v2` / `resident-carry-walk-v2`, строка 0. Это проверено по таблице реальных кадров в мастерской, а не по предположению о том, что генератор выполнил запрос.

Исходники imagegen в `C:/Users/Степан/.codex/generated_images/01a14abb-c40a-76a0-a2e1-e04d3d8674d3/`: первый `exec-6d33a0e1-a5df-415b-809a-1cdad3b9e95c.png`, исправленный `exec-1d2c5044-fa34-4f51-8521-1919bebe0c9f.png` (копия в проекте).

Регистрация без изменения PNG:

```
python scripts/inspect-sprite-atlas.py client/public/assets/characters/clayfolk/resident-side-walk-v4.png --columns 4 --rows 4 --row-edges 0,325,635,932,1278 --head-anchors --require-gutters
python scripts/inspect-walk-palette.py
```

Последняя команда записывает покадровую калибровку цвета в метаданные, PNG не редактируется. Она нужна, поскольку генерация сохранила иной оттенок кожи. После повторной регистрации геометрии запускать её ещё раз.

## Первый запрос

Референсы: оба исходных атласа ходьбы v2.

Create a corrective SIDE VIEW walking animation sprite sheet of the EXACT reference Clayfolk bald terracotta clay child with olive cord belt. Same original character, materials, head/body scale, camera and warm upper-left light. The existing references have a flaw: the near leg stays behind in almost every frame. FIX THIS WITH DISTINCT ALTERNATING LEGS, do not reproduce that flaw. Output 4 columns by 4 rows, 16 FULL-BODY INTACT sprites, even grid, transparent RGBA background, no ground or shadows or text, generous transparent gutters. All sprites same body/head dimensions and ground baseline relative to their cell. Rows 1 and 3 face RIGHT; rows 2 and 4 face LEFT. Rows1+2 empty hands gently swinging. Rows3+4 hands cupped in front of belly for carrying, no object. The FOUR COLUMNS are FOUR CLEAR DIFFERENT KEYFRAMES in chronological order: column1 NEAR LEG FORWARD planted ahead of belly, FAR LEG BEHIND with heel lifting; column2 NEAR LEG planted straight UNDER hip, FAR LEG lifted and swinging forward past it with bent knee; column3 FAR LEG FORWARD planted ahead of belly, NEAR LEG BEHIND with heel lifting (opposite contact to column1); column4 FAR LEG planted straight UNDER hip, NEAR LEG lifted and swinging forward past it with bent knee (opposite passing to column2). Front means right for right-facing rows, left for left-facing rows. Near and far legs MUST visibly exchange places across columns. Show both connected legs and both rounded clay feet in each sprite; use slightly darker shading on far leg so their alternating positions are clear. Modest natural walking stride with anatomical knees/ankles and short thick healthy legs, rounded feet, never running, stretching, detached limbs, triangle feet or skating poses. Heads and torsos stay upright and steady. Prioritize visibly different leg silhouettes in adjacent columns. Output no front or back views, only these side views.

## Уточнение

Референсы: первый результат, исходный `resident-walk-v2.png`.

CORRECT the first reference 4x4 sprite sheet. It is NOT a valid alternating walk: columns1 and3 currently look identical with the NEAR leg forward. Preserve the first reference's exact heads, torsos, arms, colors and 4x4 arrangement. Repaint ONLY below the cord belt. In COLUMN3 of EVERY row, the large foreground NEAR leg must extend BACKWARDS, and the smaller darker FAR leg extends FORWARDS: right-facing rows1+3 foreground leg angles DOWN-LEFT with foot at LEFT of pelvis, background leg angles DOWN-RIGHT with foot RIGHT of pelvis; left-facing rows2+4 foreground leg angles DOWN-RIGHT with foot RIGHT of pelvis, background leg angles DOWN-LEFT with foot LEFT of pelvis. In reference2 the right-facing character in the first row demonstrates this backwards foreground leg position. COLUMN1 stays NEAR leg FORWARD, so columns1 and3 must be VISIBLY OPPOSITES in foreground-leg direction. COLUMN2: foreground near leg VERTICAL directly under pelvis, its whole sole planted flat on baseline; small far leg bent, its foot lifted BEHIND calf. COLUMN4: background far leg VERTICAL directly under pelvis with sole flat planted, foreground near leg bent and lifted FORWARD, its rounded foot CLEARLY ABOVE baseline. Keep legs short chunky healthy clay anatomy. All 16 healthy intact characters have two visible connected legs. Keep original image dimensions, 4 columns and4 rows, all heads at same heights, keep transparent background. No text, shadows, ground. The four different leg poses must be visibly distinct, NOT duplicates.

Генерация не исправила третий столбец достаточно; он не подключён. Дополнительная попытка создать контакт отдельным листом (`exec-7b2657c8-d5ec-4e9b-a6d2-d1b67152402e.png`) также повторила не ту позу и не включена в проект.
