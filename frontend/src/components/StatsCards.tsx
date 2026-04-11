import type { FlowData } from '../types'

function Card({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="label">{label}</span>
      <span className={`text-xl font-semibold font-mono truncate ${color ?? 'text-slate-100'}`}>
        {value}
      </span>
      {sub && <span className="text-xs text-muted font-mono">{sub}</span>}
    </div>
  )
}

export default function StatsCards({ data }: { data: FlowData }) {
  const { meta } = data

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
      <Card label="Total Volume"   value={fmtToken(meta.totalVolume)}          sub={`${meta.totalFlows} transfers`} />
      <Card label="Transactions"   value={(meta.uniqueSignatures ?? 0).toLocaleString()} sub={`${meta.days}d window`} />
      <Card label="Unique Addrs"   value={(meta.uniqueAddresses  ?? 0).toLocaleString()} sub={`${meta.poolLikeCount ?? 0} pool-like`} color="text-accent" />
      <Card label="Top DEX/Source" value={meta.topSource ?? '—'}               sub={`${meta.topSourceCount ?? 0} events`} color="text-gold" />
      <Card label="Avg per TX"     value={(meta.uniqueSignatures ?? 0) > 0 ? fmtToken(meta.totalVolume / meta.uniqueSignatures) : '—'} sub="tokens / tx" />
    </div>
  )
}

function fmtToken(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}
