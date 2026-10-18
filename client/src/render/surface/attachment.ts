export type BodyMount = { x: number; y: number; groundY: number; size: number; facing: number; rotation: number; stretch: number };
export type ItemMount = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; anchorX: number; anchorY: number };

export function attachItem(body: BodyMount, localX: number, localY: number, scale: number, rotation = 0, anchorX = 0.5, anchorY = 0.5): ItemMount {
  const x = localX * body.size * body.facing * (2 - body.stretch), y = localY * body.size * body.stretch;
  const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
  return { x: body.x + x * c - y * s, y: body.y + x * s + y * c,
    scaleX: scale * body.facing, scaleY: scale, rotation: body.rotation + rotation * body.facing, anchorX, anchorY };
}

export function itemPoint(item: ItemMount, width: number, height: number, u: number, v: number) {
  const x = (u - item.anchorX) * width * item.scaleX, y = (v - item.anchorY) * height * item.scaleY;
  return { x: item.x + x * Math.cos(item.rotation) - y * Math.sin(item.rotation), y: item.y + x * Math.sin(item.rotation) + y * Math.cos(item.rotation) };
}
