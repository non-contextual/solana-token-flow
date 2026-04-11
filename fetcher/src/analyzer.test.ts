import { describe, it, expect } from 'vitest'
import { extractTokenFlows, buildHourlyVolume, buildTopAddresses, buildEdges } from './analyzer'
import type { HeliusTx, TokenFlow } from './types'

// ─── 测试工具 ──────────────────────────────────────────────────────────────────

const MINT = 'TokenMintAddress1111111111111111111111111111'
const OTHER_MINT = 'OtherMintAddress1111111111111111111111111111'

function makeTx(overrides: Partial<HeliusTx> = {}): HeliusTx {
  return {
    signature: 'sig1',
    timestamp: 1700000000,
    type: 'SWAP',
    source: 'RAYDIUM',
    fee: 5000,
    feePayer: 'payer111',
    transactionError: null,
    tokenTransfers: [],
    nativeTransfers: [],
    accountData: [],
    events: {},
    ...overrides,
  }
}

function makeTransfer(overrides: Partial<HeliusTx['tokenTransfers'][number]> = {}) {
  return {
    mint: MINT,
    tokenAmount: 100,
    fromUserAccount: 'walletA111111111111111111111111111111111111',
    toUserAccount:   'walletB111111111111111111111111111111111111',
    fromTokenAccount: 'ataA1111111111111111111111111111111111111111',
    toTokenAccount:   'ataB1111111111111111111111111111111111111111',
    decimals: 6,
    tokenStandard: 'Fungible',
    ...overrides,
  }
}

function makeFlow(overrides: Partial<TokenFlow> = {}): TokenFlow {
  return {
    signature:   'sig1',
    timestamp:   1700000000,
    fromAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    toAddress:   'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1',
    amount:      100,
    txType:      'SWAP',
    source:      'RAYDIUM',
    mint:        MINT,
    ...overrides,
  }
}

// ─── extractTokenFlows ────────────────────────────────────────────────────────

