# Проверка a334f15 — прежние ошибки исправлены, остался overflow при пакетной доставке

20.10.2026. Перед проверкой `git fetch origin`: HEAD и origin совпадали на `a334f15`, дерево чистое. **Все пять нарушений из `9356d65.gd` исправлены и независимо подтверждены. Груз, смену скорости и восстановление по сигналу stall повторно переделывать не требуется. M2 ещё не принят из-за одной оставшейся ветви того же требования bounded recovery: пачки накопленных снимков.**

## Принято

- Числовой груз и carryKind сохраняются после кадров; дискретное состояние следует отображаемому sample A до достижения B. Новые unit-проверки подтверждают сохранение груза на пути и разгрузку в конце для обоих племён.
- Видимость cargo_prop теперь зависит от carrying_amount > 0. Socket_Cargo и модели не менялись.
- При stall recovery и смене скорости rebase явно выполняется при получении снимка. Авторитетная коррекция между кадрами допустима; её дистанция больше не включается в обычный шаг следующего кадра. Pending-флаг переживает вызов on_network_resumed до обработки snapshot.
- `9356d65.gd`: exit 0, failures=0. Ровные 200-пакетные серии на постоянных 1/5/20/50×: min=0.999451, max=1.000214 м/с при синтетическом источнике 1 м/с; максимум 4 samples. Recovery cold/warm и переход 50×→1×: следующий обычный кадр не быстрее 1.000214 м/с, конечная остановка без отката/overshoot.
- 37 unit-сценариев, import, 12 QA, npm check и integration проходят. Навигацию и ранее принятые части не открываем заново.

## Единственный оставшийся дефект: pruning оставляет курсор вне истории

`snapshot_timeline.gd:148–150` ограничивает массив 48 элементами через slice. При этом render_time и current_pos не синхронизируются с новым началом истории. Если курсор ещё находится раньше удалённых samples, следующий обычный advance_and_sample выбирает уже другую A и включает всю пропущенную дистанцию в ground_speed.

Это достижимая форма доставки, а не специальный формат tick: `ws_client.gd:63` за один кадр обрабатывает все доступные пакеты. В `world_observer.gd:269–270` каждый из них вызывает on_network_resumed → update_from_snapshot. После stall первый снимок правильно делает rebase, но остальные снимки той же пачки снова заполняют историю. Отдельная ветвь предыдущего теста подавала один восстановительный снимок, а затем равномерный поток; пачку она не проверяет.

Новая проба `review-repro/a334f15.gd` использует production registry/actors и тот же порядок вызовов observer. Начало: tick100/x100, stall. Затем до следующего кадра приходят N **последовательных** снимков (+1tick, +0.1м на снимок, источник 1 м/с). Первый принятый снимок делает разрешённый rebase в x100.1. Перед кадром нет искусственного изменения cursor/позиции тестом.

| Снимков в пачке | Samples | Отставание перед кадром | Первый обычный кадр | Пик на последующем потоке |
|---|---:|---:|---:|---:|
| 20 | 20 | 1.9 с | 1.14975 м/с | 1.15051 м/с |
| 48 | 48 | 4.7 с | 1.14975 м/с | 8.85010 м/с |
| 60 | 48 | 5.9 с | **120.00046 м/с** | **120.00046 м/с** |

Для 60 снимков: samples[0].server_time=1.2, render_time=0; позиция до кадра x100.1, после 10 мс x101.3. Шаг **1.200005 м**, animation speed_scale=8. Для 48 снимков скачок откладывается до дальнейшей вставки/pruning. После двух секунд обычного потока остаются соответственно 1.5885/4.3885/5.5885 с истории. Память ограничена; это не доказательство ограниченной задержки и безопасного отбрасывания старой истории.

Проба синтетически подаёт готовые снимки, не создаёт сетевую задержку на настоящем сервере и не является FPS/GPU-тестом. Поведение цикла обработки WebSocket и observer проверено по коду. Возвращается **exit 1, A334_FAILED_CASES=2**: один дефект воспроизведён на пачках 48 и 60; пачка 20 не создаёт всплеска. Допустим отдельный явный reset/rebase при приёме снимка, как уже принято в текущем исправлении; нельзя превращать overflow-коррекцию в обычный шаг `_process()`.

## Независимая проверка

```powershell
godot_console --headless --path godot --editor --import
godot_console --headless --path godot --script tests/world/test_network_interpolation.gd
godot_console --headless --path godot --script tests/world/test_surface_navigation.gd
godot_console --headless --path godot --script tests/net/test_packet_decoder.gd
godot_console --headless --path godot --script tests/world/test_entity_registry.gd
godot_console --headless --path godot --script tests/world/test_surface_terrain.gd
py -B scripts/godot/test_qa_server.py
py -B scripts/godot/test_m2_network_integration.py
npm.cmd run check
godot_console --headless --path godot --script F:/GitHub/Clayfolk/docs/godot/review-repro/9356d65.gd
godot_console --headless --path godot --script F:/GitHub/Clayfolk/docs/godot/review-repro/b0ae820.gd
godot_console --headless --path godot --script F:/GitHub/Clayfolk/docs/godot/review-repro/ea54b49.gd
godot_console --headless --path godot --script F:/GitHub/Clayfolk/docs/godot/review-repro/a334f15.gd
```

Import и unit (10 interpolation + 9 navigation + 10 decoder + 4 registry + 4 terrain), 12 QA, npm check, integration — exit 0. Ожидаемая ошибка malformed JSON отрицательного decoder-теста не означает отказ runner. В integration два настоящих Godot-клиента (новая партия и fixture), затем третий запуск Node-сервера из сохранения. Fixture tick12347, saved/resumed tick12365; cargo C1=1/C2=1 после кадров. Это не три запуска Godot.

QA — собственные tmp/qa/integration_fresh и integration_fixture, все четыре пути состояния явно задаёт qa_server.py. Порты 8788/8789 проверены свободными до запуска и после остановки. Команды в пользовательскую партию не отправлялись, производственные исходники Codex не менял.

`b0ae820.gd` и `ea54b49.gd` — только print-диагностики, не assert-runner. Они подтверждают правильные длительности tick10/11/20, груз и прежние положительные обходы (дом 0/120 попаданий в фундамент, стена, берег), остановку без отката. Первый 160-мс jitter-интервал всё ещё содержит 60 мс остановки; после адаптации цикл плавный. Историческую смешанную jitter-часть 44f2939 не использовали. GPU, художественное одобрение и FPS в этом аудите не проверялись.

Продолжение — только [обработка переполнения очереди](<../Antigravity — два исправления после b0ae820.md>). До её проверки M3 не начинать.
