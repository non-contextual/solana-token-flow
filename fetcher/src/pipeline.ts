import fs from 'fs'
import path from 'path'
import { getTokenDecimals, getTokenMeta } from './helius'
import { extractTokenFlows, buildHourlyVolume, buildTopAddresses, buildEdges } from './analyzer'
import type { FlowData } from './types'

export interface PipelineOpts {
  mint:   string
  since:  number   // Unix 秒
  until:  number   // Unix 秒
  limit?: number
  apiKey: string
}

export type PipelineEvent =
  | { type: 'log';      level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'step';     step: number; total: number; label: string }
  | { type: 'progress'; label: string; done: number; total: number }
  | { type: 'done';     data: FlowData }
  | { type: 'error';    message: string }

export type OnEvent = (event: PipelineEvent) => void

export async function runPipeline(opts: PipelineOpts, emit: OnEvent): Promise<FlowData> {
  const { mint, since, until, limit = 3000, apiKey } = opts
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
  log(`Querying ${sinceStr} → ${untilStr} UTC  (limit ${limit})...`)

  const sigs = await fetchSignatures(
    rpcUrl, mint, since, until, limit,
    (done) => emit({ type: 'progress', label: 'signatures', done, total: limit }),
  )
  log(`Found ${sigs.length} signature(s)`)

  if (sigs.length === 0) {
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

  const flows = extractTokenFlows(txns, mint)
  log(`Token flow events: ${flows.length}`)

  if (flows.length === 0) {
    log(`No token transfers found for this mint`, 'warn')
    log(`Possible reasons: very new token, no activity in the period, or incorrect mint address`, 'warn')
  }

  const hourlyVolume = buildHourlyVolume(flows)
  const topAddresses = buildTopAddresses(flows)
  const edges        = buildEdges(flows, topAddresses)  // topAddresses 已是 top-30，全部作为命名节点
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

async function fetchSignatures(
  rpcUrl: string, address: string, sinceTs: number, untilTs: number,
  maxCount: number, onProgress: (done: number) => void,
) {
  const all: any[] = []
  let before: string | undefined

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
      if (sig.err) continue
      if (sig.blockTime !== null && sig.blockTime > untilTs) continue  // 比 until 还新，跳过
      if (sig.blockTime !== null && sig.blockTime < sinceTs) { hitOldLimit = true; break }
      all.push(sig)
    }

    onProgress(Math.min(all.length, maxCount))
    if (hitOldLimit || result.length < 1000) break
    before = result[result.length - 1].signature
    await sleep(110)
  }
  return all
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
