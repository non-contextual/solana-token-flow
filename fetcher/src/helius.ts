import type { SignatureInfo, HeliusTx } from './types'

const LAMPORTS_PER_SOL = 1_000_000_000

// 使用 Node 18+ 内置 fetch，无需额外 HTTP 库
// API_KEY 由调用方传入，便于测试和复用

// ── 内部工具 ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`)
  const data = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (data.error) throw new Error(`RPC error [${method}]: ${data.error.message}`)
  return data.result
}

// ── 主要 API 函数 ─────────────────────────────────────────────────────────────

/**
 * 分页获取某地址的交易签名列表，直到 sinceTimestamp 为止。
 *
 * Helius RPC 每次最多返回 1000 条，通过 `before` 参数向历史翻页。
 * 遇到失败的 tx 直接跳过，不影响其他数据。
 */
export async function getSignatures(
  rpcUrl: string,
  address: string,
  sinceTimestamp: number,
  maxCount = 5000,
): Promise<SignatureInfo[]> {
  const all: SignatureInfo[] = []
  let before: string | undefined
  let page = 0

  console.log(`  Fetching signatures for ${address}...`)

  while (all.length < maxCount) {
    const opts: Record<string, unknown> = { limit: 1000, commitment: 'finalized' }
    if (before) opts.before = before

    const result = (await rpcCall(rpcUrl, 'getSignaturesForAddress', [address, opts])) as SignatureInfo[]
    if (!result?.length) break

    let hitTimeLimit = false
    for (const sig of result) {
      // 跳过链上失败的交易
      if (sig.err) continue
      // blockTime 为 null 时谨慎包含（极少见于最新区块）
      if (sig.blockTime !== null && sig.blockTime < sinceTimestamp) {
        hitTimeLimit = true
        break
      }
      all.push(sig)
    }

    page++
    process.stdout.write(`\r  ${all.length} signatures collected (page ${page})...`)

    if (hitTimeLimit || result.length < 1000) break
    before = result[result.length - 1].signature
    await sleep(110) // 保持低于 Helius 免费档 10 RPS 限制
  }

  console.log(`\n  Total signatures: ${all.length}`)
  return all
}

/**
 * 批量解析交易，使用 Helius Enhanced Transactions API。
 *
 * 每批最多 100 条签名，自动分批请求，显示进度。
 * Enhanced API 每条签名会返回 parsed type、tokenTransfers、events.swap 等结构化数据。
 */
export async function getParsedTransactions(
  apiKey: string,
  signatures: string[],
): Promise<HeliusTx[]> {
  const results: HeliusTx[] = []
  const BATCH = 100
  const total = signatures.length

  for (let i = 0; i < total; i += BATCH) {
    const batch = signatures.slice(i, i + BATCH)
    const url = `https://api.helius.xyz/v0/transactions/?api-key=${apiKey}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: batch }),
    })
    if (!res.ok) {
      // 429 Rate limit → 等久一点再重试
      if (res.status === 429) {
        console.warn('\n  Rate limited, waiting 2s...')
        await sleep(2000)
        i -= BATCH // 重试当前批次
        continue
      }
      throw new Error(`Enhanced TX API error: ${res.status}`)
    }

    const data = (await res.json()) as HeliusTx[]
    // API 偶尔返回 null 项，过滤掉
    results.push(...data.filter(Boolean))

    const done = Math.min(i + BATCH, total)
    process.stdout.write(`\r  Parsing transactions: ${done}/${total}`)
    await sleep(210) // Enhanced API ~5 RPS 限制
  }

  console.log()
  return results
}

/**
 * 查询某 mint 的最大持仓账户（用于辅助确认 token 是否有效）。
 */
export async function getTokenLargestAccounts(
  rpcUrl: string,
  mint: string,
): Promise<Array<{ address: string; amount: string; uiAmount: number }>> {
  const result = (await rpcCall(rpcUrl, 'getTokenLargestAccounts', [
    mint,
    { commitment: 'finalized' },
  ])) as { value: Array<{ address: string; amount: string; uiAmount: number }> }
  return result?.value ?? []
}

/**
 * 通过 Helius DAS getAsset 获取 token name / symbol。
 * 如果失败（新 token 无元数据、网络超时等）静默降级，不阻断主流程。
 */
export async function getTokenMeta(rpcUrl: string, mint: string): Promise<{ name: string; symbol: string }> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id: mint } }),
    })
    if (!res.ok) return { name: '', symbol: '' }
    const data = await res.json() as any
    const meta = data?.result?.content?.metadata
    return {
      name:   meta?.name   ?? '',
      symbol: meta?.symbol ?? '',
    }
  } catch {
    return { name: '', symbol: '' }
  }
}

/**
 * 获取 token decimals（通过解析 mint account 数据）。
 */
export async function getTokenDecimals(rpcUrl: string, mint: string): Promise<number> {
  const result = (await rpcCall(rpcUrl, 'getAccountInfo', [
    mint,
    { encoding: 'jsonParsed', commitment: 'finalized' },
  ])) as { value?: { data?: { parsed?: { info?: { decimals?: number } } } } }
  return result?.value?.data?.parsed?.info?.decimals ?? 6
}

export { LAMPORTS_PER_SOL }
