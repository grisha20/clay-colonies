# Манифест 3D-ассетов (Asset Manifest)

Все создаваемые 3D-модели, скелеты, материалы и анимации воспроизводимы через исходные `.blend` файлы и генерационные скрипты в `art/blender/`.
Ниже приведён реестр планируемых и создаваемых ассетов по этапам миграции.

**Обратная связь 20.10.2026:** текущий игровой образ отклонён владельцем; 2D-версия выглядит привлекательнее. `Created / verified (M1)` ниже означает наличие и технические проверки ассета, а не художественное одобрение. Большая часть мира пока показана сферами/коробками, грунт почти однотонный; наличие normal-карт не означает законченные материалы и окружение. Следующий визуальный шаг — небольшой цельный лагерь по референсам 2D до массового тиражирования ассетов.

**21.10.2026:** природа, ресурсы, карьеры, склад, мастерская, идол, ограда, ворота, враги и рыбы созданы процедурно в `godot/scripts/world/prop_factory.gd` (авторский код проекта, лицензия проекта); строки `Planned` ниже относятся к будущим Blender-версиям. Подробности — [WORLD_DRESSING](WORLD_DRESSING.md).

| Ассет | Исходный файл (.blend / script) | Экспортированный файл (.glb) | Автор / Происхождение | Лицензия | Статус |
|---|---|---|---|---|---|
| Базовый житель (Clayfolk resident) | `art/blender/resident.blend` | `godot/assets/models/resident.glb` | Авторский ассет проекта Clayfolk (Codex, `generate_resident.py` + `resident_sculpt.py`) | Лицензия проекта Clayfolk | Authored / technical checks passed 22.10.2026; owner art review pending |
| Костёр и очаг (Campfire) | `art/blender/campfire.blend` | `godot/assets/models/campfire.glb` | Авторский ассет проекта Clayfolk (`art/blender/generate_props.py`) | Лицензия проекта Clayfolk | Created / verified (M1) |
| Хижина (Hut) | `art/blender/hut.blend` | `godot/assets/models/hut.glb` | Авторский ассет проекта Clayfolk (`art/blender/generate_props.py`) | Лицензия проекта Clayfolk | Created / verified (M1) |
| Переносимый груз (Cargo) | `art/blender/cargo.blend` | `godot/assets/models/cargo.glb` | Авторский ассет проекта Clayfolk (`art/blender/generate_props.py`) | Лицензия проекта Clayfolk | Created / verified (M1) |
| Склад (Storage) | `art/blender/storage.blend` | `godot/assets/models/storage.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Мастерская (Workshop) | `art/blender/workshop.blend` | `godot/assets/models/workshop.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Идол (Idol) | `art/blender/idol.blend` | `godot/assets/models/idol.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Ограда (Wall section) | `art/blender/fence.blend` | `godot/assets/models/fence.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M3) |
| Ворота (Gatehouse) | `art/blender/gate.blend` | `godot/assets/models/gate.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M3) |
| Ресурсы (Глина, Дерево, Камень) | `art/blender/resources.blend` | `godot/assets/models/resources.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Паук (Spider) | `art/blender/spider.blend` | `godot/assets/models/spider.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Жук (Beetle) | `art/blender/beetle.blend` | `godot/assets/models/beetle.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Озёрный монстр (Lake monster) | `art/blender/monster.blend` | `godot/assets/models/monster.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |
| Рыбы (Lake fish) | `art/blender/fish.blend` | `godot/assets/models/fish.glb` | Авторский ассет проекта Clayfolk | Лицензия проекта Clayfolk | Planned (M4) |

### Житель — обновление 22.10.2026

[Результат, сборка, проверки и сравнение](RESIDENT_REMODEL.md). Blender 4.2.3 LTS → Godot 4.7.2 Forward+. Рост 1.74596 м, 2466 вершин / **4908 треугольников** до импортных UV-разрывов; 19 костей. GLB сохраняет тот же треугольный бюджет. Меш/узел `Resident`, armature `ResidentArmature`, Godot создаёт `Skeleton3D`.

Поверхности строго: **0 ClayBody, 1 DarkEyes, 2 GrassCord**. Обычные Principled BSDF, базовые цвета нейтральные; клиент перекрашивает 0/2 и затемняет обожжённых. `resident_clay_normal.png` (512×512) создаётся скриптом, хранится в `godot/assets/textures/`, упакован в blend/GLB. Без внешних ассетов и абсолютных зависимостей. PNG, извлекаемые Godot из GLB, генерируются при импорте и не дублируются в Git.

Тело/голова/нос/конечности — одна замкнутая voxel-remesh оболочка после сглаживания и decimate; глаза, пояс, узел и два конца — отдельные замкнутые компоненты того же меша. В исходной сетке 0 неманифольдных рёбер. Лёгкая асимметрия, вмятина улыбки, следы лепки в геометрии и normal-карте. Ступни с плоскими подошвами на Blender Z=0 (Godot Y=0).

Иерархия имён сохранена:

- Root → Hips → Spine → Head → Socket_Head.
- Spine → UpperArm.L/R → LowerArm.L/R → Hand.L/R; Hand.R → Socket_Tool_R.
- Hips → UpperLeg.L/R → LowerLeg.L/R → Foot.L/R.
- Spine → Socket_Cargo.

Rest: Hips Z=.49, Spine Z=.72, Head Z=1.12; Socket_Head Z=1.72, груз крепится туда с клиентским подъёмом .12. Socket_Cargo=(0,-.44,.85). Правые локоть/кисть смещены под новый силуэт: LowerArm.R=(.45,-.02,.78), Hand.R=(.485,-.07,.54), Socket_Tool_R=(.485,-.16,.50) в Blender. Слева зеркально. Socket_Tool_R следует правой кисти. Лицо смотрит в Blender -Y / Godot +Z.

Пять циклов по 1 с / 30 FPS: idle (дыхание и поворот головы), walk (прежняя IK-опора, шаг .48 м/цикл), work_gather (правый удар сверху вниз), carry_idle и carry_walk (совместимость прежнего режима). В текущем коде carry-клипы используются при переноске; груз при этом находится на голове. Проверка 31 кадра каждого клипа: подошвы не проникают в землю, опора нулевая, мах обеих ног не меньше .050 м. Проверка не привязана к прежним «первым 96 вершинам».

Прежний GLB архивирован в `godot/tests/fixtures/resident_before_20261022.glb`, только для сравнительной сцены. Художественное одобрение новой модели владельцем ещё не получено.

### Материалы и меши пропсов лагеря (M1.1)

- **Текстуры нормалей и микрорельефа (`godot/assets/textures/`)**:
  - `clay_normal.png` (512x512) — процедурный бесшовный микрорельеф лепки сырой глины и мазков пальцев.
  - `cord_normal.png` (256x256) — спиральный рельеф витого шнура.
  - `thatch_normal.png` (512x512) — волокна соломенного настила.
- **Костёр (`campfire.blend` / `campfire.glb`)**:
  - `ClayStone`: 9 скульптурных глиняных валунов вокруг очага с текстурой `clay_normal.png`.
  - `AshMound`: заглублённая чаша с золой и пеплом.
  - `CharredWood`: обугленные поленья, перекрещенные над очагом.
  - `Embers`: раскалённые тлеющие угли с эмиссией (roughness 0.88, emission orange 2.5).
  - `CampfireFlame`: объёмный 3D-меш стилизованного глиняного пламени (emission strength 3.8).
- **Хижина (`hut.blend` / `hut.glb`)**:
  - `HutClay`: лепные глиняные стены с расширенной земляной завалинкой у основания (R=1.42 -> 1.32 -> 1.24м) и сквозным дверным проёмом.
  - `HutThatch`: коническая соломенная крыша с текстурой нормалей `thatch_normal.png`.
  - `HutWood`: деревянные опорные столбы и притолока входа.
  - `HutInterior`: заглублённая задняя стенка ниши проёма (Y=-0.95м) с поглощающим свет материалом (подтверждено raycast).
- **Груз (`cargo.blend` / `cargo.glb`)**:
  - `CargoClay`: округлый тюк сырой глины с текстурой `clay_normal.png`.
  - `GrassCord`: перекрещивающаяся плетёная обвязка с рельефом `cord_normal.png`.

Все модели используют гармоничную глиняную палитру (burnt terracotta, охристые оттенки, матовая микрорельефная шероховатость).
Площадка земли `GroundPlatform` в Godot снабжена материалом с картой `clay_normal.png` для естественного земляного рельефа.

