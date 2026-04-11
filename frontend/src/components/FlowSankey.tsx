/**
 * Token Flow Graph — ECharts force-directed graph
 *
 * 使用 Graph 而非 Sankey，因为代币流转天然有环（池子既买又卖），
 * Sankey 不支持环，遇到环会静默渲染为空白。
 */
import { useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { FlowEdge, AddressNode } from '../types'

interface Props {
  edges:        FlowEdge[]
  topAddresses: AddressNode[]
  onNodeClick?: (label: string, address: string) => void
  onEdgeClick?: (fromLabel: string, toLabel: string, fromFull: string, toFull: string) => void
}

// 配色方案：与整体 indigo 暗色主题统一，避免荧光色
// Pool-like → indigo (#6366f1) 与 accent 一致
// Net receiver → teal (#2dd4bf) 冷色调，代替荧光绿
// Net sender → 橙红 (#f97316) 暖色，代替 amber
// Others → slate (#475569) 中性
function nodeColor(label: string, topAddresses: AddressNode[]): string {
  if (label === 'Others') return '#475569'
  const node = topAddresses.find(a => a.label === label)
  if (!node) return '#6366f1'
  const total = node.totalSent + node.totalReceived
  if (total === 0) return '#6366f1'
  const symmetry = Math.min(node.totalSent, node.totalReceived) / Math.max(node.totalSent, node.totalReceived)
  if (symmetry > 0.3) return '#6366f1'   // 高对称 = 可能是池子 → indigo
  if (node.netFlow > 0) return '#2dd4bf'  // 净流入 → teal
  return '#f97316'                         // 净流出 → orange
}

function fmtAmount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

export default function FlowSankey({ edges, topAddresses, onNodeClick, onEdgeClick }: Props) {
  // 用 key 强制重新挂载 ECharts，实现布局重置
  const [layoutKey, setLayoutKey] = useState(0)

  if (edges.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted text-sm font-mono">
        No flow data — not enough addresses with mutual transfers
      </div>
    )
  }

  // 从 edges 提取所有唯一节点标签
  const nodeLabels = [...new Set(edges.flatMap(e => [e.from, e.to]))]

  // 节点大小：按吞吐量对数缩放
  const volumeMap = new Map<string, number>()
  for (const e of edges) {
    volumeMap.set(e.from, (volumeMap.get(e.from) ?? 0) + e.amount)
    volumeMap.set(e.to,   (volumeMap.get(e.to)   ?? 0) + e.amount)
  }
  const maxVol = Math.max(...volumeMap.values(), 1)

  const nodes = nodeLabels.map(label => {
    const vol  = volumeMap.get(label) ?? 0
    const size = Math.max(14, Math.log10(vol / maxVol * 1e6 + 1) * 10 + 10)
    const color = nodeColor(label, topAddresses)

    // 从完整地址派生显示标签，始终 6…6，不依赖存储的 label 长度
    const addr = topAddresses.find(a => a.label === label)?.address
    const displayLabel = (addr && addr.length >= 12)
      ? `${addr.slice(0, 6)}…${addr.slice(-6)}`
      : label  // Others 或极短地址直接用 label

    return {
      name:       label,       // 用于边的 source/target 匹配，不能改
      displayLabel,            // 供 formatter 使用
      symbolSize: size,
      itemStyle:  {
        color,
        borderColor: '#0d0d1a',
        borderWidth: 2,
      },
      label: {
        color:      '#e2e8f0',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize:   10,
        position:   size > 26 ? 'inside' : 'right',
        formatter:  (p: any) => p.data.displayLabel,
      },
    }
  })

  // 双向边用 curveness 错开，避免重叠
  const seen = new Set<string>()
  const links = edges.map(e => {
    const rev = `${e.to}||${e.from}`
    const isBidi = edges.some(x => x.from === e.to && x.to === e.from)
    const curve  = isBidi && seen.has(rev) ? -0.2 : (isBidi ? 0.2 : 0.05)
    seen.add(`${e.from}||${e.to}`)
    const width = Math.max(1, Math.log10(e.amount + 1) * 1.5)
    return {
      source:    e.from,
      target:    e.to,
      value:     e.amount,
      fromFull:  e.fromFull,
      toFull:    e.toFull,
      txCount:   e.txCount,
      lineStyle: { width, curveness: curve, opacity: 0.55, color: 'source' },
    }
  })

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1a1a2e',
      borderColor: '#2a2a40',
      textStyle: { color: '#e2e8f0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      formatter: (p: any) => {
        if (p.dataType === 'edge') {
          const from = p.data.fromFull === 'Others' ? 'Others' : p.data.fromFull
          const to   = p.data.toFull   === 'Others' ? 'Others' : p.data.toFull
          return [
            `<b>${p.data.source} → ${p.data.target}</b>`,
            `<span style="color:#8888aa">from:</span> ${from}`,
            `<span style="color:#8888aa">to:</span>   ${to}`,
            `<span style="color:#8888aa">vol:</span>  ${fmtAmount(p.data.value)} tokens`,
            `<span style="color:#8888aa">txns:</span> ${p.data.txCount}`,
          ].join('<br/>')
        }
        // node tooltip
        const node = topAddresses.find(a => a.label === p.name)
        if (!node) return `<b>${p.name}</b>`
        return [
          `<b>${p.name}</b>`,
          `<span style="color:#8888aa">addr:</span> ${node.address}`,
          `<span style="color:#22c55e">recv:</span> ${fmtAmount(node.totalReceived)}`,
          `<span style="color:#f59e0b">sent:</span> ${fmtAmount(node.totalSent)}`,
          `<span style="color:#8888aa">txns:</span> ${node.txCount}`,
        ].join('<br/>')
      },
    },
    series: [{
      type:         'graph',
      layout:       'force',
      roam:         true,
      draggable:    true,
      data:         nodes,
      links,
      edgeSymbol:   ['none', 'arrow'],
      edgeSymbolSize: [0, 7],
      force: {
        repulsion:       300,
        edgeLength:      [60, 160],
        gravity:         0.08,
        layoutAnimation: true,
        friction:        0.6,
      },
      emphasis: {
        focus:     'adjacency',
        lineStyle: { opacity: 0.9 },
      },
      label: {
        show:       true,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize:   10,
      },
    }],
  }

  return (
    <div>
      {/* 图例 + 重置按钮 */}
      <div className="flex gap-4 mb-4 text-xs font-mono text-muted items-center">
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#6366f1] mr-1" />Pool-like</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#2dd4bf] mr-1" />Net receiver</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#f97316] mr-1" />Net sender</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-[#475569] mr-1" />Others</span>
        <span className="ml-auto text-[10px] opacity-60">Drag · Scroll to zoom</span>
        <button
          onClick={() => setLayoutKey(k => k + 1)}
          className="px-2 py-0.5 rounded border border-border text-[10px] text-muted
                     hover:border-accent hover:text-accent transition-colors shrink-0"
          title="Re-randomize force layout"
        >
          ↺ reset layout
        </button>
      </div>
      <ReactECharts
        key={layoutKey}
        option={option}
        style={{ height: '520px', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={{
          click: (params: any) => {
            if (params.dataType === 'node') {
              const label = params.name as string
              if (label === 'Others') return
              const node = topAddresses.find(a => a.label === label)
              if (node) onNodeClick?.(label, node.address)
            } else if (params.dataType === 'edge') {
              const { source, target, fromFull, toFull } = params.data
              if (fromFull === 'Others' || toFull === 'Others') return
              onEdgeClick?.(source, target, fromFull, toFull)
            }
          },
        }}
      />
    </div>
  )
}
