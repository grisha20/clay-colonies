let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

/**
 * Инициализирует аудиоконтекст и мастер-канал громкости.
 * Вызывается при первом взаимодействии пользователя с экраном (клик, нажатие клавиши).
 */
export function initAudio(): void {
  if (audioCtx) {
    return;
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  try {
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    // Громкость по умолчанию: приятные 20%
    masterGain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    // Добавляем обработчики для возобновления заблокированного браузером контекста
    const resume = (): void => {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch((e) => console.warn("Failed to resume AudioContext:", e));
      }
    };

    document.addEventListener("click", resume, { once: false });
    document.addEventListener("keydown", resume, { once: false });
  } catch (err) {
    console.warn("Failed to initialize Web Audio API:", err);
  }
}

/**
 * Генерирует буфер белого шума для создания эффектов треска, шлепков и ударов.
 */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) {
    return noiseBuffer;
  }
  const bufferSize = ctx.sampleRate * 1.0; // 1 секунда шума
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return noiseBuffer;
}

/**
 * Проигрывает процедурный пространственный звук добычи ресурса.
 * 
 * @param worldX Координата X источника звука на карте (в тайлах)
 * @param worldY Координата Y источника звука на карте (в тайлах)
 * @param kind Тип добываемого ресурса
 * @param camera Параметры камеры (центр и зум)
 * @param viewportWidth Ширина экрана в пикселях
 * @param viewportHeight Высота экрана в пикселях
 */
export function playHarvestSound(
  worldX: number,
  worldY: number,
  kind: "clay" | "wood" | "stone" | "food",
  camera: { x: number; y: number; zoom: number },
  viewportWidth: number,
  viewportHeight: number
): void {
  // Ленивая инициализация контекста
  initAudio();

  if (!audioCtx || !masterGain) {
    return;
  }

  // Расстояние от источника звука до центра экрана (в игровых тайлах)
  const distX = worldX - camera.x;
  const distY = worldY - camera.y;
  const dist = Math.hypot(distX, distY);

  // Максимальный радиус слышимости звуков в тайлах
  const maxRadius = 35;
  if (dist >= maxRadius) {
    return;
  }

  // Расчет затухания по расстоянию (линейное спадание)
  let volume = Math.max(0, 1 - dist / maxRadius);

  // Влияние зума: при приближении звуки громче, при отдалении — тише
  const zoomFactor = Math.min(1.5, Math.max(0.25, camera.zoom));
  volume *= zoomFactor;

  // Ограничиваем громкость
  volume = Math.max(0, Math.min(1, volume));

  // Оптимизация: если звук слишком тихий, не создаем ноды
  if (volume <= 0.01) {
    return;
  }

  // Расчет стереопанорамы (-1 лево, 1 право)
  const tilePixelSize = 8;
  const halfWidthInTiles = (viewportWidth / 2) / tilePixelSize / camera.zoom;
  const pan = Math.max(-1, Math.min(1, distX / Math.max(8, halfWidthInTiles)));

  const now = audioCtx.currentTime;

  // Создаем ноды громкости и панорамирования для данного звука
  const localGain = audioCtx.createGain();
  localGain.gain.setValueAtTime(volume, now);
  localGain.connect(masterGain);

  let panner: StereoPannerNode | null = null;
  if (audioCtx.createStereoPanner) {
    panner = audioCtx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(localGain);
  }

  const destinationNode: AudioNode = panner ? panner : localGain;

  // Процедурный синтез в зависимости от типа ресурса
  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer(audioCtx);

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0, now);

  const noiseFilter = audioCtx.createBiquadFilter();

  if (kind === "stone") {
    // 1. КАМЕНЬ: звонкий металлический клик кирки
    // Фильтруем шум для клика
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1600, now);
    noiseFilter.Q.setValueAtTime(4, now);

    noiseGain.gain.setValueAtTime(0.22, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

    // Основной осциллятор удара (треугольная волна с быстрым спадом по частоте)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(1000, now);
    osc1.frequency.exponentialRampToValueAtTime(650, now + 0.08);

    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    // Высокочастотный металлический отзвук (синусоида)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(2400, now);

    gain2.gain.setValueAtTime(0.08, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    // Коммутация
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destinationNode);

    osc1.connect(gain1);
    gain1.connect(destinationNode);

    osc2.connect(gain2);
    gain2.connect(destinationNode);

    // Запуск воспроизведения
    noise.start(now);
    noise.stop(now + 0.02);
    osc1.start(now);
    osc1.stop(now + 0.12);
    osc2.start(now);
    osc2.stop(now + 0.06);

  } else if (kind === "wood") {
    // 2. ДЕРЕВО: плотный удар топора + трещина щепы
    // Шум для хруста волокон — ярче, слышнее
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2200, now);
    noiseFilter.Q.setValueAtTime(1.5, now);

    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    // Основной удар (треугольная волна, ярче)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.07);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    // Высокочастотная трещина (щелчок лопнувшего волокна)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = "square";
    osc2.frequency.setValueAtTime(1800, now);
    osc2.frequency.exponentialRampToValueAtTime(600, now + 0.03);

    gain2.gain.setValueAtTime(0.1, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    // Коммутация
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destinationNode);

    osc.connect(gain);
    gain.connect(destinationNode);

    osc2.connect(gain2);
    gain2.connect(destinationNode);

    // Запуск воспроизведения
    noise.start(now);
    noise.stop(now + 0.07);
    osc.start(now);
    osc.stop(now + 0.14);
    osc2.start(now);
    osc2.stop(now + 0.05);

  } else if (kind === "clay") {
    // 3. ГЛИНА: сочный влажный шлепок с «чавканьем»
    // Шум — среднечастотный, имитирует влажный контакт
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(800, now);
    noiseFilter.Q.setValueAtTime(1.2, now);

    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    // Основной шлепок — начинаем выше, чтобы было слышно
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.linearRampToValueAtTime(90, now + 0.06);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    // Верхний «чавк» — короткий яркий щелчок
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(600, now);
    osc2.frequency.exponentialRampToValueAtTime(200, now + 0.04);

    gain2.gain.setValueAtTime(0.15, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    // Коммутация
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destinationNode);

    osc.connect(gain);
    gain.connect(destinationNode);

    osc2.connect(gain2);
    gain2.connect(destinationNode);

    // Запуск воспроизведения
    noise.start(now);
    noise.stop(now + 0.1);
    osc.start(now);
    osc.stop(now + 0.12);
    osc2.start(now);
    osc2.stop(now + 0.06);

  } else {
    // 4. ЕДА (ягоды / томаты): звонкий поп/щелчок + шелест ветки
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(1800, now);

    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.045);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    // Коммутация
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destinationNode);

    osc.connect(gain);
    gain.connect(destinationNode);

    // Запуск воспроизведения
    noise.start(now);
    noise.stop(now + 0.035);
    osc.start(now);
    osc.stop(now + 0.06);
  }
}
