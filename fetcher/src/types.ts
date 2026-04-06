// ── Helius API 原始响应类型 ──────────────────────────────────────────────────

export interface SignatureInfo {
  signature: string
  blockTime: number | null
  err: unknown
  slot: number
  memo: string | null
  confirmationStatus: string
}

export interface HeliusTokenTransfer {
  fromTokenAccount: string
  toTokenAccount:   string
  fromUserAccount:  string
  toUserAccount:    string
  tokenAmount: number      // ⚠️ 已是 UI 格式（Helius 已除 decimals）
  decimals:    number | null
  tokenStandard: string
  mint: string
}

export interface HeliusSwapToken {
  userAccount:   string
  tokenAccount:  string
  mint:          string
  tokenAmount:   number    // events.swap 里是 raw integer，需要自己除 decimals
  decimals?:     number
}

export interface HeliusSwapNative {
  account: string
  amount:  number          // lamports
}

export interface HeliusSwapEvent {
  nativeInput:   HeliusSwapNative | null
  nativeOutput:  HeliusSwapNative | null
  tokenInputs:   HeliusSwapToken[]
  tokenOutputs:  HeliusSwapToken[]
  tokenFees:     HeliusSwapToken[]
  nativeFees:    HeliusSwapNative[]
  innerSwaps:    HeliusSwapEvent[]
}

export interface HeliusTx {
  signature:        string
  timestamp:        number
  type:             string    // "SWAP" | "TRANSFER" | "UNKNOWN" | ...
  source:           string    // "RAYDIUM" | "PUMP_FUN" | "JUPITER" | ...
  fee:              number
  feePayer:         string
  transactionError: unknown
  tokenTransfers:   HeliusTokenTransfer[]
  nativeTransfers:  unknown[]
  accountData:      unknown[]
  events: {
    swap?: HeliusSwapEvent
    [key: string]: unknown
  }
}

// ── 核心输出类型：token 在各地址间的流动 ────────────────────────────────────
//
// 不做 buy/sell 判断，只记录"从哪来、到哪去、多少量"。

export interface TokenFlow {
  signature:   string
  timestamp:   number
  fromAddress: string   // fromUserAccount（优先），否则 fromTokenAccount
  toAddress:   string   // toUserAccount（优先），否则 toTokenAccount
  amount:      number   // UI 格式（Helius 已除 decimals）
  txType:      string   // SWAP / TRANSFER / UNKNOWN
  source:      string   // DEX 或来源
  mint:        string
}

// ── 聚合类型（供前端图表使用）────────────────────────────────────────────────

export interface HourlyVolume {
  hour:        string   // ISO 字符串，精确到小时
  ts:          number   // Unix 时间戳
  totalAmount: number   // 该小时内所有 transfer 的 token 数量之和
  txCount:     number
}

export interface AddressNode {
  address:       string
  label:         string   // 缩写显示标签
  totalSent:     number
  totalReceived: number
  netFlow:       number   // received - sent（正 = 净流入）
  txCount:       number
}

export interface FlowEdge {
  from:    string   // label（缩写地址）
  to:      string
  fromFull: string  // 完整地址（tooltip 用）
  toFull:   string
  amount:  number
  txCount: number
}

// ── 最终输出结构 ──────────────────────────────────────────────────────────────

export interface FlowData {
  meta: {
    mint:              string
    mintShort:         string
    days:              number
    fetchedAt:         string
    sinceTimestamp:    number
    addressFetched:    string
    tokenName:         string   // 来自 Helius DAS，可能为空
    tokenSymbol:       string
    totalTxns:         number
    totalFlows:        number   // token transfer 事件数
    since:             number   // Unix 秒（查询起始）
    until:             number   // Unix 秒（查询截止）
    // 聚合统计（供 StatsCards 使用，避免前端 reduce 原始 flows）
    totalVolume:       number
    uniqueAddresses:   number
    uniqueSignatures:  number
    topSource:         string
    topSourceCount:    number
    poolLikeCount:     number
  }
  flows:        TokenFlow[]
  hourlyVolume: HourlyVolume[]
  topAddresses: AddressNode[]
  edges:        FlowEdge[]
}