describe('extractTokenFlows', () => {
  it('空数组返回 []', () => {
    expect(extractTokenFlows([], MINT)).toEqual([])
  })

  it('正常 transfer 产生一条 flow', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer()] })
    const flows = extractTokenFlows([tx], MINT)
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({
      signature:   'sig1',
      timestamp:   1700000000,
      fromAddress: 'walletA111111111111111111111111111111111111',
      toAddress:   'walletB111111111111111111111111111111111111',
      amount:      100,
      txType:      'SWAP',
      source:      'RAYDIUM',
      mint:        MINT,
    })
  })

  it('mint 不匹配 → 跳过', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ mint: OTHER_MINT })] })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(0)
  })

  it('tokenAmount = 0 → 跳过', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ tokenAmount: 0 })] })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(0)
  })

  it('tokenAmount < 0 → 跳过', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ tokenAmount: -1 })] })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(0)
  })

  it('transactionError 非空 → 整个 tx 跳过', () => {
    const tx = makeTx({
      transactionError: { err: 'InstructionError' },
      tokenTransfers: [makeTransfer()],
    })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(0)
  })

  it('null tx 项 → 跳过', () => {
    expect(extractTokenFlows([null as any], MINT)).toHaveLength(0)
  })

  it('优先使用 fromUserAccount', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ fromUserAccount: 'walletX', fromTokenAccount: 'ataX' })] })
    expect(extractTokenFlows([tx], MINT)[0].fromAddress).toBe('walletX')
  })

  it('fromUserAccount 为空时回退到 fromTokenAccount', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ fromUserAccount: '', fromTokenAccount: 'ataX' })] })
    expect(extractTokenFlows([tx], MINT)[0].fromAddress).toBe('ataX')
  })

  it('两者都为空时 fromAddress = "(unknown)"', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ fromUserAccount: '', fromTokenAccount: '' })] })
    expect(extractTokenFlows([tx], MINT)[0].fromAddress).toBe('(unknown)')
  })

  it('toUserAccount 为空时回退到 toTokenAccount', () => {
    const tx = makeTx({ tokenTransfers: [makeTransfer({ toUserAccount: '', toTokenAccount: 'ataY' })] })
    expect(extractTokenFlows([tx], MINT)[0].toAddress).toBe('ataY')
  })

  it('type 为空时 txType = "UNKNOWN"', () => {
    const tx = makeTx({ type: '', tokenTransfers: [makeTransfer()] })
    expect(extractTokenFlows([tx], MINT)[0].txType).toBe('UNKNOWN')
  })

  it('source 为空时 source = "UNKNOWN"', () => {
    const tx = makeTx({ source: '', tokenTransfers: [makeTransfer()] })
    expect(extractTokenFlows([tx], MINT)[0].source).toBe('UNKNOWN')
  })

  it('一笔 tx 含多条匹配 transfer → 多条 flow', () => {
    const tx = makeTx({
      tokenTransfers: [
        makeTransfer({ tokenAmount: 50 }),
        makeTransfer({ tokenAmount: 75, fromUserAccount: 'walletC' }),
        makeTransfer({ mint: OTHER_MINT }),   // 不同 mint，应跳过
      ],
    })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(2)
  })

  it('多笔 tx 各自产生 flow', () => {
    const tx1 = makeTx({ signature: 'sig1', tokenTransfers: [makeTransfer({ tokenAmount: 10 })] })
    const tx2 = makeTx({ signature: 'sig2', tokenTransfers: [makeTransfer({ tokenAmount: 20 })] })
    const flows = extractTokenFlows([tx1, tx2], MINT)
    expect(flows).toHaveLength(2)
    expect(flows.map(f => f.signature)).toEqual(['sig1', 'sig2'])
  })

  it('tokenTransfers 为空 → []', () => {
    const tx = makeTx({ tokenTransfers: [] })
    expect(extractTokenFlows([tx], MINT)).toHaveLength(0)
  })

  it('routing 中间节点（同 tx 净 delta=0）被消除：A→B→C → 只产生 A→C', () => {
    const walletA = 'walletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const walletB = 'walletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const walletC = 'walletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
    const tx = makeTx({
      signature: 'routing-sig',
      tokenTransfers: [
        makeTransfer({ fromUserAccount: walletA, toUserAccount: walletB, tokenAmount: 100 }),
        makeTransfer({ fromUserAccount: walletB, toUserAccount: walletC, tokenAmount: 100 }),
      ],
    })
    const flows = extractTokenFlows([tx], MINT)
    // walletB 净 delta = 0 → 过滤；只有 A→C
    expect(flows).toHaveLength(1)
    expect(flows[0].fromAddress).toBe(walletA)
    expect(flows[0].toAddress).toBe(walletC)
    expect(flows[0].amount).toBe(100)
  })

  it('一 sender 多 receiver（手续费拆分）→ 每个 receiver 各一条 flow', () => {
    const pool  = 'poolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const userB = 'userBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const feeC  = 'feeCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
    const tx = makeTx({
      tokenTransfers: [
        makeTransfer({ fromUserAccount: pool, toUserAccount: userB, tokenAmount: 99 }),
        makeTransfer({ fromUserAccount: pool, toUserAccount: feeC,  tokenAmount: 1  }),
      ],
    })
    const flows = extractTokenFlows([tx], MINT)
    // pool 发送 100，拆成 99→userB 和 1→feeC
    expect(flows).toHaveLength(2)
    const amounts = flows.map(f => f.amount).sort((a, b) => b - a)
    expect(amounts[0]).toBe(99)
    expect(amounts[1]).toBe(1)
    expect(flows.every(f => f.fromAddress === pool)).toBe(true)
  })
})

// ─── buildHourlyVolume ────────────────────────────────────────────────────────

