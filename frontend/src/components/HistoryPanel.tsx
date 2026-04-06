import { useState, useEffect } from 'react'
import type { FlowData } from '../types'
import { loadLocalHistory, deleteFromLocalHistory, type LocalHistoryRecord } from '../utils/localHistory'

interface Props {
  refreshTrigger: number
  onLoad: (data: FlowData) => void
}

export default function HistoryPanel({ refreshTrigger, onLoad }: Props) {
  const [records, setRecords] = useState<LocalHistoryRecord[]>([])

  // 初次加载 + 每次爬取完成后刷新
  useEffect(() => {
    setRecords(loadLocalHistory())
  }, [refreshTrigger])

  function handleDelete(id: string) {
    deleteFromLocalHistory(id)
    setRecords(prev => prev.filter(r => r.id !== id))
  }

  if (records.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="label">Recent Fetches</span>
        <span className="text-xs font-mono text-muted">{records.length} saved locally</span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {records.map((record) => (
          <HistoryCard
            key={record.id}
            record={record}
            onLoad={() => onLoad(record.data)}
            onDelete={() => handleDelete(record.id)}
          />
        ))}
      </div>
    </div>
  )
}

function fmtAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(0)
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function HistoryCard({
  record,
  onLoad,
  onDelete,
}: {
  record: LocalHistoryRecord
  onLoad: () => void
  onDelete: () => void
}) {
  const { meta } = record.data

  // 身份标识：优先 symbol，其次 mintShort
  const identity = meta.tokenSymbol
    ? { primary: meta.tokenSymbol, secondary: meta.tokenName && meta.tokenName !== meta.tokenSymbol ? meta.tokenName : meta.mintShort }
    : { primary: meta.mintShort ?? meta.mint.slice(0, 12) + '…', secondary: '' }

  // 时间范围：优先 since/until，否则回退到 days
  const rangeStr = meta.since && meta.until
    ? `${fmtDate(meta.since)} → ${fmtDate(meta.until)}`
    : `last ${meta.days}d`

  // 抓取时间
  const fetchedAt = new Date(meta.fetchedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <div
      className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5
                 hover:border-accent/40 transition-colors group cursor-pointer"
      onClick={onLoad}
    >
      {/* 内容区 */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* 第一行：token 身份 */}
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-sm font-semibold text-slate-100 shrink-0">
            {identity.primary}
          </span>
          {identity.secondary && (
            <span className="font-mono text-[11px] text-muted truncate" title={meta.mint}>
              {identity.secondary}
            </span>
          )}
        </div>

        {/* 第二行：时间范围 + 关键指标 */}
        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-mono text-muted">
          <span className="text-accent">{rangeStr}</span>
          <span>·</span>
          <span>{meta.totalFlows.toLocaleString()} transfers</span>
          {meta.totalVolume > 0 && (
            <>
              <span>·</span>
              <span className="text-slate-300">{fmtAmount(meta.totalVolume)} tokens</span>
            </>
          )}
          {meta.topSource && meta.topSource !== '—' && (
            <>
              <span>·</span>
              <span>{meta.topSource}</span>
            </>
          )}
          <span>·</span>
          <span>{fetchedAt}</span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        <button
          onClick={onLoad}
          className="px-3 py-1 rounded text-xs font-mono bg-accent/10 text-accent
                     hover:bg-accent hover:text-white transition-colors"
        >
          Load
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded text-xs font-mono text-muted
                     hover:bg-sell/10 hover:text-sell transition-colors
                     opacity-0 group-hover:opacity-100"
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
