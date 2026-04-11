import { useState } from 'react'
import type { AddressNode } from '../types'
import { displayAddr } from '../utils/format'

type SortKey = 'total' | 'received' | 'sent' | 'net' | 'txCount'

function fmtAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

// 根据 sent/received 比例判断地址角色
type Role = 'Buyer' | 'Seller' | 'LP' | 'Trader'

function getRole(node: AddressNode): Role {
  const maxSide = Math.max(node.totalSent, node.totalReceived, 1)
  const ratio   = Math.abs(node.netFlow) / maxSide
  if (ratio > 0.5) return node.netFlow > 0 ? 'Buyer' : 'Seller'
  if (ratio < 0.1) return 'LP'
  return 'Trader'
}

const ROLE_STYLE: Record<Role, string> = {
  Buyer:  'text-[#2dd4bf]  bg-[#2dd4bf]/10',
  Seller: 'text-[#f97316]  bg-[#f97316]/10',
  LP:     'text-purple-400 bg-purple-400/10',
  Trader: 'text-slate-400  bg-slate-400/10',
}

function RoleBadge({ node }: { node: AddressNode }) {
  const role = getRole(node)
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 ${ROLE_STYLE[role]}`}>
      {role}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title={`Copy: ${text}`}
      className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors
                 text-muted hover:text-accent hover:bg-accent/10 shrink-0"
    >
      {copied ? '✓' : 'copy'}
    </button>
  )
}

function SortHeader({
  label, sortKey, current, onSort,
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th
      className={`text-right py-2 pr-3 cursor-pointer select-none transition-colors
                  ${active ? 'text-accent' : 'text-muted hover:text-slate-300'}`}
      onClick={() => onSort(sortKey)}
    >
      {label}{active ? ' ↓' : ''}
    </th>
  )
}

export default function TopAddresses({ addresses }: { addresses: AddressNode[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [query, setQuery]     = useState('')

  if (addresses.length === 0) {
    return <div className="h-40 flex items-center justify-center text-muted text-sm font-mono">No data</div>
  }

  const q = query.trim().toLowerCase()

  const sorted = [...addresses]
    .filter(a => !q || a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q))
    .sort((a, b) => {
      switch (sortKey) {
        case 'received': return b.totalReceived - a.totalReceived
        case 'sent':     return b.totalSent     - a.totalSent
        case 'net':      return b.netFlow        - a.netFlow
        case 'txCount':  return b.txCount        - a.txCount
        default:         return (b.totalSent + b.totalReceived) - (a.totalSent + a.totalReceived)
      }
    })
    .slice(0, 30)

  // maxTotal 用于归一化 bar 宽度（代表总量最大的地址 = bar 满宽）
  const maxTotal = Math.max(...sorted.map(a => a.totalSent + a.totalReceived), 1)

  return (
    <div className="space-y-3">
      {/* 搜索框 */}
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter by label or address…"
        className="w-full max-w-xs bg-surface border border-border rounded px-3 py-1.5
                   font-mono text-xs text-slate-200 placeholder-muted
                   focus:outline-none focus:border-accent transition-colors"
      />

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-3 w-6 text-muted">#</th>
              <th className="text-left py-2 pr-4 text-muted">Address</th>
              <SortHeader label="Received" sortKey="received" current={sortKey} onSort={setSortKey} />
              <SortHeader label="Sent"     sortKey="sent"     current={sortKey} onSort={setSortKey} />
              <SortHeader label="Net"      sortKey="net"      current={sortKey} onSort={setSortKey} />
              <SortHeader label="TXs"      sortKey="txCount"  current={sortKey} onSort={setSortKey} />
              <th className="py-2 w-40 text-muted text-left pl-1">Volume</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-muted text-xs font-mono">No matches</td></tr>
            )}
            {sorted.map((node, i) => {
              const total    = node.totalSent + node.totalReceived
              // bar 总宽度 = total 相对于 maxTotal 的比例（满宽 = 144px）
              // 内部按 recv:sent 比例分段，消除原来两段独立百分比的溢出 bug
              const barWidthPct = (total / maxTotal) * 100
              const recvFrac    = total > 0 ? (node.totalReceived / total) * 100 : 50
              const sentFrac    = total > 0 ? (node.totalSent     / total) * 100 : 50

              const net      = node.netFlow
              const netColor = net > 0 ? 'text-[#2dd4bf]' : net < 0 ? 'text-[#f97316]' : 'text-muted'
              const netStr   = net > 0 ? `+${fmtAmount(net)}` : fmtAmount(net)

              return (
                <tr
                  key={node.address}
                  className="border-b border-border/40 hover:bg-card/60 transition-colors"
                >
                  <td className="py-2 pr-3 text-muted">{i + 1}</td>

                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-1">
                      {/* 地址缩写 → gmgn.ai 链接 */}
                      <a
                        href={`https://gmgn.ai/sol/address/${node.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={node.address}
                        className="text-slate-300 hover:text-accent transition-colors"
                      >
                        {displayAddr(node.address)}
                      </a>
                      <RoleBadge node={node} />
                      <CopyButton text={node.address} />
                    </div>
                  </td>

                  <td className="py-2 pr-3 text-right text-[#2dd4bf]">{fmtAmount(node.totalReceived)}</td>
                  <td className="py-2 pr-3 text-right text-[#f97316]">{fmtAmount(node.totalSent)}</td>
                  <td className={`py-2 pr-3 text-right ${netColor}`}>{netStr}</td>
                  <td className="py-2 pr-3 text-right text-muted">{node.txCount}</td>

                  {/* mini bar：总宽代表体量，内部颜色比例代表方向 */}
                  <td className="py-2 pl-1">
                    <div className="h-3 w-36 rounded overflow-hidden bg-border/20">
                      <div
                        className="flex h-full rounded overflow-hidden"
                        style={{ width: `${barWidthPct}%` }}
                      >
                        <div
                          className="bg-[#2dd4bf]/70 h-full"
                          style={{ width: `${recvFrac}%` }}
                          title={`Recv ${fmtAmount(node.totalReceived)}`}
                        />
                        <div
                          className="bg-[#f97316]/70 h-full"
                          style={{ width: `${sentFrac}%` }}
                          title={`Sent ${fmtAmount(node.totalSent)}`}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