describe('buildHourlyVolume', () => {
  it('空 flows 返回 []', () => {
    expect(buildHourlyVolume([])).toEqual([])
  })

  it('单条 flow 产生一个小时桶', () => {
    const flows = [makeFlow({ timestamp: 1700000000, amount: 123.456 })]
    const vol = buildHourlyVolume(flows)
    expect(vol).toHaveLength(1)
    expect(vol[0].totalAmount).toBe(123.46)  // 保留 2 位小数
    expect(vol[0].txCount).toBe(1)
    expect(typeof vol[0].hour).toBe('string')
    expect(vol[0].ts).toBeTypeOf('number')
  })

  it('同小时内的 flows 合并到一个桶', () => {
    // 同一小时内不同分钟
    const ts1 = 1700000000  // 某小时 :00
    const ts2 = ts1 + 1800  // 同小时 :30
    const flows = [
      makeFlow({ timestamp: ts1, amount: 100 }),
      makeFlow({ timestamp: ts2, amount: 200 }),
    ]
    const vol = buildHourlyVolume(flows)
    expect(vol).toHaveLength(1)
    expect(vol[0].totalAmount).toBe(300)
    expect(vol[0].txCount).toBe(2)
  })

  it('不同小时 → 独立桶，按时间升序排列', () => {
    const ts1 = 1700000000
    const ts2 = ts1 + 7200  // +2 小时
    const ts3 = ts1 - 3600  // -1 小时（更早）
    const flows = [
      makeFlow({ timestamp: ts2, amount: 50 }),
      makeFlow({ timestamp: ts1, amount: 30 }),
      makeFlow({ timestamp: ts3, amount: 20 }),
    ]
    const vol = buildHourlyVolume(flows)
    expect(vol).toHaveLength(3)
    // 按 ISO 字符串升序
    expect(vol[0].ts).toBeLessThan(vol[1].ts)
    expect(vol[1].ts).toBeLessThan(vol[2].ts)
  })

  it('ts 字段是整点时间戳（分秒归零）', () => {
    const flows = [makeFlow({ timestamp: 1700012345 })]  // 任意秒
    const vol = buildHourlyVolume(flows)
    const d = new Date(vol[0].ts * 1000)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
  })
})

// ─── buildTopAddresses ────────────────────────────────────────────────────────

