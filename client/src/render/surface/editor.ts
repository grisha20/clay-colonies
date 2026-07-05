export const offsetSettings = {
  "spear": {
    "offsetX": 4,
    "offsetY": 8.9,
    "anchorX": 0.5,
    "anchorY": 0.9,
    "scale": 1.1,
    "rotation": 0.35
  },
  "swing": {
    "swingSpeed": 0.16,
    "swingAmpY": 1.2,
    "swingAmpRot": 0.08
  },
  "food": {
    "offsetX": 1,
    "offsetY": 2.5,
    "scale": 1.25
  },
  "clay": {
    "offsetX": 1,
    "offsetY": 2.5,
    "scale": 2.2
  },
  "wood": {
    "offsetX": 1,
    "offsetY": 2.5,
    "scale": 2.2
  },
  "stone": {
    "offsetX": 1,
    "offsetY": 2.5,
    "scale": 2.2
  },
  "pebble": {
    "offsetDist": 5.6,
    "scale": 0.9
  },
  "leaf": {
    "offsetDist": 5.6,
    "scale": 1.25
  },
  "chiefs": {
    "leftX": -30,
    "leftY": -8,
    "leftScale": 2.15,
    "rightX": 33,
    "rightY": -7,
    "rightScale": 2.05
  },
  "campPiles": {
    "foodScale": 1,
    "clayScale": 1,
    "stoneScale": 1,
    "woodScale": 1
  },
  "fireGlow": {
    "innerRadius": 3.9,
    "innerAlpha": 0.18,
    "outerRadius": 18.9,
    "outerAlpha": 0.01,
    "pulseSpeed": 0.11,
    "pulseAmp": 0.03
  },
  "buildingGeometry": {
    "wallRise": 2.6,
    "roofRise": 1.6,
    "hutRadius": 4
  }
};

// Загружаем сохраненные локально настройки из localStorage, если они есть
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("clayfolk_offsets");
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.keys(parsed).forEach(key => {
        if ((offsetSettings as any)[key] && parsed[key]) {
          Object.assign((offsetSettings as any)[key], parsed[key]);
        }
      });
    }
  } catch (e) {
    console.warn("[EDITOR] Не удалось загрузить настройки из localStorage", e);
  }
}

// Инициализируем визуальный редактор, если передан параметр ?editor=1
if (typeof window !== "undefined" && window.location.search.includes("editor=1")) {
  initOffsetEditor();
}

