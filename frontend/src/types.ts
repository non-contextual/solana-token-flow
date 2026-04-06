export interface TokenFlow {
  signature:   string
  timestamp:   number
  fromAddress: string
  toAddress:   string
  amount:      number
  txType:      string
  source:      string
  mint:        string
}

export interface HourlyVolume {
  hour:        string
  ts:          number
  totalAmount: number
  txCount:     number
}

export interface AddressNode {
  address:       string
  label:         string
  totalSent:     number
  totalReceived: number
  netFlow:       number
  txCount:       number
}

export interface FlowEdge {
  from:     string
  to:       string
  fromFull: string
  toFull:   string
  amount:   number
  txCount:  number
}

export interface FlowData {
  meta: {
    mint:             string
    mintShort:        string
    days:             number
    fetchedAt:        string
    sinceTimestamp:   number
    addressFetched:   string
    tokenName?:       string   // 可能为空（旧数据无此字段）
    tokenSymbol?:     string
    totalTxns:        number
    totalFlows:       number
    since?:           number   // Unix 秒（旧数据可能无此字段）
    until?:           number
    // 聚合统计（后端预计算，前端直接用）
    totalVolume:      number
    uniqueAddresses:  number
    uniqueSignatures: number
    topSource:        string
    topSourceCount:   number
    poolLikeCount:    number
  }
  flows:        TokenFlow[]
  hourlyVolume: HourlyVolume[]
  topAddresses: AddressNode[]
  edges:        FlowEdge[]
}
