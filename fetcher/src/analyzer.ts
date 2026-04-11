import type {
  HeliusTx,
  TokenFlow,
  HourlyVolume,
  AddressNode,
  FlowEdge,
} from './types'

// ── 工具 ──────────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || '?'
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`
}

function toHourKey(ts: number): { iso: string; ts: number } {
  const d = new Date(ts * 1000)
  d.setMinutes(0, 0, 0)
  return { iso: d.toISOString(), ts: Math.floor(d.getTime() / 1000) }
}

// ── 核心提取 ──────────────────────────────────────────────────────────────────
//
// 规则：按笔计算每个地址的净 token 变化量，消除路由/聚合器中间节点的双重计数。
//
//   1. 对每笔 tx，累加每个地址的净 delta（received - sent）
//   2. 过滤净 delta ≈ 0 的地址（路由合约，仅过路不留存）
//   3. 贪心匹配：将 senders（delta<0）与 receivers（delta>0）按金额从大到小对应
//
// 优点：A→B→C 的链式路由在同一 tx 内，B 的净 delta = 0 被过滤；
//       只产生 A→C 一条 flow，不再重复计算体积。

const DUST = 0.001  // 忽略低于此值的净变化（浮点误差 + 手续费尾数）

export function extractTokenFlows(
  transactions: HeliusTx[],
  targetMint: string,
  minAmount = 0,
): TokenFlow[] {
  const flows: TokenFlow[] = []

  for (const tx of transactions) {
    if (!tx || tx.transactionError) continue
    const { signature, timestamp, type, source } = tx

    // Step 1: 计算每个地址在本笔 tx 中对目标 mint 的净 delta
    const delta = new Map<string, number>()
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== targetMint || t.tokenAmount <= 0) continue
      const from = t.fromUserAccount || t.fromTokenAccount || '(unknown)'
      const to   = t.toUserAccount   || t.toTokenAccount   || '(unknown)'
      delta.set(from, (delta.get(from) ?? 0) - t.tokenAmount)
      delta.set(to,   (delta.get(to)   ?? 0) + t.tokenAmount)
    }

    // Step 2: 分离净发送方（delta < -DUST）和净接收方（delta > DUST），按金额降序
    const senders = [...delta.entries()]
      .filter(([, d]) => d < -DUST)
      .map(([addr, d]) => ({ addr, amt: -d }))
      .sort((a, b) => b.amt - a.amt)
    const receivers = [...delta.entries()]
      .filter(([, d]) => d > DUST)
      .map(([addr, d]) => ({ addr, amt: d }))
      .sort((a, b) => b.amt - a.amt)

    if (!senders.length || !receivers.length) continue

    // Step 3: 贪心匹配 — sender 的金额逐步消耗给 receiver
    const sAmts = senders.map(s => ({ ...s }))
    const rAmts = receivers.map(r => ({ ...r }))
    let si = 0, ri = 0

    while (si < sAmts.length && ri < rAmts.length) {
      const s = sAmts[si]
      const r = rAmts[ri]
      const matched = Math.min(s.amt, r.amt)
      if (matched >= DUST && matched >= minAmount) {
        flows.push({
          signature, timestamp,
          fromAddress: s.addr,
          toAddress:   r.addr,
          amount:      matched,
          txType:      type   || 'UNKNOWN',
          source:      source || 'UNKNOWN',
          mint:        targetMint,
        })
      }
      s.amt -= matched
      r.amt -= matched
      if (s.amt < DUST) si++
      if (r.amt < DUST) ri++
    }
  }

  return flows
}

// ── 时间聚合 ──────────────────────────────────────────────────────────────────

export function buildHourlyVolume(flows: TokenFlow[]): HourlyVolume[] {
  const map = new Map<string, { ts: number; totalAmount: number; txCount: number }>()

  for (const f of flows) {
    const { iso, ts } = toHourKey(f.timestamp)
    if (!map.has(iso)) map.set(iso, { ts, totalAmount: 0, txCount: 0 })
    const b = map.get(iso)!
    b.totalAmount += f.amount
    b.txCount++
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, b]) => ({
      hour:        iso,
      ts:          b.ts,
      totalAmount: +b.totalAmount.toFixed(2),
      txCount:     b.txCount,
    }))
}

// ── Top N 地址 ────────────────────────────────────────────────────────────────

export function buildTopAddresses(flows: TokenFlow[], topN = 30): AddressNode[] {
  const map = new Map<string, { sent: number; received: number; txCount: number }>()

  for (const f of flows) {
    for (const [addr, isSender] of [[f.fromAddress, true], [f.toAddress, false]] as [string, boolean][]) {
      if (!addr || addr === '(unknown)') continue
      if (!map.has(addr)) map.set(addr, { sent: 0, received: 0, txCount: 0 })
      const n = map.get(addr)!
      if (isSender) n.sent += f.amount
      else n.received += f.amount
      n.txCount++
    }
  }

  return [...map.entries()]
    .map(([address, d]) => ({
      address,
      label:         shortAddr(address),
      totalSent:     +d.sent.toFixed(2),
      totalReceived: +d.received.toFixed(2),
      netFlow:       +(d.received - d.sent).toFixed(2),
      txCount:       d.txCount,
    }))
    .sort((a, b) => {
      const aZero = Math.abs(a.netFlow) < 0.01
      const bZero = Math.abs(b.netFlow) < 0.01
      // 非零 netFlow 优先展示（真实买卖方 > 路由合约）
      if (aZero !== bZero) return aZero ? 1 : -1
      // 同组内按 |netFlow| 从大到小（非零组）或按总量从大到小（零值组）
      if (!aZero) return Math.abs(b.netFlow) - Math.abs(a.netFlow)
      return b.totalSent + b.totalReceived - (a.totalSent + a.totalReceived)
    })
    .slice(0, topN)
}

// ── Sankey 边 ─────────────────────────────────────────────────────────────────
//
// 只保留 topAddresses 之间的流动，其余的 from/to 归入 "Others"。
// 自循环边（from === to label）不显示。

export function buildEdges(flows: TokenFlow[], topAddresses: AddressNode[]): FlowEdge[] {
  // 所有 topAddresses 都是命名节点（buildTopAddresses 已限制 30 个）
  // 其余低频地址归入 "Others"
  const topSet = new Set(topAddresses.map((a) => a.address))

  const labelOf = (addr: string): { label: string; full: string } => {
    if (topSet.has(addr)) {
      const node = topAddresses.find((a) => a.address === addr)!
      return { label: node.label, full: addr }
    }
    return { label: 'Others', full: 'Others' }
  }

  const map = new Map<string, { amount: number; txCount: number; fromFull: string; toFull: string }>()

  for (const f of flows) {
    if (f.fromAddress === '(unknown)' || f.toAddress === '(unknown)') continue
    const from = labelOf(f.fromAddress)
    const to   = labelOf(f.toAddress)
    if (from.label === to.label) continue  // 同一节点自循环，跳过

    const key = `${from.label}||${to.label}`
    if (!map.has(key)) map.set(key, { amount: 0, txCount: 0, fromFull: from.full, toFull: to.full })
    const e = map.get(key)!
    e.amount += f.amount
    e.txCount++
  }

  return [...map.entries()]
    .map(([key, d]) => {
      const [from, to] = key.split('||')
      return {
        from, to,
        fromFull: d.fromFull,
        toFull:   d.toFull,
        amount:   +d.amount.toFixed(2),
        txCount:  d.txCount,
      }
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 60) // 最多 60 条边
}
