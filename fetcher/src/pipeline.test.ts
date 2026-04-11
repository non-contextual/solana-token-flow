import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSignatures } from './pipeline'

// ─── 辅助：构造 getSignaturesForAddress RPC 响应 ────────────────────────────

function makeSig(
  signature: string,
  blockTime: number | null = 1700000000,
  err: unknown = null,
) {
  return { signature, blockTime, err, slot: 0, memo: null, confirmationStatus: 'finalized' }
}

function rpcResponse(sigs: ReturnType<typeof makeSig>[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result: sigs }),
  } as Response)
}

function rpcError(message: string) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ error: { message } }),
  } as Response)
}

const SINCE = 1700000000
const UNTIL = 1700100000
const noop  = () => {}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── 返回结构 ─────────────────────────────────────────────────────────────────

describe('fetchSignatures — 返回结构', () => {
  it('返回 { sigs, skippedTooNew, skippedErr }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([])))
    const result = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(result).toHaveProperty('sigs')
    expect(result).toHaveProperty('skippedTooNew')
    expect(result).toHaveProperty('skippedErr')
  })

  it('空结果：sigs=[], skippedTooNew=0, skippedErr=0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([])))
    const { sigs, skippedTooNew, skippedErr } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toEqual([])
    expect(skippedTooNew).toBe(0)
    expect(skippedErr).toBe(0)
  })
})

// ─── 时间范围过滤 ─────────────────────────────────────────────────────────────

describe('fetchSignatures — 时间范围过滤', () => {
  it('blockTime 在 [since, until] 内 → 收录', async () => {
    const sig = makeSig('s1', SINCE + 1000)  // 明确在范围内
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([sig])))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('s1')
  })

  it('blockTime > untilTs → skippedTooNew++，不收录', async () => {
    const tooNew = makeSig('too-new', UNTIL + 1)
    const inRange = makeSig('in-range', SINCE + 500)
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(rpcResponse([tooNew, inRange]))
    )
    const { sigs, skippedTooNew } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('in-range')
    expect(skippedTooNew).toBe(1)
  })

  it('blockTime < sinceTs → 触发 hitOldLimit，停止分页', async () => {
    const inRange  = makeSig('in-range', SINCE + 500)
    const tooOld   = makeSig('too-old', SINCE - 1)
    const afterOld = makeSig('after-old', SINCE - 100)  // 不应该被收录
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(rpcResponse([inRange, tooOld, afterOld]))
    )
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    // 遇到 tooOld 后 break，afterOld 不收录
    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('in-range')
  })

  it('blockTime = null → 始终收录（不受上下界过滤）', async () => {
    const nullTime = makeSig('null-time', null)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([nullTime])))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('null-time')
  })

  it('blockTime = sinceTs（边界值）→ 收录', async () => {
    const edge = makeSig('edge', SINCE)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([edge])))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
  })

  it('blockTime = untilTs（边界值）→ 收录', async () => {
    const edge = makeSig('edge', UNTIL)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([edge])))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
  })
})

// ─── err 过滤 ─────────────────────────────────────────────────────────────────

describe('fetchSignatures — sig.err 过滤', () => {
  it('sig.err 非 null → skippedErr++，不收录', async () => {
    const errSig  = makeSig('err-sig', SINCE + 500, { InstructionError: [0, 'Custom'] })
    const okSig   = makeSig('ok-sig', SINCE + 600)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([errSig, okSig])))
    const { sigs, skippedErr } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('ok-sig')
    expect(skippedErr).toBe(1)
  })

  it('sig.err = null → 正常收录', async () => {
    const sig = makeSig('ok', SINCE + 500, null)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([sig])))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(sigs).toHaveLength(1)
  })
})

// ─── 分页逻辑 ─────────────────────────────────────────────────────────────────

describe('fetchSignatures — 分页', () => {
  it('result.length < 1000 → 不再翻页', async () => {
    const mockFetch = vi.fn().mockReturnValueOnce(rpcResponse([makeSig('s1', SINCE + 100)]))
    vi.stubGlobal('fetch', mockFetch)
    await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('第一页满 1000 条且未到 sinceTs → 翻页，使用最后一条 sig 作为 before', async () => {
    // 生成恰好 1000 条 in-range sigs
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      makeSig(`sig-p1-${i}`, UNTIL - i * 10)
    )
    // 第二页只有 1 条（表示最后一页）
    const page2 = [makeSig('sig-p2', SINCE + 50)]

    const mockFetch = vi.fn()
      .mockReturnValueOnce(rpcResponse(page1))
      .mockReturnValueOnce(rpcResponse(page2))

    vi.stubGlobal('fetch', mockFetch)
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 10000, noop)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(sigs).toHaveLength(1001)

    // 第二次调用应该带 before 参数
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(secondCallBody.params[1].before).toBe(page1[999].signature)
  })

  it('所有 sigs 都比 untilTs 新时 → 翻页继续查，直到找到 in-range 数据', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      makeSig(`too-new-${i}`, UNTIL + 1000 + i)
    )
    const page2 = [makeSig('in-range', SINCE + 500)]

    const mockFetch = vi.fn()
      .mockReturnValueOnce(rpcResponse(page1))
      .mockReturnValueOnce(rpcResponse(page2))

    vi.stubGlobal('fetch', mockFetch)
    const { sigs, skippedTooNew } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 10000, noop)

    expect(sigs).toHaveLength(1)
    expect(sigs[0].signature).toBe('in-range')
    expect(skippedTooNew).toBe(1000)
  })

  it('超出 maxCount 时停止', async () => {
    // 每页 1000 条，全在范围内，maxCount=50
    const page = Array.from({ length: 1000 }, (_, i) =>
      makeSig(`sig-${i}`, SINCE + 1000 - i)
    )
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(rpcResponse(page)))
    const { sigs } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 50, noop)
    expect(sigs.length).toBeLessThanOrEqual(50)  // 批次内早退，严格不超过 maxCount
  })
})

// ─── RPC 错误处理 ─────────────────────────────────────────────────────────────

describe('fetchSignatures — RPC 错误', () => {
  it('RPC 返回 error 字段 → 抛出 Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcError('Node is behind')))
    await expect(
      fetchSignatures('http://rpc', 'addr', SINCE, UNTIL, 100, noop)
    ).rejects.toThrow('Node is behind')
  })
})

// ─── +60s 宽容边界（pipeline 调用时加了 until+60） ───────────────────────────

describe('fetchSignatures — untilTs+60 宽容边界语义', () => {
  it('blockTime = untilTs + 30（在 +60 缓冲内）→ pipeline 层会收录', async () => {
    // pipeline 调用时传入 until+60，所以 untilTs 实际是 UNTIL+60
    const borderlineSig = makeSig('borderline', UNTIL + 30)
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(rpcResponse([borderlineSig])))
    // 模拟 pipeline 的行为：传入 until+60
    const { sigs, skippedTooNew } = await fetchSignatures('http://rpc', 'addr', SINCE, UNTIL + 60, 100, noop)
    expect(sigs).toHaveLength(1)
    expect(skippedTooNew).toBe(0)
  })
})
