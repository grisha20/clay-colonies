# Clayfolk: каталог сгенерированных ассетов

Дополнение: [глиняные здания v2, PNG/JSON и запрос](../buildings/clay-v2/PROMPT.md).
Дополнение: [венки правителей с ракурсами](royals/PROMPT.md), [ходьба и переноска v2, PNG/JSON и полные запросы](clayfolk/WALK-V2-PROMPT.md).

Все изображения созданы встроенным инструментом OpenAI ImageGen для Clayfolk 18.10.2026. PNG сохранены без редактирования пикселей. Исходные семь атласов — RGBA 1254×1254, сетка 4×4 с прозрачным фоном; полный запрос находится по ссылке рядом. Их размер — 9 578 799 байт. Добавлены венки 1536×1024 и два цикла ходьбы 887×1774; итого десять PNG, 14 264 323 байта.

| Набор | PNG | Запрос | Порядок кадров |
| --- | --- | --- | --- |
| Житель | [resident-atlas.png](clayfolk/resident-atlas.png) | [PROMPT.md](clayfolk/PROMPT.md) | Столбцы: вперёд, вправо, назад, влево. Строки: покой, шаг A, шаг B, руки с грузом |
| Действия жителя | [resident-actions-atlas.png](clayfolk/resident-actions-atlas.png) | [ACTIONS-PROMPT.md](clayfolk/ACTIONS-PROMPT.md) | Те же направления; переноска A/B, замах, удар. Сгенерирован по исходному жителю |
| Паук | [spider-atlas.png](creatures/spider-atlas.png) | [spider-PROMPT.md](creatures/spider-PROMPT.md) | Четыре направления; покой, шаг A/B, подготовка действия |
| Жук | [beetle-atlas.png](creatures/beetle-atlas.png) | [beetle-PROMPT.md](creatures/beetle-PROMPT.md) | Четыре направления; покой, шаг A/B, подготовка действия |
| Озёрный монстр | [lake-monster-atlas.png](creatures/lake-monster-atlas.png) | [lakeMonster-PROMPT.md](creatures/lakeMonster-PROMPT.md) | Те же состояния; ошибочные боковые профили генерации зеркалятся в `creatureArt.ts` |
| Предметы | [equipment-atlas.png](equipment/equipment-atlas.png) | [PROMPT.md](equipment/PROMPT.md) | По строкам: топор, кирка, молоток, копьё; удочка, водомёт, глина, дерево; камень, томат, мясо, рыба; сумка, лист, повязка, шар |
| Рыбы | [fish-atlas.png](fish/fish-atlas.png) | [PROMPT.md](fish/PROMPT.md) | Строки: золотая, синяя, серебряная, красная. Столбцы: прямо, хвост влево/вправо, боком в руках |

Границы видимых кадров и опорные точки хранятся в одноимённых JSON рядом с PNG; у исходного жителя — в `client/src/render/surface/characterArt.ts`. `scripts/inspect-sprite-atlas.py` читает альфа-канал и записывает только метаданные, не изменяя изображение. Рендер сохраняет масштаб внутри цикла, использует линейную фильтрацию и общие расчёты креплений предметов.

Проверять результат в `/motion.html`: все направления, груз, работа, пленники, рыбы и толпа. Венки — в наборе «Правители: четыре ракурса», есть скорость ¼× для медленного шага. Размер текстур на диске не равен памяти GPU: десять RGBA-атласов требуют примерно 60 МиБ распакованных пикселей без остальных ресурсов и накладных расходов.
