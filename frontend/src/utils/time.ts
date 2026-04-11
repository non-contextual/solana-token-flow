/**
 * datetime-local 输入框工具函数
 *
 * datetime-local 格式为 "YYYY-MM-DDTHH:MM"，表示用户本地时间。
 * ES2015+ 规范：new Date("YYYY-MM-DDTHH:MM") 会按本地时区解析，
 * 因此 fromDatetimeLocal 返回的 Unix 秒与用户时区一致。
 */

/** Date → "YYYY-MM-DDTHH:MM"（本地时间） */
export function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "YYYY-MM-DDTHH:MM" → Unix 秒（本地时间） */
export function fromDatetimeLocal(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000)
}

/**
 * 解析 initialUntil（来自 URL params）：
 * 如果距今超过 2 小时，说明是历史查询的残留，重置为 now，
 * 避免漏掉近期数据。
 */
export function resolveDefaultUntil(initialUntil: number | undefined, now: Date = new Date()): Date {
  if (!initialUntil) return now
  const stale = now.getTime() / 1000 - initialUntil > 7200
  return stale ? now : new Date(initialUntil * 1000)
}