describe('buildTopAddresses', () => {
  const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'  // 44 chars
  const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'
  const C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC1'

  it('空 flows 返回 []', () => {
    expect(buildTopAddresses([])).toEqual([])
  })

  it('正确计算 totalSent / totalReceived / netFlow / txCount', () => {
    const flows = [
      makeFlow({ fromAddress: A, toAddress: B, amount: 100 }),
      makeFlow({ fromAddress: A, toAddress: B, amount: 50 }),
    ]
    const result = buildTopAddresses(flows)
    const nodeA = result.find(n => n.address === A)!
    const nodeB = result.find(n => n.address === B)!
    expect(nodeA.totalSent).toBe(150)
    expect(nodeA.totalReceived).toBe(0)
    expect(nodeA.netFlow).toBe(-150)      // received - sent
    expect(nodeA.txCount).toBe(2)
    expect(nodeB.totalReceived).toBe(150)
    expect(nodeB.totalSent).toBe(0)
    expect(nodeB.netFlow).toBe(150)
  })

  it('同一地址作为 sender 和 receiver → 都累加', () => {
    const flows = [
      makeFlow({ fromAddress: A, toAddress: B, amount: 200 }),
      makeFlow({ fromAddress: B, toAddress: A, amount: 100 }),
    ]
    const result = buildTopAddresses(flows)
    const nodeA = result.find(n => n.address === A)!
    expect(nodeA.totalSent).toBe(200)
    expect(nodeA.totalReceived).toBe(100)
    expect(nodeA.txCount).toBe(2)
  })

  it('"(unknown)" 地址不出现在结果中', () => {
    const flows = [
      makeFlow({ fromAddress: '(unknown)', toAddress: A, amount: 999 }),
      makeFlow({ fromAddress: A, toAddress: '(unknown)', amount: 999 }),
    ]
    const result = buildTopAddresses(flows)
    expect(result.some(n => n.address === '(unknown)')).toBe(false)
    expect(result.some(n => n.address === A)).toBe(true)
  })

  it('非零 netFlow 优先（按 |netFlow| 降序），零 netFlow 排末尾', () => {
    // A: sent=10, recv=100, netFlow=+90
    // B: sent=0,  recv=10,  netFlow=+10
    // C: sent=100, recv=0,  netFlow=-100
    const flows = [
      makeFlow({ fromAddress: A, toAddress: B, amount: 10 }),
      makeFlow({ fromAddress: C, toAddress: A, amount: 100 }),
    ]
    const result = buildTopAddresses(flows)
    // 全部非零，按 |netFlow| 降序：C(100) → A(90) → B(10)
    expect(result.map(n => n.address)).toEqual([C, A, B])
  })

  it('超过 topN 条时只返回 topN 条（默认 30）', () => {
    // 生成 35 个不同地址
    const flows = Array.from({ length: 35 }, (_, i) => {
      const addr = `ADDR${String(i).padStart(40, '0')}`
      return makeFlow({ fromAddress: addr, toAddress: B, amount: i + 1 })
    })
    // 显式传 topN=30（默认值不变，pipeline 侧升级为 60）
    expect(buildTopAddresses(flows, 30)).toHaveLength(30)
  })

  it('自定义 topN', () => {
    const flows = Array.from({ length: 10 }, (_, i) =>
      makeFlow({ fromAddress: `ADDR${String(i).padStart(40, '0')}`, toAddress: B, amount: i })
    )
    expect(buildTopAddresses(flows, 5)).toHaveLength(5)
  })

  it('label 为 shortAddr：长地址 → 6…6 格式', () => {
    const flows = [makeFlow({ fromAddress: A })]
    const result = buildTopAddresses(flows)
    const node = result.find(n => n.address === A)!
    expect(node.label).toBe(`${A.slice(0, 6)}…${A.slice(-6)}`)
  })

  it('label 短地址（< 12 字符）直接返回原值', () => {
    const short = 'short'
    const flows = [makeFlow({ fromAddress: short })]
    const result = buildTopAddresses(flows)
    expect(result.find(n => n.address === short)?.label).toBe('short')
  })

  it('数值精度保留 2 位小数', () => {
    const flows = [makeFlow({ fromAddress: A, toAddress: B, amount: 1 / 3 })]
    const result = buildTopAddresses(flows)
    const node = result.find(n => n.address === A)!
    expect(node.totalSent.toString()).toMatch(/^\d+\.\d{1,2}$/)
  })
})

// ─── buildEdges ───────────────────────────────────────────────────────────────

