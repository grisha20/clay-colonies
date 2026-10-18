// One day lasts ten simulation minutes at 1x. The first night allows seven
// minutes of preparation; dusk/dawn blend over thirty seconds.
export const DAY_TICKS = 6000;
export const NIGHT_START = 4200;
export function dayCycle(tick: number): { day: number; phase: "day" | "dusk" | "night" | "dawn"; darkness: number; sunAngle: number; until: number } {
  const t = ((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  const phase = t < NIGHT_START - 300 ? "day" : t < NIGHT_START ? "dusk" : t < DAY_TICKS - 300 ? "night" : "dawn";
  const darkness = phase === "dusk" ? (t - NIGHT_START + 300) / 300 : phase === "night" ? 1 : phase === "dawn" ? (DAY_TICKS - t) / 300 : 0;
  return { day: Math.floor(tick / DAY_TICKS) + 1, phase, darkness, sunAngle: (t / NIGHT_START) * Math.PI - Math.PI / 2, until: tick - t + (t < NIGHT_START ? NIGHT_START : DAY_TICKS) };
}
