import type { Texture } from "pixi.js";

/** CSS frame selection keeps the original atlas and the image's accessible label. */
export function setAtlasIcon(image: HTMLImageElement, texture: Texture, size: number, url: string): void {
  const scale = Math.min(size / texture.frame.width, size / texture.frame.height);
  image.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  image.style.width = `${size}px`; image.style.height = `${size}px`;
  image.style.imageRendering = "auto";
  image.style.backgroundImage = `url("${url}")`;
  image.style.backgroundRepeat = "no-repeat";
  image.style.backgroundSize = `${texture.source.width * scale}px ${texture.source.height * scale}px`;
  image.style.backgroundPosition = `${(size - texture.frame.width * scale) / 2 - texture.frame.x * scale}px ${(size - texture.frame.height * scale) / 2 - texture.frame.y * scale}px`;
}
