import { Sprite, Texture } from "pixi.js";

type Palette = Record<string, number>;

const transparent = ".";

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const textureCache = new Map<string, Texture>();

function makeTexture(key: string, rows: string[], palette: Palette): Texture {
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const width = Math.max(...rows.map((row) => row.length));
  const height = rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create sprite canvas");
  }

  context.imageSmoothingEnabled = false;
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      const key = row[x] ?? transparent;
      if (key === transparent) {
        continue;
      }

      const color = palette[key];
      if (color === undefined) {
        continue;
      }

      context.fillStyle = colorToCss(color);
      context.fillRect(x, y, 1, 1);
    }
  }

  const texture = Texture.from({ resource: canvas, scaleMode: "nearest" });
  texture.source.scaleMode = "nearest";
  textureCache.set(key, texture);
  return texture;
}

function makePixelSprite(texture: Texture, scale: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(scale);
  return sprite;
}

const darkAnt = 0x1b1210;
const midAnt = 0x402019;
const antHighlight = 0x6a3a27;
const foodYellow = 0xe6c45a;
const clayShadow = 0x5b281c;
const clayDark = 0x8b3f2a;
const clayMid = 0xbc6240;
const clayLight = 0xd78358;
const clayTop = 0xef9a64;
const berryDark = 0x7a1f18;
const berryMid = 0xc93426;
const berryLight = 0xff6a3d;
const redClayShadow = 0x692018;
const redClayDark = 0x9c3524;
const redClayMid = 0xd05236;
const redClayLight = 0xee7a52;
const redClayTop = 0xff916a;

const redAntDark = 0x5a1210;
const redAntMid = 0xa62b1b;
const redAntHighlight = 0xd95d4e;

const redQueenDark = 0x55120d;
const redQueenMid = 0x9e3b2b;

export const spriteMaps = {
  ant: [
    "..1..1......",
    "...1..1.1.1.",
    ".1111.11.1..",
    "1111.2222...",
    "111112222...",
    "1111.2222...",
    ".1111.11.1..",
    "...1..1.1.1.",
    "..1..1......"
  ],
  antCarry: [
    "..1..1......",
    "...1..1.1.1.",
    ".1111.11.1..",
    "1111.2222...",
    "111112222...",
    "1111.2222...",
    ".1111.11.1..",
    "...1..1.1.1.",
    "..1..1......"
  ],
  clayfolk: [
    ".....111111.....",
    "....12233221....",
    "...1224433221...",
    "...1243333321...",
    "..123E3333E321..",
    "..123333333321..",
    "...1233333321...",
    "...1223333221...",
    "....11222211....",
    "...1122222211...",
    "..122223322221..",
    "..122233332221..",
    "..122233332221..",
    "...1222332221...",
    "...1122222211...",
    "....122..221....",
    "....122..221....",
    "....112..211....",
    "....11....11...."
  ],
  clayfolkCarry: [
    ".....111111.....",
    "....12233221....",
    "...1224433221...",
    "...1243333321...",
    "..123E3333E321..",
    "..123333333321..",
    "...1233333321...",
    "...1223333221...",
    "....11222211....",
    "...1122222211...",
    "..122223322221..",
    "..122233332221..",
    "..122233332221..",
    "...1222332221...",
    "...1122222211...",
    "....122..221....",
    "....122..221....",
    "....112..211....",
    "....11....11...."
  ],
  queen: [
    "....1111.......",
    "..11222211.....",
    ".1222222221....",
    "122222222221...",
    ".1222222221.11.",
    "..122222221.121",
    "...12222221..11",
    "....1222221....",
    ".....11111....."
  ],
  egg: [
    "..11..",
    ".1221.",
    "122221",
    "122221",
    ".1221.",
    "..11.."
  ],
  larva: [
    "..11..",
    ".1221.",
    "122221",
    ".1221.",
    "..11.."
  ],
  spider: [
    "1....11....1",
    ".1..1221..1.",
    "..11222211..",
    "..12222221..",
    "..11222211..",
    ".1..1221..1.",
    "1....11....1"
  ],
  spiderLair: [
    "....1111....",
    "..11222211..",
    ".1222332221.",
    "122233332221",
    "122233332221",
    ".1222332221.",
    "..11222211..",
    "....1111...."
  ],
  food: [
    ".12.",
    "1221",
    ".11."
  ],
  fruitIcon: [
    "...3...",
    "..33...",
    ".1111..",
    "122221.",
    "122221.",
    ".12221.",
    "..111.."
  ],
  fishIcon: [
    "........1",
    "...111.12",
    ".11222122",
    "122232221",
    ".11222122",
    "...111.12",
    "........1"
  ],
  meatIcon: [
    "......11.",
    ".....1221",
    "..1111221",
    ".1222221.",
    "1223321..",
    ".12221...",
    "..111...."
  ],
  berry: [
    ".22.",
    "2132",
    ".22."
  ],
  carrion: [
    "1.2..",
    ".223.",
    "12231",
    "..21."
  ],
  grain: [
    ".12.",
    "1221",
    ".11."
  ],
  clayLump: [
    ".111.",
    "12321",
    "12221",
    ".111."
  ],
  woodStick: [
    "11....",
    ".2211.",
    "..1221",
    "....11"
  ],
  stoneChunk: [
    ".111.",
    "12321",
    "12221",
    ".111."
  ],
  spear: [
    "....33....",
    "...3333...",
    "...3333...",
    "....22....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11....",
    "....11...."
  ],
  fishingRod: [
    "...........11..",
    "..........11...",
    ".........11....",
    "........11.....",
    ".......11......",
    "......11.......",
    ".....11........",
    "....11.........",
    "...11..........",
    "..11...........",
    ".22............",
    ".22............",
    ".22............",
    "..2............"
  ]
} as const;

