# Манифест 3D-ассетов (Asset Manifest)

Все создаваемые 3D-модели, скелеты, материалы и анимации воспроизводимы через исходные `.blend` файлы и генерационные скрипты в `art/blender/`.
Ниже приведён реестр планируемых и создаваемых ассетов по этапам миграции.

| Ассет | Исходный файл (.blend / script) | Экспортированный файл (.glb) | Автор / Происхождение | Лицензия | Статус |
|---|---|---|---|---|---|
| Базовый житель (Clayfolk resident) | `art/blender/resident.blend` | `godot/assets/models/resident.glb` | Авторский ассет проекта Clayfolk (`art/blender/generate_resident.py`) | Лицензия проекта Clayfolk | Created / verified (M1) |
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

### Спецификация костей и сокетов базового жителя (M1.1)

- **Иерархия скелета (`ResidentArmature` / `Skeleton3D`)**:
  - `Root` (опорная точка на грунте Z=0)
    - `Hips` (таз Z=0.49м, вертикальное покачивание Z(t)=0.468+0.016*sin при ходьбе)
      - `Spine` (торс и грудь, наклон и компенсация шага)
        - `Head` (голова, выступающие глиняные глаза и нос)
          - `Socket_Head` (Z=1.72м, для будущих ритуальных масок/венцов)
        - `Socket_Cargo` (Z=0.65м, Y=-0.28м в Blender / Y=0.65м, Z=0.28м в Godot; крепление переносимых ресурсов)
        - `UpperArm.L` -> `LowerArm.L` -> `Hand.L` (бесшовный 8-сегментный quad-loft от плеча через локоть к предплечью и кисти-рукавице; охват груза с расстоянием до сокета 0.00м)
        - `UpperArm.R` -> `LowerArm.R` -> `Hand.R` -> `Socket_Tool_R` (симметричный органический quad-loft / крепление инструментов)
      - `UpperLeg.L` (длина 0.23м) -> `LowerLeg.L` (длина 0.21м) -> `Foot.L` (мокасиновая лепка подошвы, строго плоская опора Z=0.000м, длина 0.22м, ширина 0.14м, лодыжка Z=0.050м)
      - `UpperLeg.R` (длина 0.23м) -> `LowerLeg.R` (длина 0.21м) -> `Foot.R` (мокасиновая лепка подошвы, строго плоская опора Z=0.000м, длина 0.22м, ширина 0.14м, лодыжка Z=0.050м)
  - **Элементы лепки тела и лица**:
    - Голова, лобная дуга и нос-пуговка объединены единым материалом `ClayBody` (никаких швов и цветовых стыков на черепе).
    - Врезные глянцевые шарики глаз `DarkEyes` (акцентные тёмные глиняные бусины).
    - Плетёный рельефный травяной пояс `GrassCord` вокруг талии (свитый тор с 3-прядным рельефом) с передним узлом и двумя свободно свисающими концами шнура.
    - 100% замкнутый водонепроницаемый манифольд меша (0 граничных и неманифольдных рёбер).

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