function initOffsetEditor() {
  const style = document.createElement("style");
  style.textContent = `
    .offset-editor {
      position: fixed;
      top: 16px;
      left: 16px;
      width: 340px;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      background: rgba(30, 24, 20, 0.94);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(239, 154, 100, 0.4);
      border-radius: 12px;
      color: #f4ead4;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      z-index: 10000;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
      scrollbar-width: thin;
      scrollbar-color: rgba(239, 154, 100, 0.4) rgba(0,0,0,0);
    }
    .offset-editor::-webkit-scrollbar {
      width: 6px;
    }
    .offset-editor::-webkit-scrollbar-thumb {
      background-color: rgba(239, 154, 100, 0.4);
      border-radius: 3px;
    }
    .offset-editor h3 {
      margin-top: 0;
      color: #ef9a64;
      border-bottom: 1px solid rgba(239, 154, 100, 0.2);
      padding-bottom: 10px;
      font-size: 17px;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .offset-editor select {
      width: 100%;
      background: #2b211e;
      border: 1px solid rgba(239, 154, 100, 0.3);
      color: #f4ead4;
      padding: 8px 10px;
      border-radius: 6px;
      margin-bottom: 16px;
      box-sizing: border-box;
      font-size: 13px;
    }
    .offset-editor label {
      display: block;
      font-size: 12px;
      color: #d9c89f;
      margin-bottom: 6px;
    }
    .offset-editor input[type="range"] {
      width: 100%;
      margin-bottom: 16px;
      box-sizing: border-box;
    }
    .offset-editor button {
      border: none;
      color: #fff;
      padding: 12px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      font-size: 13px;
      transition: background 0.2s, transform 0.1s;
      width: 100%;
      background: #bc6240;
    }
    .offset-editor button:hover {
      background: #ef9a64;
    }
    .offset-editor button:active {
      transform: scale(0.98);
    }
    .offset-editor .hint {
      font-size: 11px;
      color: #a89f8c;
      margin-top: 14px;
      line-height: 1.4;
      border-top: 1px solid rgba(239, 154, 100, 0.1);
      padding-top: 10px;
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.className = "offset-editor";
  container.innerHTML = `
    <h3>Настройка графики</h3>
    
    <label>Раздел настроек:</label>
    <select id="editor-item-select">
      <option value="spear">🛡️ Копьё (Страж)</option>
      <option value="swing">🏃 Покачивание при ходьбе</option>
      <option value="food">🍅 Томат (Еда в руке)</option>
      <option value="clay">🧱 Ком глины (в руке)</option>
      <option value="wood">🌳 Ветка дерева (в руке)</option>
      <option value="stone">⛰️ Осколок камня (в руке)</option>
      <option value="pebble">⛰️ Камешек под ногами</option>
      <option value="leaf">🌿 Листик под ногами</option>
      <option value="chiefs">👑 Вожди у костра</option>
      <option value="campPiles">📦 Кучи ресурсов у костра</option>
      <option value="fireGlow">🔥 Свечение костра</option>
      <option value="buildingGeometry">🏠 Размеры построек</option>
    </select>

    <div id="editor-sliders"></div>
    
    <button id="editor-save-btn">Сохранить изменения</button>

    <div class="hint">
      💡 Измените ползунки и нажмите <b>«Сохранить изменения»</b>. Новые пропорции сразу запишутся в игру.
    </div>
  `;
  document.body.appendChild(container);

  const select = document.getElementById("editor-item-select") as HTMLSelectElement;
  const slidersContainer = document.getElementById("editor-sliders") as HTMLDivElement;
  const saveBtn = document.getElementById("editor-save-btn") as HTMLButtonElement;

  const labelsMap: Record<string, string> = {
    offsetX: "Смещение X (по горизонтали)",
    offsetY: "Смещение Y (по вертикали)",
    anchorX: "Точка привязки X",
    anchorY: "Точка привязки Y",
    scale: "Размер (масштаб)",
    rotation: "Угол наклона",
    offsetDist: "Дистанция выноса вперед",
    swingSpeed: "Частота (скорость) покачивания",
    swingAmpY: "Амплитуда покачивания по Y",
    swingAmpRot: "Амплитуда наклона при ходьбе",
    leftX: "Смещение вождя A по X",
    leftY: "Смещение вождя A по Y",
    leftScale: "Масштаб вождя A",
    rightX: "Смещение вождя B по X",
    rightY: "Смещение вождя B по Y",
    rightScale: "Масштаб вождя B",
    foodScale: "Масштаб ягод на базе",
    clayScale: "Масштаб глины на базе",
    stoneScale: "Масштаб камней на базе",
    woodScale: "Масштаб поленьев на базе",
    innerRadius: "Радиус яркого центра света",
    innerAlpha: "Ярость центра света",
    outerRadius: "Радиус рассеивания света",
    outerAlpha: "Яркость рассеивания света",
    pulseSpeed: "Скорость мерцания пламени",
    pulseAmp: "Интенсивность мерцания",
    wallRise: "Высота оборонительных стен",
    roofRise: "Высота крыши склада",
    hutRadius: "Радиус круглых хижин"
  };

  function updateSliders() {
    const item = select.value as keyof typeof offsetSettings;
    const config = offsetSettings[item] as any;
    slidersContainer.innerHTML = "";

    Object.keys(config).forEach(key => {
      let min = -15, max = 15, step = 0.1;
      if (key.includes("scale") || key.includes("Scale")) { min = 0.1; max = 5; }
      if (key.includes("anchor")) { min = 0; max = 1; step = 0.05; }
      if (key.includes("rotation")) { min = -Math.PI; max = Math.PI; step = 0.05; }
      if (key.includes("offsetDist")) { min = 0; max = 20; }
      if (key.includes("leftX") || key.includes("rightX")) { min = -80; max = 80; }
      if (key.includes("leftY") || key.includes("rightY")) { min = -40; max = 40; }
      if (key.includes("Radius") || key.includes("radius")) { min = 2; max = 80; }
      if (key.includes("Alpha") || key.includes("alpha")) { min = 0; max = 1; step = 0.01; }
      if (key.includes("pulseSpeed") || key.includes("swingSpeed")) { min = 0.01; max = 1.0; step = 0.01; }
      if (key.includes("pulseAmp") || key.includes("swingAmp")) { min = 0; max = 3; step = 0.05; }

      const labelText = labelsMap[key] || key;

      const row = document.createElement("div");
      row.innerHTML = `
        <label>${labelText}: <span id="val-${key}" style="color: #ef9a64; font-weight: 600;">${config[key]}</span></label>
        <input type="range" id="input-${key}" min="${min}" max="${max}" step="${step}" value="${config[key]}" />
      `;
      slidersContainer.appendChild(row);

      const input = document.getElementById(`input-${key}`) as HTMLInputElement;
      input.addEventListener("input", () => {
        config[key] = parseFloat(input.value);
        document.getElementById(`val-${key}`)!.textContent = input.value;
        // Сохраняем в localStorage при каждом изменении ползунка
        localStorage.setItem("clayfolk_offsets", JSON.stringify(offsetSettings));
      });
    });
  }

  select.addEventListener("change", updateSliders);

  saveBtn.addEventListener("click", () => {
    const socket = (window as any).socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: "saveOffsetSettings",
        settings: offsetSettings
      }));
      const oldText = saveBtn.textContent;
      saveBtn.textContent = "Сохранено!";
      saveBtn.style.background = "#5cb85c"; // Зеленый цвет для успешного сохранения
      setTimeout(() => {
        saveBtn.textContent = oldText;
        saveBtn.style.background = "#bc6240"; // Возвращаем исходный цвет
      }, 1500);
    } else {
      alert("Ошибка: Не удалось связаться с сервером игры!");
    }
  });

  updateSliders();
}