export const spritePalettes = {
  ant: {
    "1": darkAnt,
    "2": midAnt,
    "3": antHighlight
  },
  antRed: {
    "1": redAntDark,
    "2": redAntMid,
    "3": redAntHighlight
  },
  antCarry: {
    "1": darkAnt,
    "2": midAnt,
    "3": berryMid
  },
  antCarryRed: {
    "1": redAntDark,
    "2": redAntMid,
    "3": berryMid
  },
  clayfolk: {
    "1": 0x7c3a20,
    "2": 0xc65a30,
    "3": 0xe07a45,
    "4": 0xf5a06b,
    "5": berryMid,
    "6": berryLight,
    "7": clayTop,
    "E": 0x2f1810
  },
  clayfolkRed: {
    "1": 0x7f1d12,
    "2": 0xc93a24,
    "3": 0xe25b3c,
    "4": 0xf4835e,
    "5": berryMid,
    "6": berryLight,
    "7": redClayTop,
    "E": 0x24100a
  },
  queen: {
    "1": 0x26130f,
    "2": 0x5a2b22
  },
  queenRed: {
    "1": redQueenDark,
    "2": redQueenMid
  },
  egg: {
    "1": 0xf4ead4,
    "2": 0xd9c89f
  },
  larva: {
    "1": 0xf4e7c8,
    "2": 0xcfae7a
  },
  spider: {
    "1": 0x16100f,
    "2": 0x3b2420
  },
  spiderLair: {
    "1": 0xd8d2c6,
    "2": 0x2b211e,
    "3": 0x6f2a24
  },
  food: {
    "1": 0x3d8b45,
    "2": 0x7abf5a
  },
  fruitIcon: {
    "1": 0x8f251d,
    "2": 0xe34b2f,
    "3": 0x4f8a31
  },
  fishIcon: {
    "1": 0x244d73,
    "2": 0x4f9ec7,
    "3": 0xbde9e8
  },
  meatIcon: {
    "1": 0x5f2822,
    "2": 0xb94b3f,
    "3": 0xf1a080
  },
  berry: {
    "1": berryDark,
    "2": berryMid,
    "3": berryLight
  },
  carrion: {
    "1": 0x2a1715,
    "2": 0x6f2a24,
    "3": 0xb57a55
  },
  grain: {
    "1": 0xb27a30,
    "2": 0xe0b458
  },
  clayLump: {
    "1": 0x8b3f2a,
    "2": 0xbc6240,
    "3": 0xef9a64
  },
  woodStick: {
    "1": 0x4f2f16,
    "2": 0x8a5429
  },
  stoneChunk: {
    "1": 0x5d5a54,
    "2": 0x8d8b82,
    "3": 0xc9c4b4
  },
  spear: {
    "1": 0x6b4a24,
    "2": 0x4a3b32,
    "3": 0xc9c4b4
  },
  fishingRod: {
    "1": 0x7b4a20,
    "2": 0x3d2717
  }
} as const;

export type AntColor = "dark" | "red";

export function getAntTexture(carrying: boolean, color: AntColor = "dark"): Texture {
  const key = carrying ? `antCarry_${color}` : `ant_${color}`;
  const palette = color === "red"
    ? (carrying ? spritePalettes.antCarryRed : spritePalettes.antRed)
    : (carrying ? spritePalettes.antCarry : spritePalettes.ant);

  return makeTexture(key, carrying ? [...spriteMaps.antCarry] : [...spriteMaps.ant], palette);
}

export function getClayfolkTexture(carrying: boolean, color: AntColor = "dark"): Texture {
  const key = carrying ? `clayfolkCarry_${color}` : `clayfolk_${color}`;
  const palette = color === "red" ? spritePalettes.clayfolkRed : spritePalettes.clayfolk;
  return makeTexture(key, carrying ? [...spriteMaps.clayfolkCarry] : [...spriteMaps.clayfolk], palette);
}

export function getQueenTexture(color: AntColor = "dark"): Texture {
  const key = `queen_${color}`;
  const palette = color === "red" ? spritePalettes.queenRed : spritePalettes.queen;
  return makeTexture(key, [...spriteMaps.queen], palette);
}

export function getEggTexture(): Texture {
  return makeTexture("egg", [...spriteMaps.egg], spritePalettes.egg);
}

