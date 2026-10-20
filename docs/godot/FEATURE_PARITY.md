# Матрица паритета возможностей: PixiJS -> Godot 4

| Категория | Механика / Элемент | Исходная реализация (TS/Pixi) | Реализация в Godot 4 | Проверка | Статус | Примечание |
|---|---|---|---|---|---|---|
| **Сеть и протокол** | WebSocket транспорт | `client/src/main.ts` (клиент), `server/src/net/socket.ts` (сервер) | `godot/scripts/network/game_socket.gd` | Тест подключения к QA-серверу | Planned (M2) | ws://localhost:8788 |
| | Декодирование NetworkWorldSnapshot v21 | `client/src/main.ts`, `shared/types.ts` | `godot/scripts/network/snapshot_decoder.gd` | JSON fixture test v21 | Planned (M2) | Верхний уровень JSON |
| | Проверка версии протокола | `CURRENT_PROTOCOL_VERSION = 21` | `protocol_version == 21` | Ошибка при несоответствии | Planned (M2) | Защита от устаревших пакетов |
| | Отправка wire-команд | `colonyIndex` -> `colony` поле | `godot/scripts/network/command_sender.gd` | `parseCommand` валидация | Planned (M2/M3) | Wire format: `{"type": ..., "colony": 0}` |
| | Интерполяция позиций | `client/src/render/surface/motion.ts` | `godot/scripts/world/actor_interpolator.gd` | Плавное движение без телепортов | Planned (M2) | С буфером и тиковой привязкой |
| | Обработка паузы и скоростей | `world.session.speed` (0, 1, 5, 20, 50) | `godot/scripts/world/world_view.gd` | Заморозка анимаций при speed=0 | Planned (M2) | Частота шага ограничена на 20x/50x |
| **Жители (Clayfolk)** | Базовая 3D-модель | `client/public/assets/characters/clayfolk/` | `art/blender/resident.blend`, `resident.glb` | Просмотр 4 ракурсов в лаборатории | Implemented (M1) | Объёмный глиняный народец |
| | Скелет и кости | Отсутствовали (были 2D спрайты) | Скелетная оснастка (Armature) | Контакт стоп, поворот конечностей | Implemented (M1) | Голова, торс, руки, ноги, сокеты |
| | Ходьба (Walk) | 8 фаз шага, чередование ног | Скелетная цикличная анимация | Чередование двух ног, скольжение < 10% | Implemented (M1) | Нет растяжений и артефактов |
| | Переноска (Carry Walk / Idle) | Руки подняты перед грудью | Скелетная анимация + кость груза | Ресурс надёжно в руках спереди | Implemented (M1) | Сокет предмета `cargo.glb` |
| | Работа (Добыча / Стройка) | Удары киркой/топором/руками | Анимации swings/dig/build | Взмахи с инструментом в сокете | Implemented (M1/M4) | Анимация `work_gather` в M1 |
| | Атака (Melee / Shot) | Струя воды, выпад копьём | Анимации melee и выстрела водомёта | Визуальное событие 1 раз на выпад | Planned (M4) | `ant.melee`, `ant.shot` |
| | Растворение в воде | `ant.dissolved`, уменьшение масштаба | Шейдер размытия / масштабирование | Проверка масштаба и текстуры | Planned (M4) | Дождь и вода смывают глину |
| | Следы ног | `motion.ts` (пул до 800) | `GPUParticles3D` / декали следов | 5 следов на жителя, затухание | Planned (M4) | Появление строго при шаге |
| | Племя B (вариация цвета) | `colony.color === 'red'` | PBR-материал терракоты с параметром | Проверка обоих племён на сцене | Planned (M4) | Не красный фильтр поверх всего |
| **Королевская пара** | Король и королева | `client/src/render/surface/royals.ts` | `godot/scripts/actors/royal_controller.gd` | Прогулка, бегство от дождя и опасности | Planned (M4) | Декоративное поведение на клиенте |
| | Венки и короны | `headgear-v2.png` | Отдельные 3D-меши венка/короны | Крепление к кости головы | Planned (M4) | Без пульсации размера |
| **Здания** | Костёр (Campfire) | 6 кадров огня, радиус света | 3D-кострище + частицы огня + свет | Свет гаснет при fire <= 0.05 | Implemented (M1/M4) | 3D модель и свет костра в M1 |
| | Хижина (Hut) | Спрайт хижины, служебная точка | 3D-модель глиняной хижины | Отображение на фундаменте | Implemented (M1/M4) | Модель в M1, стадии стройки в M4 |
| | Склад (Storage) | Спрайт склада | Процедурный открытый склад `PropFactory.storage()` | test_world_dressing + GPU-кадр | partial | Кувшины, поленница, камни, глина; запасы склада ещё не отражаются |
| | Мастерская (Workshop) | Спрайт мастерской | Процедурный навес `PropFactory.workshop()` | GPU-кадр | partial | Верстак, наковальня, колода; производство не визуализировано |
| | Идол (Idol) | Спрайт идола, победный прогресс | Процедурный глиняный идол | GPU-кадр | partial | Рост по `idolProgress` ещё не показан |
| | Ограда (Wall) | Сетка 2x2, соединение секций | Колья + жерди между соседями своего племени (`fenceLayout.ts`) | test_world_dressing (fence_rails) | implemented | Рисование кистью — M3 |
| | Ворота (Gate) | 3 клетки по оси, створки | Ворота со створками и столбами по `gateAxis`/`gateSpan` | test_world_dressing | partial | Открытие створок не анимировано |
| **Природный мир** | Ландшафт и земля | Тайлы травы и грязи | `ground.gdshader`: луг, лагеря, дворы, карьеры, берег, тропы (`trail_map.gd`), декор `ground_decor.gd` | test_world_dressing + GPU | implemented | Тропы визуальные, живут один сеанс клиента |
| | Вода и берега | Анимация воды, маска озера | `water.gdshader` по авторскому контуру, мелководье/глубина/рябь/пена, камыши | GPU-кадр | partial | Кувшинки не добавлены |
| | Кувшинки | `lilies-atlas.png` | 3D-модель кувшинок на воде | Монстр может опираться | Planned (M4) | Опора для отдыха монстра |
| | Деревья | 3 стадии: росток, молодняк, взрослое | Процедурные деревья 3 стадий × 3 силуэта, редеют при вырубке | test_world_dressing | implemented | Анимация рубки — нет |
| | Карьеры (Глина, Камень) | Депозиты `clay-pit`, `stone-quarry` | Раскоп в грунте + вал + стенка/скала, заполненность по сумме узлов | test_world_dressing | implemented | Подпись при наведении — нет |
| **Существа** | Паук (Spider) | 2D паук, состояния голода/набега | Процедурная фигурка, плавное скольжение и поворот | test_world_dressing | partial | Ноги не анимированы, захват жителя не показан |
| | Жук (Beetle) | 2D жук | Процедурная фигурка | — | partial | Без анимации |
| | Озёрный монстр | 2D монстр, плавание и берег | Процедурная фигурка, в воде погружена | GPU-кадр | partial | Без анимации |
| | Рыбы (4 вида) | Спрайты рыб под водой | Силуэты 4 цветов под поверхностью, поворот по heading | test_world_dressing | partial | Без виляния хвоста |
| **Управление и UI** | Камера 3D сверху | `client/src/main.ts`, `client/src/render/surface/camera.ts` | `godot/scripts/world/world_view.gd` | tests/game/test_observer_controls.gd, GPU Forward+ | implemented | Фиксированные 52°, WASD/стрелки, плавный зум колесом 4..80, границы фокуса 480x480, лагеря из snapshot; сдвиг мышью не добавлен |
| | Выбор и инспектор жителей | `client/src/main.ts`, `client/src/ui/gameplay.ts` | `world_observer.gd`, query-only Area3D в `network_resident.gd` | tests/game/test_observer_controls.gd + tests/integration/test_observer_ui.gd | implemented | Raycast, кольцо, стабильный ID, роль/занятие/груз, follow/F/Esc, очистка; выбор других типов объектов ещё не реализован |
| | Рисование зон | `paintZone`, `eraseZone` | Проекция луча на землю (Raycast) | Сетка 4x4 клетки | Planned (M3) | Harvest / Forbid |
| | Строительство | `placeBuilding`, `paintWall`, `placeGate` | Полупрозрачный 3D-предпросмотр | Валидация фундамента и цены | Planned (M3) | Запрет на воде и препятствиях |
| | Панели HUD | HTML/Canvas оверлеи | `godot/scripts/game/world_observer.gd`, Control / CanvasLayer | Observer controls + live observer integration | partial | Подключение, население, скорость и инспектор жителя; склады, задачи партии, тревога и игровые команды ещё не реализованы |
| | Смена племени | `takeControl` (colony 0 / 1) | Кнопка переключения племени | Обновление управляемой колонии | Planned (M3) | Поддержка хотсита A/B |
| | Технический офсет-редактор | `editor.ts` (сдвиг 2D спрайтов) | Не требуется в 3D | — | Excluded | Технический долг PixiJS |
