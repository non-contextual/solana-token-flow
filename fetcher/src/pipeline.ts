import fs from 'fs'
import path from 'path'
import { getTokenDecimals, getTokenMeta } from './helius'
import { extractTokenFlows, buildHourlyVolume, buildTopAddresses, buildEdges } from './analyzer'
import type { FlowData } from './types'

export interface PipelineOpts {
  mint:          string
  since:         number   // Unix 秒
  until:         number   // Unix 秒
  parsePercent?: number   // 从扫到的签名中解析多少比例（1-100，默认 100）
  sigScanCap?:   number   // 签名扫描上限（0 = 不限，扫完整个时间窗口）
  minAmount?:    number   // 最小单笔 token 数量过滤（0 = 不过滤）
  apiKey:        string
}

export type PipelineEvent =
  | { type: 'log';      level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'step';     step: number; total: number; label: string }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'done';     data: FlowData }
  | { type: 'error';    message: string }

export type OnEvent = (event: PipelineEvent) => void

export async function runPipeline(opts: PipelineOpts, emit: OnEvent): Promise<FlowData> {
  const { mint, since, until, parsePercent = 100, sigScanCap: sigScanCapOpt, minAmount = 0, apiKey } = opts
  const rpcUrl  = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
  const days    = Math.round((until - since) / 86400 * 10) / 10   // 展示用

  const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') =>
    emit({ type: 'log', level, message: msg })

  // ── Step 1: token decimals ────────────────────────────────────────────────
  emit({ type: 'step', step: 1, total: 4, label: 'Fetching token info' })
  const [decimals, tokenMeta] = await Promise.all([
    getTokenDecimals(rpcUrl, mint),
    getTokenMeta(rpcUrl, mint),
  ])
  const tokenLabel = tokenMeta.symbol ? `${tokenMeta.name} (${tokenMeta.symbol})` : ''
  log(`Mint: ${mint.slice(0, 8)}...${mint.slice(-4)}  decimals: ${decimals}${tokenLabel ? `  token: ${tokenLabel}` : ''}`)

  // ── Step 2: 获取签名 ──────────────────────────────────────────────────────
  emit({ type: 'step', step: 2, total: 4, label: 'Fetching signatures' })
  const sinceStr = new Date(since * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const untilStr = new Date(until * 1000).toISOString().slice(0, 16).replace('T', ' ')

  // 签名扫描深度：sigScanCapOpt=0 表示不设上限（扫完时间窗口内所有 sig）
  // 签名扫描只调基础 Solana RPC（便宜）
  const unlimited   = sigScanCapOpt === 0
  const sigScanCap  = unlimited ? Number.MAX_SAFE_INTEGER : (sigScanCapOpt ?? 30_000)
  const sigScanDesc = unlimited ? 'unlimited' : sigScanCap.toLocaleString()
  log(`Querying ${sinceStr} → ${untilStr} UTC  (scan ${sigScanDesc} sigs, parse ${parsePercent}%)...`)

  // untilTs 加 60s 宽容边界，避免用户点击 preset 与点击 Fetch 之间的微小时间差
  const { sigs: rawSigs, skippedTooNew, skippedErr } = await fetchSignatures(
    rpcUrl, mint, since, until + 60, sigScanCap,
    (done) => emit({ type: 'progress', label: 'signatures', done, total: unlimited ? 0 : sigScanCap }),
  )
  log(`Scanned ${rawSigs.length} sig(s)${skippedTooNew > 0 ? `  (${skippedTooNew} skipped: newer than until)` : ''}${skippedErr > 0 ? `  (${skippedErr} skipped: on-chain error)` : ''}`)

  // 根据 parsePercent 决定从扫到的签名里实际解析多少，最多 10000（Helius API 昂贵）
  const parseLimit = Math.min(Math.round(rawSigs.length * parsePercent / 100), 10_000)
  const sigs = rawSigs.length > parseLimit ? sampleByTime(rawSigs, parseLimit) : rawSigs

  const fmtTs = (ts: number | null) => ts
    ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')
    : 'unknown'

  if (sigs.length > 0) {
    // sampleByTime 返回按时间升序，index 0 = 最旧，last = 最新
    const oldestTs = sigs[0].blockTime ?? null
    const newestTs = sigs[sigs.length - 1].blockTime ?? null
    if (rawSigs.length > parseLimit) {
      log(`Sampled ${sigs.length} of ${rawSigs.length} sigs uniformly across time window`)
    }
    log(`Coverage: ${fmtTs(oldestTs)} → ${fmtTs(newestTs)} UTC`)
    if (!unlimited && rawSigs.length >= sigScanCap) {
      log(`Scan cap reached (${sigScanCap.toLocaleString()}) — not all transactions in the range were scanned`, 'warn')
    }
  }

  if (rawSigs.length === 0) {
    log(`No transactions found — try a longer time range`, 'warn')
  }

  // ── Step 3: 解析交易 ──────────────────────────────────────────────────────
  emit({ type: 'step', step: 3, total: 4, label: 'Parsing transactions' })
  log(`Parsing ${sigs.length} tx via Helius Enhanced API...`)

  const txns = await fetchParsedTransactions(
    apiKey,
    sigs.map((s) => s.signature),
    (done, total) => emit({ type: 'progress', label: 'transactions', done, total }),
  )

  // 诊断：type 分布 + tokenTransfers 覆盖率
  const typeCounts: Record<string, number> = {}
  let withTransfers = 0
  for (const tx of txns) {
    if (!tx) continue
    typeCounts[tx.type ?? 'null'] = (typeCounts[tx.type ?? 'null'] ?? 0) + 1
    if ((tx.tokenTransfers?.length ?? 0) > 0) withTransfers++
  }
  log(`TX types: ${Object.entries(typeCounts).map(([k, v]) => `${k}(${v})`).join(' ')}`)
  log(`With tokenTransfers: ${withTransfers}/${txns.length}`)

  // ── Step 4: 提取所有 token flow ───────────────────────────────────────────
  emit({ type: 'step', step: 4, total: 4, label: 'Extracting token flows' })

  const flows = extractTokenFlows(txns, mint, minAmount)
  log(`Token flow events: ${flows.length}`)

  if (flows.length === 0) {
    log(`No token transfers found for this mint`, 'warn')
    log(`Possible reasons: very new token, no activity in the period, or incorrect mint address`, 'warn')
  }

  const hourlyVolume = buildHourlyVolume(flows)
  const topAddresses = buildTopAddresses(flows, 60)    // 非零 netFlow 优先，最多 60 个命名节点
  const edges        = buildEdges(flows, topAddresses)
  log(`topAddresses: ${topAddresses.length}  |  edges: ${edges.length}`)

  // 预计算聚合统计，供前端 StatsCards 直接使用（避免通过 SSE 传输原始 flows）
  const totalVolume      = flows.reduce((s, f) => s + f.amount, 0)
  const uniqueAddresses  = new Set([...flows.map(f => f.fromAddress), ...flows.map(f => f.toAddress)]).size
  const uniqueSignatures = new Set(flows.map(f => f.signature)).size
  log(`Unique addresses: ${uniqueAddresses}  |  Total volume: ${totalVolume.toFixed(2)} tokens`)

  const sourceMap: Record<string, number> = {}
  for (const f of flows) sourceMap[f.source] = (sourceMap[f.source] ?? 0) + 1
  const topSourceEntry = Object.entries(sourceMap).sort((a, b) => b[1] - a[1])[0]
  const topSource      = topSourceEntry?.[0] ?? '—'
  const topSourceCount = topSourceEntry?.[1] ?? 0

  const poolLikeCount = topAddresses.filter(a =>
    a.totalSent > 0 && a.totalReceived > 0 &&
    Math.min(a.totalSent, a.totalReceived) / Math.max(a.totalSent, a.totalReceived) > 0.1
  ).length

  const mintShort = `${mint.slice(0, 6)}...${mint.slice(-4)}`
  const flowData: FlowData = {
    meta: {
      mint, mintShort, days,
      tokenName:   tokenMeta.name,
      tokenSymbol: tokenMeta.symbol,
      fetchedAt:        new Date().toISOString(),
      sinceTimestamp:   since,
      since,
      until,
      addressFetched:   mint,
      totalTxns:        txns.length,
      totalFlows:       flows.length,
      totalVolume:      +totalVolume.toFixed(2),
      uniqueAddresses,
      uniqueSignatures,
      topSource,
      topSourceCount,
      poolLikeCount,
    },
    flows,
    hourlyVolume,
    topAddresses,
    edges,
  }

  // 写前端数据
  const dataDir = path.resolve(__dirname, '../../frontend/public/data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'flow_data.json'), JSON.stringify(flowData, null, 2), 'utf-8')

  // 写存档
  const archiveDir = path.resolve(__dirname, '../output')
  fs.mkdirSync(archiveDir, { recursive: true })
  const sinceDate = new Date(since * 1000).toISOString().slice(0, 10)
  const untilDate = new Date(until * 1000).toISOString().slice(0, 10)
  fs.writeFileSync(
    path.join(archiveDir, `${mint}_${sinceDate}_${untilDate}_${Date.now()}.json`),
    JSON.stringify(flowData, null, 2), 'utf-8',
  )

  log(`✓ Done`)
  // SSE done 事件省略原始 flows（可能数千条），只传聚合数据，避免 EventSource 解析超大 JSON
  emit({ type: 'done', data: { ...flowData, flows: [] } })
  return flowData
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

export async function fetchSignatures(
  rpcUrl: string, address: string, sinceTs: number, untilTs: number,
  maxCount: number, onProgress: (done: number) => void,
) {
  const all: any[] = []
  let before: string | undefined
  let skippedTooNew = 0
  let skippedErr    = 0

  while (all.length < maxCount) {
    const opts: Record<string, unknown> = { limit: 1000, commitment: 'finalized' }
    if (before) opts.before = before

    const res  = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, opts] }),
    })
    const data = await res.json() as { result?: any[]; error?: { message: string } }
    if (data.error) throw new Error(`RPC: ${data.error.message}`)

    const result = data.result ?? []
    if (!result.length) break

    let hitOldLimit = false
    for (const sig of result) {
      if (all.length >= maxCount) break   // 批次内也强制截断，防止超出 limit
      if (sig.err) { skippedErr++; continue }
      if (sig.blockTime !== null && sig.blockTime > untilTs) { skippedTooNew++; continue }
      if (sig.blockTime !== null && sig.blockTime < sinceTs) { hitOldLimit = true; break }
      all.push(sig)
    }

    onProgress(Math.min(all.length, maxCount))
    if (hitOldLimit || result.length < 1000) break
    before = result[result.length - 1].signature
    await sleep(110)
  }

  return { sigs: all, skippedTooNew, skippedErr }
}

async function fetchParsedTransactions(
  apiKey: string, signatures: string[],
  onProgress: (done: number, total: number) => void,
) {
  const results: any[] = []
  const total = signatures.length
  const BATCH = 100

  for (let i = 0; i < total; i += BATCH) {
    const batch = signatures.slice(i, i + BATCH)
    const res = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: batch }),
    })
    if (res.status === 429) { await sleep(2000); i -= BATCH; continue }
    if (!res.ok) throw new Error(`Enhanced TX API: ${res.status}`)

    const data = await res.json() as any[]
    results.push(...data.filter(Boolean))
    onProgress(Math.min(i + BATCH, total), total)
    await sleep(210)
  }
  return results
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// 在时间轴上均匀采样签名，保证各时段都有代表性数据
// 输入为任意顺序的 sigs（含 blockTime），输出为按时间升序的 targetCount 条
function sampleByTime(sigs: any[], targetCount: number): any[] {
  const sorted = [...sigs].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0))
  if (sorted.length <= targetCount) return sorted
  const result: any[] = []
  const step = sorted.length / targetCount
  for (let i = 0; i < targetCount; i++) {
    result.push(sorted[Math.floor(i * step)])
  }
  return result
}
