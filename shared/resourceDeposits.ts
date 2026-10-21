import type { Ant, Building, ResourceDeposit, ResourceNode, Vec2 } from "./types";
import { isWaterAt, isTerrainBlockedAt } from "./surfaceTerrain";

export const DEPOSIT_RX = 10;
export const DEPOSIT_RY = 6.5;
export const DEPOSIT_WORK_OFFSETS = [-.8, 2.4].flatMap(y => [-4.2, 0, 4.2].map(x => ({ x, y })));
export type DepositSurface = { width: number; height: number; entrances: Vec2[]; buildings: Building[]; resourceNodes: ResourceNode[]; deposits?: ResourceDeposit[] };
const sites = [
  ["clay-a", "clay", 88, 214], ["stone-a", "stone", 154, 270],
  ["clay-b", "clay", 392, 214], ["stone-b", "stone", 326, 270],
  ["clay-central", "clay", 216, 228], ["stone-central", "stone", 264, 252],
  ["stone-remote", "stone", 102, 92], ["clay-remote", "clay", 378, 388]
] as const;

export function depositContains(deposit: ResourceDeposit, pos: Vec2, margin = 0): boolean {
  return ((pos.x - deposit.pos.x) / (DEPOSIT_RX + margin)) ** 2 + ((pos.y - deposit.pos.y) / (DEPOSIT_RY + margin)) ** 2 <= 1;
}
export function depositRemaining(surface: Pick<DepositSurface, "resourceNodes">, id: string): number {
  return surface.resourceNodes.reduce((sum, n) => sum + (n.depositId === id ? Math.max(0, n.amount) : 0), 0);
}
export function depositWorkOccupied(ants: readonly Ant[], node: ResourceNode, except?: Ant): boolean {
  return !!node.depositId && ants.some(a => a !== except && a.state !== "dead" && !a.capturedBy && a.job === "harvest" && a.harvestNodeId === node.id);
}

/** Initialize once. An existing empty array/empty quarry must never refill on load. */
export function ensureResourceDeposits(surface: DepositSurface): void {
  if (surface.deposits !== undefined) return;
  const deposits: ResourceDeposit[] = []; surface.deposits = deposits;
  const clear = (p: Vec2): boolean => {
    if (p.x < 15 || p.y < 15 || p.x > surface.width - 15 || p.y > surface.height - 15) return false;
    if (surface.entrances.some(e => Math.hypot(p.x - e.x, p.y - e.y) < 30)) return false;
    if (surface.buildings.some(b => Math.hypot(p.x - b.pos.x, p.y - b.pos.y) < 19)) return false;
    if (deposits.some(d => Math.hypot(p.x - d.pos.x, p.y - d.pos.y) < 28)) return false;
    return Array.from({ length: 24 }, (_, i) => i * Math.PI / 12).every(a =>
      !isTerrainBlockedAt(p.x + Math.cos(a) * (DEPOSIT_RX + 3), p.y + Math.sin(a) * (DEPOSIT_RY + 4))) && !isTerrainBlockedAt(p.x, p.y);
  };
  for (const [id, kind, x, y] of sites) {
    let pos: Vec2 | undefined;
    for (let radius = 0; radius <= 80 && !pos; radius += 4) for (let i = 0; i < 24; i++) {
      const p = { x: x + Math.cos(i * Math.PI / 12) * radius, y: y + Math.sin(i * Math.PI / 12) * radius };
      if (clear(p)) { pos = p; break; }
    }
    if (!pos) continue;
    const capacity = kind === "clay" ? 4800 : 7200;
    deposits.push({ id: `deposit-${id}`, kind, pos, capacity });
    for (const [i, offset] of DEPOSIT_WORK_OFFSETS.entries()) {
      surface.resourceNodes.push({ id: `deposit-${id}-work-${i}`, depositId: `deposit-${id}`, kind,
        pos: { x: pos.x + offset.x, y: pos.y + offset.y }, amount: capacity / DEPOSIT_WORK_OFFSETS.length,
        maxAmount: capacity / DEPOSIT_WORK_OFFSETS.length, hitsPerUnit: kind === "clay" ? 2 : 6 });
    }
  }
}
