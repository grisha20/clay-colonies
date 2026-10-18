import { WALL_CELL_SIZE, type Building, type Vec2 } from "../../../../shared/types";
import { fenceCellCenters } from "../../../../shared/fenceGeometry";

export type FencePost = { pos: Vec2; owner: string; height: number };
export type FenceSpan = { from: Vec2; to: Vec2; owner: string; gate: boolean };
export type FenceLayout = { posts: FencePost[]; spans: FenceSpan[] };
type Node = { building: Building; x: number; y: number; neighbors: Node[] };
export const FENCE_POST_HEIGHT = 20;
export const FENCE_GATE_HEIGHT = 41;
export const FENCE_GATE_BEAM_HEIGHT = 39;
const key = (owner: string, x: number, y: number) => `${owner}:${x}:${y}`;

/** Topology belongs to the ground grid. Textures never choose the direction. */
export function fenceLayout(buildings: Building[]): FenceLayout {
  const nodes = new Map<string, Node>();
  for (const b of buildings) if (b.stage === "built" && (b.type === "wall" || b.type === "gate")) {
    for (const pos of fenceCellCenters(b)) {
      const x = Math.floor(pos.x / WALL_CELL_SIZE), y = Math.floor(pos.y / WALL_CELL_SIZE);
      nodes.set(key(b.colonyId, x, y), { building: { ...b, pos }, x, y, neighbors: [] });
    }
  }
  for (const node of nodes.values()) {
    const owner = node.building.colonyId;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const next = nodes.get(key(owner, node.x + dx, node.y + dy));
      if (!next) continue;
      // An L-shaped/staircase route keeps its actual corner. Add a diagonal
      // only when neither orthogonal intermediate cell exists.
      if (dx && dy && (nodes.has(key(owner, node.x + dx, node.y)) || nodes.has(key(owner, node.x, node.y + dy)))) continue;
      node.neighbors.push(next);
    }
  }
  const posts = new Map<string, FencePost>(), spans: FenceSpan[] = [], edges = new Set<string>();
  function post(pos: Vec2, owner: string, height: number): void {
    const k = key(owner, pos.x, pos.y), old = posts.get(k);
    if (!old || old.height < height) posts.set(k, { pos, owner, height });
  }
  function span(from: Vec2, to: Vec2, owner: string, gate = false): void {
    if (Math.hypot(to.x - from.x, to.y - from.y) < 0.01) return;
    const a = key(owner, from.x, from.y), b = key(owner, to.x, to.y), k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edges.has(k)) return; edges.add(k); spans.push({ from, to, owner, gate });
  }
  // A legacy row of gate cells is one opening, rather than a post in every cell.
  const gateEnds = new Map<Node, [Vec2, Vec2]>();
  for (const node of nodes.values()) if (node.building.type === "gate" && !gateEnds.has(node)) {
    const direction = node.neighbors.find(n => n.building.type === "gate" && !n.building.gateSpan && !gateEnds.has(n));
    const lineX = direction ? direction.x - node.x : 1, lineY = direction ? direction.y - node.y : 0;
    const group: Node[] = [], pending = [node], seen = new Set<Node>();
    while (pending.length) {
      const n = pending.pop()!; if (seen.has(n)) continue; seen.add(n); group.push(n);
      pending.push(...n.neighbors.filter(other => other.building.type === "gate" && !seen.has(other) && !gateEnds.has(other) &&
        (node.building.gateSpan ? other.building.id === node.building.id : !other.building.gateSpan && (other.x - node.x) * lineY === (other.y - node.y) * lineX)));
    }
    const positions = group.map(n => n.building.pos);
    const minX = Math.min(...positions.map(p => p.x)), maxX = Math.max(...positions.map(p => p.x));
    const minY = Math.min(...positions.map(p => p.y)), maxY = Math.max(...positions.map(p => p.y));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    let dx = maxX - minX, dy = maxY - minY;
    if (group.length > 1) {
      const first = positions.reduce((a, b) => a.x + a.y < b.x + b.y ? a : b);
      const last = positions.reduce((a, b) => Math.hypot(a.x - first.x, a.y - first.y) > Math.hypot(b.x - first.x, b.y - first.y) ? a : b);
      dx = last.x - first.x; dy = last.y - first.y;
    } else if (node.building.gateAxis) {
      dx = node.building.gateAxis === "horizontal" ? 1 : 0; dy = node.building.gateAxis === "vertical" ? 1 : 0;
    } else if (node.neighbors.length) {
      dx = node.neighbors[0].building.pos.x - center.x; dy = node.neighbors[0].building.pos.y - center.y;
    } else { dx = 1; dy = 0; }
    const norm = Math.max(Math.abs(dx), Math.abs(dy), 1), ux = dx / norm, uy = dy / norm;
    const radius = (Math.max(maxX - minX, maxY - minY) + WALL_CELL_SIZE) / 2;
    const ends: [Vec2, Vec2] = [{ x: center.x - ux * radius, y: center.y - uy * radius }, { x: center.x + ux * radius, y: center.y + uy * radius }];
    for (const n of group) gateEnds.set(n, ends);
    for (const p of ends) post(p, node.building.colonyId, FENCE_GATE_HEIGHT);
    span(ends[0], ends[1], node.building.colonyId, true);
  }
  function port(node: Node, other: Node): Vec2 {
    const ends = gateEnds.get(node); if (!ends) return node.building.pos;
    const p = other.building.pos;
    return Math.hypot(ends[0].x - p.x, ends[0].y - p.y) < Math.hypot(ends[1].x - p.x, ends[1].y - p.y) ? ends[0] : ends[1];
  }
  for (const node of nodes.values()) {
    const b = node.building, p = b.pos, owner = b.colonyId, gate = b.type === "gate";
    if (!gate) post(p, owner, FENCE_POST_HEIGHT);
    for (const neighbor of node.neighbors) {
      if (gate && neighbor.building.type === "gate") continue;
      const from = port(node, neighbor), to = port(neighbor, node);
      span(from, to, owner);
    }
    if (!gate && node.neighbors.length <= 1) {
      const n = node.neighbors[0]?.building.pos;
      const delta = n ? { x: (p.x - n.x) / 2, y: (p.y - n.y) / 2 } : { x: WALL_CELL_SIZE / 2, y: 0 };
      const cap = { x: p.x + delta.x, y: p.y + delta.y };
      post(cap, owner, FENCE_POST_HEIGHT); span(p, cap, owner);
      if (!n) { const other = { x: p.x - delta.x, y: p.y - delta.y }; post(other, owner, FENCE_POST_HEIGHT); span(other, p, owner); }
    }
  }
  return { posts: [...posts.values()], spans };
}