export function getLarvaTexture(): Texture {
  return makeTexture("larva", [...spriteMaps.larva], spritePalettes.larva);
}

export function getSpiderTexture(): Texture {
  return makeTexture("spider", [...spriteMaps.spider], spritePalettes.spider);
}

export function getSpiderLairTexture(): Texture {
  return makeTexture("spiderLair", [...spriteMaps.spiderLair], spritePalettes.spiderLair);
}

export function getFoodTexture(): Texture {
  return makeTexture("food", [...spriteMaps.food], spritePalettes.food);
}

export function getBerryTexture(): Texture {
  return makeTexture("berry", [...spriteMaps.berry], spritePalettes.berry);
}

export function getCarrionTexture(): Texture {
  return makeTexture("carrion", [...spriteMaps.carrion], spritePalettes.carrion);
}

export function getGrainTexture(): Texture {
  return makeTexture("grain", [...spriteMaps.grain], spritePalettes.grain);
}

export function getClayTexture(): Texture {
  return makeTexture("clayLump", [...spriteMaps.clayLump], spritePalettes.clayLump);
}

export function getWoodTexture(): Texture {
  return makeTexture("woodStick", [...spriteMaps.woodStick], spritePalettes.woodStick);
}

export function getStoneTexture(): Texture {
  return makeTexture("stoneChunk", [...spriteMaps.stoneChunk], spritePalettes.stoneChunk);
}

export function getSpearTexture(): Texture {
  return makeTexture("spear", [...spriteMaps.spear], spritePalettes.spear);
}

export function getFishingRodTexture(): Texture {
  return makeTexture("fishingRod", [...spriteMaps.fishingRod], spritePalettes.fishingRod);
}

// Пиксельные иконки для DOM-панелей (ресурс-бар): PNG data-URL с масштабом.
const iconCache = new Map<string, string>();

export function spriteIconDataUrl(
  name: "food" | "fruit" | "fish" | "meat" | "clay" | "wood" | "stone" | "pop",
  scale = 4
): string {
  const key = `${name}_${scale}`;
  const cached = iconCache.get(key);
  if (cached) {
    return cached;
  }

  const source: { rows: readonly string[]; palette: Palette } =
    name === "food"
      ? { rows: spriteMaps.food, palette: spritePalettes.food }
      : name === "fruit"
        ? { rows: spriteMaps.fruitIcon, palette: spritePalettes.fruitIcon }
        : name === "fish"
          ? { rows: spriteMaps.fishIcon, palette: spritePalettes.fishIcon }
          : name === "meat"
            ? { rows: spriteMaps.meatIcon, palette: spritePalettes.meatIcon }
      : name === "clay"
              ? { rows: spriteMaps.clayLump, palette: spritePalettes.clayLump }
              : name === "wood"
                ? { rows: spriteMaps.woodStick, palette: spritePalettes.woodStick }
                : name === "stone"
                  ? { rows: spriteMaps.stoneChunk, palette: spritePalettes.stoneChunk }
                  : { rows: spriteMaps.clayfolk, palette: spritePalettes.clayfolk };

  const width = Math.max(...source.rows.map((row) => row.length));
  const height = source.rows.length;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }
  context.imageSmoothingEnabled = false;
  for (let y = 0; y < height; y += 1) {
    const row = source.rows[y] ?? "";
    for (let x = 0; x < row.length; x += 1) {
      const colorKey = row[x] ?? ".";
      if (colorKey === ".") {
        continue;
      }
      const color = source.palette[colorKey];
      if (color === undefined) {
        continue;
      }
      context.fillStyle = colorToCss(color);
      context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  const url = canvas.toDataURL();
  iconCache.set(key, url);
  return url;
}

export function createAntSprite(carrying: boolean, scale = 2.5): Sprite {
  return makePixelSprite(getAntTexture(carrying), scale);
}

export function createClayfolkSprite(carrying: boolean, scale = 2.5): Sprite {
  return makePixelSprite(getClayfolkTexture(carrying), scale);
}

export function createQueenSprite(scale = 3.5): Sprite {
  return makePixelSprite(getQueenTexture(), scale);
}

export function createEggSprite(scale = 3): Sprite {
  return makePixelSprite(getEggTexture(), scale);
}

export function createLarvaSprite(scale = 3): Sprite {
  return makePixelSprite(getLarvaTexture(), scale);
}

export function createSpiderSprite(scale = 4): Sprite {
  return makePixelSprite(getSpiderTexture(), scale);
}

export function createSpiderLairSprite(scale = 4): Sprite {
  return makePixelSprite(getSpiderLairTexture(), scale);
}

export function createFoodSprite(scale = 3): Sprite {
  return makePixelSprite(getFoodTexture(), scale);
}

export function createCarrionSprite(scale = 3): Sprite {
  return makePixelSprite(getCarrionTexture(), scale);
}

export function createGrainSprite(scale = 3): Sprite {
  return makePixelSprite(getGrainTexture(), scale);
}
