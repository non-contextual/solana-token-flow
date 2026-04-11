import { describe, it, expect } from 'vitest'
import { toDatetimeLocal, fromDatetimeLocal, resolveDefaultUntil } from './time'

// ─── toDatetimeLocal ──────────────────────────────────────────────────────────

describe('toDatetimeLocal', () => {
  it('产生 YYYY-MM-DDTHH:MM 格式', () => {
    const d = new Date(2024, 5, 15, 9, 5)  // 2024-06-15 09:05 本地时间
    expect(toDatetimeLocal(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('月/日/时/分不足两位时补零', () => {
    const d = new Date(2024, 0, 5, 8, 3)  // 2024-01-05 08:03
    const result = toDatetimeLocal(d)
    expect(result).toBe('2024-01-05T08:03')
  })

  it('12 月、最后一天正确格式化', () => {
    const d = new Date(2024, 11, 31, 23, 59)
    expect(toDatetimeLocal(d)).toBe('2024-12-31T23:59')
  })
})

// ─── fromDatetimeLocal ────────────────────────────────────────────────────────

describe('fromDatetimeLocal', () => {
  it('返回 Unix 秒（整数）', () => {
    const result = fromDatetimeLocal('2024-06-15T09:05')
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBeGreaterThan(0)
  })

  it('往返转换：toDatetimeLocal → fromDatetimeLocal ≈ 原始 Unix 秒', () => {
    // 构造一个精确到分钟的日期（秒归零，避免误差）
    const d = new Date(2024, 5, 15, 14, 30, 0, 0)
    const expectedTs = Math.floor(d.getTime() / 1000)
    const s = toDatetimeLocal(d)
    expect(fromDatetimeLocal(s)).toBe(expectedTs)
  })

  it('不同时间产生不同 Unix 秒', () => {
    const t1 = fromDatetimeLocal('2024-06-15T09:00')
    const t2 = fromDatetimeLocal('2024-06-15T10:00')
    expect(t2 - t1).toBe(3600)
  })
})

// ─── resolveDefaultUntil ──────────────────────────────────────────────────────

describe('resolveDefaultUntil', () => {
  const NOW_TS = 1700100000  // 参考 now
  const now    = new Date(NOW_TS * 1000)

  it('initialUntil = undefined → 返回 now', () => {
    expect(resolveDefaultUntil(undefined, now)).toBe(now)
  })

  it('initialUntil 距今 < 2 小时（新鲜值）→ 返回对应日期', () => {
    const recent = NOW_TS - 3600  // 1 小时前
    const result = resolveDefaultUntil(recent, now)
    expect(result.getTime()).toBe(recent * 1000)
  })

  it('initialUntil 距今 = 2 小时（边界）→ 仍算新鲜（2h 刚好不超过）', () => {
    const border = NOW_TS - 7200  // 恰好 2h
    // 7200 不大于 7200，所以不算 stale
    const result = resolveDefaultUntil(border, now)
    expect(result.getTime()).toBe(border * 1000)
  })

  it('initialUntil 距今 > 2 小时（过期）→ 返回 now', () => {
    const stale = NOW_TS - 7201  // 超过 2h
    const result = resolveDefaultUntil(stale, now)
    expect(result).toBe(now)
  })

  it('initialUntil 比 now 还新（未来时间）→ 距今差为负数，不 stale，返回对应日期', () => {
    const future = NOW_TS + 3600
    const result = resolveDefaultUntil(future, now)
    expect(result.getTime()).toBe(future * 1000)
  })
})
