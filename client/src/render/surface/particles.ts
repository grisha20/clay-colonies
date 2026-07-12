import { Graphics } from "pixi.js";
import { resourceNodeYield, type WorldSnapshot } from "../../../../shared/types";
import { playHarvestSound } from "./audio";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  alpha: number;
  size: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  shape: "circle" | "rect" | "line" | "triangle";
  rotation?: number;
  vRot?: number;
  width?: number; // для линий/щепок
}

let activeParticles: Particle[] = [];

// Храним последнее известное количество ударов для каждого муравья (чтобы ловить момент удара)
const lastKnownHarvestHits = new Map<string, number>();
// Храним последнее известное количество еды, которую несёт фуражир (чтобы ловить момент подбора)
const lastKnownForagerCarry = new Map<string, number>();

export function clearParticles(): void {
  activeParticles = [];
  lastKnownHarvestHits.clear();
  lastKnownForagerCarry.clear();
}

/**
 * Спавнит взрыв частиц заданного типа ресурса
 */
function spawnBurst(
  x: number,
  y: number,
  kind: "clay" | "wood" | "stone" | "food",
  count: number
): void {
  for (let i = 0; i < count; i++) {
    // Направление разлета: во все стороны с уклоном вверх
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.2;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed * 0.7 - (1.2 + Math.random() * 1.8); // Дополнительный импульс вверх

    let colorPalette: number[] = [];
    let shape: "circle" | "rect" | "line" | "triangle" = "circle";
    let size = 1.0 + Math.random() * 1.5;
    let gravity = 0.14;
    let drag = 0.95;
    let maxLife = 12 + Math.floor(Math.random() * 16);
    let rotation = Math.random() * Math.PI * 2;
    let vRot = (Math.random() - 0.5) * 0.25;
    let width: number | undefined = undefined;

    if (kind === "clay") {
      // Глина: оранжевые, терракотовые, рыжие оттенки
      colorPalette = [0xe76f34, 0xc84f2a, 0xf08a4f, 0xd35400, 0xe67e22, 0xd0562b];
      // Осколки глины округлые или квадратные
      shape = Math.random() < 0.65 ? "rect" : "circle";
      size = 1.2 + Math.random() * 2.0;
      gravity = 0.16;
      drag = 0.94;
    } else if (kind === "wood") {
      // Дерево: коричневые щепки или зеленые листики (с кроны)
      const isLeaf = Math.random() < 0.2; // 20% шанс спавна листика
      if (isLeaf) {
        colorPalette = [0x2ecc71, 0x27ae60, 0x78d46a, 0x5fa44f];
        shape = "circle";
        size = 1.0 + Math.random() * 1.5;
        gravity = 0.06; // Листья падают медленнее
        drag = 0.91;   // И испытывают большее сопротивление воздуха
        maxLife = 18 + Math.floor(Math.random() * 18);
      } else {
        colorPalette = [0xe8c18a, 0xb87d4b, 0x8b5a2b, 0xd2b48c, 0xc69c6d];
        shape = "line"; // Щепки в виде отрезков
        size = 1.0 + Math.random() * 0.8; // Толщина линии
        width = 4.0 + Math.random() * 4.0; // Длина линии
        gravity = 0.11;
        drag = 0.96;
      }
    } else if (kind === "stone") {
      // Камень: серые, бурые, пыльные оттенки
      colorPalette = [0xc8c4b8, 0xd8d5c8, 0xb7b3a9, 0x95a5a6, 0x7f8c8d, 0x616a6b];
      // Угловатые тяжелые треугольники или квадраты
      shape = Math.random() < 0.6 ? "triangle" : "rect";
      size = 1.2 + Math.random() * 2.4;
      gravity = 0.22; // Камни падают быстрее всего
      drag = 0.93;
    } else {
      // Еда / ягоды: капли сока, мякоть, листочки
      const isLeaf = Math.random() < 0.15;
      if (isLeaf) {
        colorPalette = [0x27ae60, 0x2ecc71, 0x6ab04c, 0x78e08f];
        shape = "circle";
        size = 0.8 + Math.random() * 1.2;
        gravity = 0.05;
        drag = 0.90;
        maxLife = 20 + Math.floor(Math.random() * 18);
      } else {
        colorPalette = [0xe74c3c, 0xc0392b, 0xff6b6b, 0xff8787, 0xf39c12, 0xe67e22, 0xd35400];
        shape = "circle";
        size = 0.8 + Math.random() * 1.8;
        gravity = 0.09;
        drag = 0.93;
        maxLife = 14 + Math.floor(Math.random() * 12);
      }
    }

    const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];

    activeParticles.push({
      x,
      y,
      vx,
      vy,
      color,
      alpha: 0.9 + Math.random() * 0.1,
      size,
      life: maxLife,
      maxLife,
      gravity,
      drag,
      shape,
      rotation,
      vRot,
      width
    });
  }
}

