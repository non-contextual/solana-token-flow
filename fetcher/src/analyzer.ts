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
// 规则：
//   只要 tokenTransfer.mint === targetMint 且 amount > 0，就记录。
//   不判断 buy/sell，不校验 feePayer，不过滤 SOL 金额。
//   tokenTransfers.tokenAmount 已是 UI 格式，直接使用。

export function extractTokenFlows(
  transactions: HeliusTx[],
  targetMint: string,
): TokenFlow[] {
  const flows: TokenFlow[] = []

  for (const tx of transactions) {
    // 跳过链上失败的交易
    if (!tx || tx.transactionError) continue

    const { signature, timestamp, type, source } = tx

    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== targetMint) continue
      // tokenAmount 已是 UI 格式；极小浮点误差忽略
      if (t.tokenAmount <= 0) continue

      // 优先用 userAccount（钱包地址），其次用 tokenAccount（ATA 地址）
      const fromAddress = t.fromUserAccount || t.fromTokenAccount || '(unknown)'
      const toAddress   = t.toUserAccount   || t.toTokenAccount   || '(unknown)'

      flows.push({
        signature,
        timestamp,
        fromAddress,
        toAddress,
        amount:  t.tokenAmount,
        txType:  type   || 'UNKNOWN',
        source:  source || 'UNKNOWN',
        mint:    targetMint,
      })
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
    .sort((a, b) => b.totalSent + b.totalReceived - (a.totalSent + a.totalReceived))
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
