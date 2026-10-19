# Инструкция по настройке и запуску Godot-клиента Clayfolk

## 1. Зафиксированное окружение

- **ОС**: Windows 11 Pro x64
- **ЦП**: AMD Ryzen 5 5600X (6 ядер, 12 потоков)
- **ОЗУ**: 32 ГБ
- **ГП**: NVIDIA GeForce RTX 4070 (12 ГБ VRAM, драйвер 572.x)
- **Godot Engine**: `4.7.2.stable.official.ed1daf0bf` (`godot_console` / `godot`)
- **Godot Renderer**: `Forward+` (Vulkan)
- **Blender**: `4.2.3 LTS` (`blender`)
- **Node.js**: `v24.17.0`, `npm 11.13.0`
- **Python**: `3.11.6` (запуск через `py`)
- **FFmpeg**: `C:\ffmpeg\bin\ffmpeg.exe`

## 2. Структура проекта

```text
godot/                  # Проект Godot 4 (project.godot, scenes, scripts, assets)
art/blender/            # Исходные модели Blender (.blend) и скрипты генерации/экспорта
scripts/godot/          # Скрипты изолированного QA-сервера, тестов и экспорта
docs/godot/             # Документация миграции (паритет, приёмка, нагрузка, ассеты)
tmp/qa/                 # Изолированная директория состояния QA-сервера (в .gitignore)
```

## 3. Запуск изолированного QA-сервера

Чтобы не повредить основную партию игрока (`snapshot.json`) и файлы обучения (`genome*.json`, `spider_genome.json`), QA-сервер запускается на выделенном порту `8788` с изолированным хранилищем:

```powershell
# Запуск чистого QA-сервера на порту 8788
py scripts/godot/qa_server.py --port 8788 --reset

# Запуск с существующим QA-сохранением
py scripts/godot/qa_server.py --port 8788
```

## 4. Запуск Godot-клиента

### Режим разработки (Godot Editor)

1. Открыть Godot Engine: `godot -e --path godot`
2. Открыть проект в папке `godot/`
3. Запустить главную сцену (F5) или тестовую лабораторию (F6)

### Запуск из командной строки

```powershell
# Интерактивный запуск визуальной лаборатории персонажа (M1.1)
godot --path godot scenes/lab/resident_lab.tscn

# Автоматический визуальный тур со сменой ракурсов и скоростей (41 сек)
godot --path godot scenes/lab/resident_lab.tscn --tour

# Автоматический приёмочный тест опоры стоп (Normal PASS + Negative Test FAIL)
godot_console --headless --path godot scenes/lab/resident_lab.tscn --test-grounding

# Запуск набора тестов безопасности QA-сервера
py scripts/godot/test_qa_server.py
```

### Управление в визуальной лаборатории

| Клавиша | Назначение |
|---|---|
| `1` .. `6` | Переключение анимаций: Idle (1), Walk In-Place (2), Walk Move (3), Carry Idle (4), Carry Walk (5), Work/Gather (6) |
| `Q`, `W`, `E` | Скорость воспроизведения: `0.25x` (замедленный шаг для проверки стоп), `1.0x` (норма), `5.0x` (ускорение) |
| `A`, `S`, `D`, `F`, `G` | Ракурсы камеры относительно персонажа: Front (A), Right Profile (S), Back (D), Left Profile (F), Game View 58° (G) |
| `Space` | Пауза / возобновление для детального осмотра контакта стопы с грунтом |
| `T` | Негативный тест: искусственный рассинхрон скорости (2.2x), проверка индикации `[FAIL]` |
| `N` | Переключение День / Ночь (солнечный свет vs динамическое пламя и тлеющие угли костра) |

### Headless-проверка проекта

```powershell
godot_console --headless --path godot --quit
```

## 5. Пайплайн 3D-ассетов

1. Исходные 3D-модели создаются и редактируются в Blender (`art/blender/`).
2. Экспорт выполняется в формат `.glb` (glTF 2.0 Binary) в папку `godot/assets/models/`.
3. Все скелетные анимации запекаются в glTF-клипы с сохранением корневой точки контакта стоп с землёй.