/**
 * Основной метод обновления физики и отрисовки частиц в Graphics контейнере.
 */
export function updateAndDrawParticles(
  graphics: Graphics,
  world: WorldSnapshot,
  cell: number,
  camera: { x: number; y: number; zoom: number },
  viewportWidth: number,
  viewportHeight: number
): void {
  graphics.clear();

  const currentHarvesters = new Set<string>();

  // 1. Проверяем добывающих жителей и спавним частицы при ударах
  for (const ant of world.ants) {
    if (ant.layer !== "surface") {
      continue;
    }

    if (ant.job === "harvest" && ant.carrying <= 0) {
      currentHarvesters.add(ant.id);

      // Находим узел ресурса, который добывает житель
      const node = world.surface.resourceNodes?.find((n) => n.id === ant.harvestNodeId);

      // Нет узла — нет частиц. Житель может идти к узлу или узел уже исчерпан.
      if (!node) {
        // Запоминаем текущее состояние, чтобы не сбить счётчик
        if (!lastKnownHarvestHits.has(ant.id)) {
          lastKnownHarvestHits.set(ant.id, ant.harvestHits ?? 0);
        }
        continue;
      }

      const yieldKind = resourceNodeYield(node.kind);
      const currentHits = ant.harvestHits ?? 0;

      // Первая встреча с этим добытчиком — запоминаем без спавна,
      // чтобы не создавать ложный взрыв частиц из-за уже накопленных ударов.
      if (!lastKnownHarvestHits.has(ant.id)) {
        lastKnownHarvestHits.set(ant.id, currentHits);
        continue;
      }

      const lastHits = lastKnownHarvestHits.get(ant.id)!;
      lastKnownHarvestHits.set(ant.id, currentHits);

      // Рассчитываем координаты контакта для спавна частиц
      // Спавним на линии между жителем и узлом, ближе к узлу (коэффициент 0.6)
      const t = 0.6;
      const spawnX = (ant.pos.x * (1 - t) + node.pos.x * t) * cell;
      // Поднимаем по Y на уровень рук/замаха (чуть выше уровня ног)
      const spawnY = (ant.pos.y * (1 - t) + node.pos.y * t) * cell - 12;

      // Если количество ударов изменилось (был совершен удар), спавним взрыв частиц и играем звук
      if (currentHits !== lastHits && currentHits > 0) {
        spawnBurst(spawnX, spawnY, yieldKind, 5 + Math.floor(Math.random() * 4));
        playHarvestSound(ant.pos.x, ant.pos.y, yieldKind, camera, viewportWidth, viewportHeight);
      }

      // С небольшой вероятностью спавним одиночную частицу/пыль в каждом кадре добычи
      if (currentHits > 0 && Math.random() < 0.12) {
        spawnBurst(spawnX, spawnY, yieldKind, 1);
      }
    }
  }

  // 1b. Проверяем фуражиров — спавним частицы при подборе еды
  const currentForagers = new Set<string>();
  for (const ant of world.ants) {
    if (ant.layer !== "surface") continue;

    // Отслеживаем всех фуражиров, чтобы поймать момент 0 → >0
    if (ant.job === "forage") {
      currentForagers.add(ant.id);

      const currentCarry = ant.carrying;
      const lastCarry = lastKnownForagerCarry.get(ant.id);

      // Записываем текущее значение
      lastKnownForagerCarry.set(ant.id, currentCarry);

      // Первая встреча — просто запоминаем
      if (lastCarry === undefined) {
        continue;
      }

      // Подобрал еду: carrying выросло
      if (currentCarry > lastCarry && currentCarry > 0) {
        // Находим ближайший источник еды для точки спавна
        const allFood = [
          ...(world.surface.foodSources ?? []),
          ...(world.surface.carrion ?? [])
        ];

        let bestDist = Infinity;
        let foodPos = ant.pos;
        for (const fs of allFood) {
          const d = Math.hypot(fs.pos.x - ant.pos.x, fs.pos.y - ant.pos.y);
          if (d < bestDist) {
            bestDist = d;
            foodPos = fs.pos;
          }
        }

        // Спавним между муравьём и источником еды
        const t = 0.5;
        const spawnX = (ant.pos.x * (1 - t) + foodPos.x * t) * cell;
        const spawnY = (ant.pos.y * (1 - t) + foodPos.y * t) * cell - 8;

        spawnBurst(spawnX, spawnY, "food", 3 + Math.floor(Math.random() * 3));
        playHarvestSound(ant.pos.x, ant.pos.y, "food", camera, viewportWidth, viewportHeight);
      }
    }
  }

  // Чистим кэш ударов для тех, кто перестал добывать
  for (const id of lastKnownHarvestHits.keys()) {
    if (!currentHarvesters.has(id)) {
      lastKnownHarvestHits.delete(id);
    }
  }

  // Чистим кэш фуражиров для тех, кто перестал нести еду
  for (const id of lastKnownForagerCarry.keys()) {
    if (!currentForagers.has(id)) {
      lastKnownForagerCarry.delete(id);
    }
  }

  // 2. Обновляем физику и отрисовываем активные частицы
  const nextParticles: Particle[] = [];

  for (const p of activeParticles) {
    p.life -= 1;
    if (p.life <= 0) {
      continue;
    }

    // Физика движения
    p.x += p.vx;
    p.y += p.vy;

    // Гравитация
    p.vy += p.gravity;

    // Сопротивление среды (drag)
    p.vx *= p.drag;
    p.vy *= p.drag;

    if (p.rotation !== undefined && p.vRot !== undefined) {
      p.rotation += p.vRot;
    }

    // Процент оставшейся жизни для плавного исчезновения в конце
    const lifeRatio = p.life / p.maxLife;
    const currentAlpha = p.alpha * (lifeRatio < 0.35 ? lifeRatio / 0.35 : 1);

    const color = p.color;

    // Рисование в соответствии с формой
    if (p.shape === "circle") {
      graphics.circle(p.x, p.y, p.size).fill({ color, alpha: currentAlpha });
    } else if (p.shape === "rect") {
      graphics.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size).fill({ color, alpha: currentAlpha });
    } else if (p.shape === "line") {
      const len = p.width ?? 4;
      const rot = p.rotation ?? 0;
      const dx = Math.cos(rot) * len;
      const dy = Math.sin(rot) * len;
      graphics
        .moveTo(p.x - dx / 2, p.y - dy / 2)
        .lineTo(p.x + dx / 2, p.y + dy / 2)
        .stroke({ color, width: p.size, alpha: currentAlpha });
    } else if (p.shape === "triangle") {
      const rot = p.rotation ?? 0;
      const sz = p.size;
      const x1 = p.x + Math.cos(rot) * sz;
      const y1 = p.y + Math.sin(rot) * sz;
      const x2 = p.x + Math.cos(rot + (2 * Math.PI) / 3) * sz;
      const y2 = p.y + Math.sin(rot + (2 * Math.PI) / 3) * sz;
      const x3 = p.x + Math.cos(rot + (4 * Math.PI) / 3) * sz;
      const y3 = p.y + Math.sin(rot + (4 * Math.PI) / 3) * sz;

      graphics
        .moveTo(x1, y1)
        .lineTo(x2, y2)
        .lineTo(x3, y3)
        .closePath()
        .fill({ color, alpha: currentAlpha });
    }

    nextParticles.push(p);
  }

  activeParticles = nextParticles;
}