describe('buildEdges', () => {
  const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'
  const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'
  const C = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC1'

  function makeTopAddr(address: string, sent = 100, received = 100) {
    return {
      address,
      label:         `${address.slice(0, 6)}…${address.slice(-6)}`,
      totalSent:     sent,
      totalReceived: received,
      netFlow:       received - sent,
      txCount:       1,
    }
  }

  it('空 flows 返回 []', () => {
    expect(buildEdges([], [])).toEqual([])
  })

  it('top-to-top 边正确生成', () => {
    const topAddrs = [makeTopAddr(A), makeTopAddr(B)]
    const flows = [makeFlow({ fromAddress: A, toAddress: B, amount: 500 })]
    const edges = buildEdges(flows, topAddrs)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      from:     topAddrs[0].label,
      to:       topAddrs[1].label,
      fromFull: A,
      toFull:   B,
      amount:   500,
      txCount:  1,
    })
  })

  it('非 top 地址归入 "Others"', () => {
    const topAddrs = [makeTopAddr(A)]
    const nonTop = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ1'
    const flows = [makeFlow({ fromAddress: A, toAddress: nonTop, amount: 100 })]
    const edges = buildEdges(flows, topAddrs)
    expect(edges[0].to).toBe('Others')
    expect(edges[0].toFull).toBe('Others')
  })

  it('同方向的多条 flow 聚合为一条边', () => {
    const topAddrs = [makeTopAddr(A), makeTopAddr(B)]
    const flows = [
      makeFlow({ fromAddress: A, toAddress: B, amount: 100 }),
      makeFlow({ fromAddress: A, toAddress: B, amount: 200 }),
      makeFlow({ fromAddress: A, toAddress: B, amount: 50 }),
    ]
    const edges = buildEdges(flows, topAddrs)
    expect(edges).toHaveLength(1)
    expect(edges[0].amount).toBe(350)
    expect(edges[0].txCount).toBe(3)
  })

  it('自循环边（from.label === to.label）跳过', () => {
    const topAddrs = [makeTopAddr(A)]
    // A → A 的自循环
    const flows = [makeFlow({ fromAddress: A, toAddress: A, amount: 100 })]
    expect(buildEdges(flows, topAddrs)).toHaveLength(0)
  })

  it('两个非 top 地址都映射到 Others → Others→Others 自循环，跳过', () => {
    const nonTop1 = 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ1'
    const nonTop2 = 'YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY1'
    const flows = [makeFlow({ fromAddress: nonTop1, toAddress: nonTop2, amount: 100 })]
    expect(buildEdges(flows, [])).toHaveLength(0)
  })

  it('"(unknown)" 地址跳过', () => {
    const topAddrs = [makeTopAddr(A)]
    const flows = [
      makeFlow({ fromAddress: '(unknown)', toAddress: A, amount: 100 }),
      makeFlow({ fromAddress: A, toAddress: '(unknown)', amount: 100 }),
    ]
    expect(buildEdges(flows, topAddrs)).toHaveLength(0)
  })

  it('按 amount 降序排列', () => {
    const topAddrs = [makeTopAddr(A), makeTopAddr(B), makeTopAddr(C)]
    const flows = [
      makeFlow({ fromAddress: A, toAddress: C, amount: 10 }),
      makeFlow({ fromAddress: A, toAddress: B, amount: 500 }),
      makeFlow({ fromAddress: B, toAddress: C, amount: 200 }),
    ]
    const edges = buildEdges(flows, topAddrs)
    const amounts = edges.map(e => e.amount)
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i - 1]).toBeGreaterThanOrEqual(amounts[i])
    }
  })

  it('超过 60 条边时只保留前 60 条（按 amount 降序）', () => {
    // 生成 70 个不同的 top 地址对
    const topAddrs = Array.from({ length: 71 }, (_, i) =>
      makeTopAddr(`ADDR${String(i).padStart(39, '0')}`)
    )
    // 70 条不同方向的边
    const flows = Array.from({ length: 70 }, (_, i) =>
      makeFlow({
        fromAddress: topAddrs[i].address,
        toAddress:   topAddrs[70].address,
        amount:      i + 1,
      })
    )
    const edges = buildEdges(flows, topAddrs)
    expect(edges).toHaveLength(60)
    // 保留的是 amount 最大的前 60 条
    expect(edges[0].amount).toBeGreaterThanOrEqual(edges[59].amount)
  })

  it('双向边（A→B 和 B→A）生成两条独立边', () => {
    const topAddrs = [makeTopAddr(A), makeTopAddr(B)]
    const flows = [
      makeFlow({ fromAddress: A, toAddress: B, amount: 100 }),
      makeFlow({ fromAddress: B, toAddress: A, amount: 200 }),
    ]
    const edges = buildEdges(flows, topAddrs)
    expect(edges).toHaveLength(2)
  })
})
