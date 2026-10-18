import type { Vec2, WorldSnapshot } from "../../../shared/types";
import { dayCycle } from "../../../shared/dayCycle";

export function createGameplayPanel(root: HTMLElement, actions: {
  send: (command: Record<string, unknown>) => void;
  getColony: () => number;
  choosePost: () => void;
  focus: (pos: Vec2) => void;
}) {
  const style = document.createElement("style");
  style.textContent = `
    .gameplayPanel{position:absolute;top:72px;left:50%;transform:translateX(-50%);width:380px;max-width:calc(100vw - 620px);min-width:240px;z-index:32;padding:10px 14px;font-size:12px}
    .gameplayPanel summary{cursor:pointer;font-weight:700;line-height:1.6}.gameplayPanel[open] summary{margin-bottom:8px}
    .gameplayControls{display:grid;grid-template-columns:1fr 1fr;gap:6px}.gameplayControls button,.gameplayControls label{font:inherit;padding:7px;border:1px solid #8a6a4460;border-radius:6px;background:#f8edcb;color:#523921;text-align:center}
    .gameplayControls button{cursor:pointer}.gameplayControls button:disabled{opacity:.55;cursor:default}.gameplayControls .alarmOn{background:#a43e28;color:#fff4d4}
    .gameplayControls small{grid-column:1/-1;line-height:1.5}.gameplayControls input{width:45px}.gameplayControls .wide{grid-column:1/-1}
    .gameEvents{margin-top:8px;border-top:1px solid #8a6a4433;padding-top:6px}.gameEvents button{display:block;border:0;background:none;color:#674525;text-align:left;font:inherit;cursor:pointer;margin:5px 0;line-height:1.4}
    .sessionOutcome{position:absolute;inset:0;z-index:60;background:#162128a6;display:grid;place-items:center}.sessionOutcome[hidden]{display:none}.sessionOutcome article{max-width:440px;padding:28px;background:#f5e5bf;border:2px solid #87613e;border-radius:14px;color:#4c3321;box-shadow:0 12px 60px #0007}.sessionOutcome h2{font-size:28px;margin:0 0 12px}.sessionOutcome button{padding:12px 18px;font:inherit;border:1px solid #8a6a44;border-radius:7px;background:#e6c482;cursor:pointer}
    @media(max-width:1000px){.gameplayPanel{left:auto;right:14px;top:120px;transform:none;width:250px;max-width:calc(100vw - 28px)}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement("details");
  panel.className = "panel gameplayPanel";
  panel.innerHTML = `<summary><span data-status>Поселение</span> · Оборона ▾</summary>
    <div class="gameplayControls">
      <button data-action="alarm">Тревога</button><button data-action="post">Задать пост</button>
      <button data-action="growth">Приостановить рост</button><label>Запас глины <input aria-label="Неприкосновенный запас глины" type="number" min="0" max="100" step="1" value="0"></label>
      <button class="wide" data-action="train">Обучить водомётов: 6 дерева + 4 камня</button>
      <small data-training></small><button class="wide" data-action="sandbox">Включить песочницу</button>
      <small>Пост держит назначенная стража. Во время тревоги рабочие возвращаются к костру. Клик по событию переносит камеру.</small>
      <small data-lakes></small>
    </div><div class="gameEvents"></div>`;
  root.appendChild(panel);
  const overlay = document.createElement("div");
  overlay.className = "sessionOutcome";
  overlay.hidden = true;
  overlay.innerHTML = `<article><h2></h2><p data-reason></p><p data-stats></p><button>Новая партия</button></article>`;
  root.appendChild(overlay);
  let current: WorldSnapshot | undefined;
  let eventsKey = "";
  const button = (key: string) => panel.querySelector<HTMLButtonElement>(`[data-action="${key}"]`)!;
  const reserve = panel.querySelector<HTMLInputElement>("input")!;
  const sendGrowth = () => {
    const colony = current?.colonies[actions.getColony()]?.colony;
    if (colony) actions.send({ type: "setGrowth", colony: actions.getColony(), paused: !!colony.growthPaused, reserve: Number(reserve.value) });
  };
  reserve.addEventListener("change", sendGrowth);
  button("alarm").onclick = () => actions.send({ type: "setAlarm", colony: actions.getColony(), value: !current?.colonies[actions.getColony()]?.colony.alarm });
  button("post").onclick = () => { actions.choosePost(); panel.open = false; };
  button("growth").onclick = () => actions.send({ type: "setGrowth", colony: actions.getColony(), paused: !current?.colonies[actions.getColony()]?.colony.growthPaused, reserve: Number(reserve.value) });
  button("train").onclick = () => actions.send({ type: "trainWaterWeapons", colony: actions.getColony() });
  button("sandbox").onclick = () => actions.send({ type: "setSandbox", colony: actions.getColony(), value: current?.session.mode !== "sandbox" });
  overlay.querySelector("button")!.onclick = () => actions.send({ type: "newGame" });

  return { update(world: WorldSnapshot) {
    current = world;
    const c = world.colonies[actions.getColony()]?.colony ?? world.colony;
    const s = world.session;
    const time = dayCycle(world.tick);
    const phase = { day: "День", dusk: "Сумерки", night: "Ночь", dawn: "Рассвет" }[time.phase];
    const raid = s.raid;
    const seconds = Math.max(0, Math.ceil(((raid.phase === "attack" ? raid.until : raid.at) - world.tick) / 10));
    const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    panel.querySelector("[data-status]")!.textContent = `${phase} ${time.day} · ${raid.phase === "attack" ? "Набег!" : raid.phase === "warning" ? "Паук через" : "До набега"} ${countdown}`;
    button("alarm").textContent = c.alarm ? "Отменить тревогу" : "Тревога — все домой";
    button("alarm").classList.toggle("alarmOn", !!c.alarm);
    button("growth").textContent = c.growthPaused ? "Возобновить рост" : "Приостановить рост";
    if (document.activeElement !== reserve) reserve.value = String(c.clayReserve ?? 0);
    const workshop = world.surface.buildings.some(b => b.colonyId === c.id && b.type === "workshop" && b.stage === "built");
    button("train").disabled = !!c.waterWeapons || !workshop || c.wood < 6 || c.stone < 4;
    button("train").textContent = c.waterWeapons ? "Водомёты обучены" : "Обучить водомётов: 6 дерева + 4 камня";
    panel.querySelector("[data-training]")!.textContent = c.waterWeapons ? "Стража держится у поста, стреляет водой и пополняет ёмкости на берегу озера." : !workshop ? "Для обучения нужна достроенная мастерская." : "Обучение меняет оружие стражи. Новые жители тоже проходят обучение.";
    button("sandbox").textContent = s.mode === "sandbox" ? "Вернуться к партии" : "Песочница: еда и тестовый водомёт";
    panel.querySelector("[data-lakes]")!.textContent = `Озёра · поглощено жителей: север ${s.lakes.north.swallowed}, юг ${s.lakes.south.swallowed}. Каждые 2 жертвы — ещё один монстр (до 4 на озеро).`;
    const foodButton = root.querySelector<HTMLButtonElement>('[data-tool="food"]');
    if (foodButton) foodButton.hidden = s.mode !== "sandbox";
    const key = s.events.map(e => e.tick + e.text).join("|");
    if (key !== eventsKey) {
      eventsKey = key;
      const log = panel.querySelector(".gameEvents")!;
      log.replaceChildren();
      for (const event of s.events.slice(-3).reverse()) {
        const row = document.createElement("button");
        row.textContent = event.text;
        row.onclick = () => { if (event.pos) actions.focus(event.pos); };
        log.appendChild(row);
      }
    }
    overlay.hidden = s.status === "playing";
    if (!overlay.hidden) {
      overlay.querySelector("h2")!.textContent = s.status === "victory" ? "Племя выстояло!" : "Поселение погибло";
      overlay.querySelector("[data-reason]")!.textContent = s.reason;
      overlay.querySelector("[data-stats]")!.textContent = `Время: ${Math.floor((s.endedAt ?? world.tick) / 600)} мин. Родилось: ${s.stats.born}. Потеряно: ${s.stats.lost}. Спасено: ${s.stats.rescued}. Набегов пережито: ${s.stats.raidsSurvived}.`;
    }
  }};
}
