import { useState } from 'react'
import type { FlowData } from '../types'
import StatsCards from './StatsCards'
import VolumeTimeline from './VolumeTimeline'
import FlowSankey from './FlowSankey'
import TopAddresses from './TopAddresses'
import DetailDrawer, { type DrawerTarget } from './DetailDrawer'

interface Props {
  data: FlowData
  onBack?: () => void
}

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function Dashboard({ data, onBack }: Props) {
  const { meta } = data
  const fetchedAt = new Date(meta.fetchedAt).toLocaleString()
  // 显示范围：优先用 since/until，无则回退到 days（兼容旧数据）
  const rangeLabel = (meta.since && meta.until)
    ? `${fmtTs(meta.since)} → ${fmtTs(meta.until)}`
    : `last ${meta.days}d`
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null)

  function handleNodeClick(label: string, address: string) {
    setDrawer({ type: 'node', label, address })
  }

  function handleEdgeClick(fromLabel: string, toLabel: string, fromFull: string, toFull: string) {
    setDrawer({ type: 'edge', fromLabel, toLabel, fromFull, toFull })
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="border-b border-border sticky top-0 z-10 bg-surface/90 backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="text-muted hover:text-slate-200 font-mono text-xs transition-colors"
              >
                ← New
              </button>
            )}
            <span className="text-accent font-mono font-semibold text-sm tracking-wider uppercase">
              Sol Token Flow
            </span>
            {/* token 名称（如果有） */}
            {meta.tokenSymbol && (
              <span className="font-mono text-sm font-semibold text-slate-100">
                {meta.tokenSymbol}
                {meta.tokenName && meta.tokenName !== meta.tokenSymbol && (
                  <span className="text-muted font-normal text-xs ml-1">{meta.tokenName}</span>
                )}
              </span>
            )}
            <span className="font-mono text-xs text-muted" title={meta.mint}>
              {meta.mintShort}
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs font-mono text-muted">
            <span className="text-slate-300">{rangeLabel}</span>
            <span>updated <span className="text-slate-300">{fetchedAt}</span></span>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        <StatsCards data={data} />

        <section className="card">
          <h2 className="label mb-1">Token Flow Graph</h2>
          <p className="text-muted text-xs font-mono mb-4">
            Each node is an address · Edge width = token volume · Click node or edge for details
          </p>
          <FlowSankey
            edges={data.edges}
            topAddresses={data.topAddresses}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
          />
        </section>

        <section className="card">
          <h2 className="label mb-4">Transfer Volume (tokens / hour)</h2>
          <VolumeTimeline buckets={data.hourlyVolume} />
        </section>

        <section className="card">
          <h2 className="label mb-4">Top Addresses by Volume</h2>
          <TopAddresses addresses={data.topAddresses} />
        </section>
      </main>

      <footer className="border-t border-border mt-8 py-4 text-center text-muted text-xs font-mono">
        {meta.totalTxns} txns · {meta.totalFlows} token flows · via{' '}
        <span className="text-accent">Helius</span>
      </footer>

      <DetailDrawer
        target={drawer}
        flows={data.flows}
        topAddresses={data.topAddresses}
        onClose={() => setDrawer(null)}
      />
    </div>
  )
}
