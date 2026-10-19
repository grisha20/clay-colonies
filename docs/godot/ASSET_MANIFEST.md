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
        - `UpperArm.L` -> `LowerArm.L` -> `Hand.L` (угол охвата (-34°,-33°,-3°)+(-13°,0°,12°), кисти плотно прижаты к бокам тюка на расстоянии 0.00м)
        - `UpperArm.R` -> `LowerArm.R` -> `Hand.R` -> `Socket_Tool_R` (зеркальный охват груза / крепление инструментов)
      - `UpperLeg.L` (длина 0.23м) -> `LowerLeg.L` (длина 0.21м) -> `Foot.L` (лодыжка Z=0.05м, подошва Z=0.00м, двузвенный контакт без натяжения)
      - `UpperLeg.R` (длина 0.23м) -> `LowerLeg.R` (длина 0.21м) -> `Foot.R` (лодыжка Z=0.05м, подошва Z=0.00м, двузвенный контакт без натяжения)

### Материалы и меши пропсов лагеря (M1.1)

- **Костёр (`campfire.blend` / `campfire.glb`)**:
  - `ClayStone`: грубое каменное кольцо вокруг очага с микронеровностями.
  - `AshMound`: слой золы и пепла в центре очага.
  - `CharredWood`: обугленные поленья, сложенные шалашом.
  - `Embers`: раскалённые тлеющие угли с эмиссией (roughness 0.9, emission orange).
  - `CampfireFlame`: объёмный 3D-меш стилизованного глиняного пламени (emission strength 3.2).
- **Хижина (`hut.blend` / `hut.glb`)**:
  - `HutClay`: лепные толстые глиняные стены овальной формы с вырезанным сквозным дверным проёмом (X [-0.26, 0.26], Z < 0.88м).
  - `HutThatch`: коническая соломенная крыша из пучков сухой травы.
  - `HutWood`: деревянные опорные столбы и притолока входа.
  - `HutInterior`: физически заглублённая задняя стенка ниши проёма с поглощающим свет материалом (подтверждено raycast).
- **Груз (`cargo.blend` / `cargo.glb`)**:
  - `CargoClay`: округлый тюк сырой глины (полуоси 0.16x0.14x0.15м).
  - `GrassCord`: перекрещивающаяся плетёная травяная обвязка.

Все модели используют единую глиняную палитру (burnt terracotta, охристые оттенки, матовая микрорельефная шероховатость).
Любые сторонние ассеты требуют открытой лицензии (CC0 / CC-BY / MIT), а платные покупки — предварительного согласования с пользователем.

