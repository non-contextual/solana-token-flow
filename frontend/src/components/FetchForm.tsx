import { useState, useRef, useEffect } from 'react'
import type { FlowData } from '../types'
import HistoryPanel from './HistoryPanel'
import { saveToLocalHistory } from '../utils/localHistory'
import { toDatetimeLocal, fromDatetimeLocal, resolveDefaultUntil } from '../utils/time'

interface Props {
  initialMint?:  string
  initialSince?: number   // Unix 秒
  initialUntil?: number   // Unix 秒
  onFetching: () => void
  onDone: (data: FlowData) => void
}

interface LogEntry {
  id: number
  level: 'info' | 'warn' | 'error' | 'system'
  message: string
  ts: string
}

interface ProgressState {
  step: number
  totalSteps: number
  label: string
  progressDone: number
  progressTotal: number
}


const PRESETS = [
  { label: '1h',  seconds: 3600 },
  { label: '6h',  seconds: 6 * 3600 },
  { label: '1d',  seconds: 86400 },
  { label: '3d',  seconds: 3 * 86400 },
  { label: '7d',  seconds: 7 * 86400 },
  { label: '14d', seconds: 14 * 86400 },
  { label: '30d', seconds: 30 * 86400 },
]

let logIdSeq = 0

export default function FetchForm({ initialMint = '', initialSince, initialUntil, onFetching, onDone }: Props) {
  const now = new Date()
  const defaultUntil = resolveDefaultUntil(initialUntil, now)
  const defaultSince = initialSince ? new Date(initialSince * 1000) : new Date(now.getTime() - 7 * 86400 * 1000)

  const [mint, setMint]     = useState(initialMint)
  const [since, setSince]   = useState(toDatetimeLocal(defaultSince))
  const [until, setUntil]   = useState(toDatetimeLocal(defaultUntil))
  const [parsePercent, setParsePercent] = useState(100)
  const [scanMode, setScanMode]         = useState(2)   // index into SCAN_MODES, default = Deep
  const [minAmount, setMinAmount]       = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const SCAN_MODES = [
    { label: 'Fast',  cap: 3_000,  desc: 'Newest ~3k sigs only' },
    { label: 'Light', cap: 10_000, desc: 'Scan up to 10k sigs' },
    { label: 'Deep',  cap: 30_000, desc: 'Scan up to 30k sigs (default)' },
    { label: 'Full',  cap: 0,      desc: 'Scan all sigs in the time window' },
  ]

  const [isFetching, setIsFetching] = useState(false)
  const [logs, setLogs]     = useState<LogEntry[]>([])
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [hasError, setHasError] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)

  // 检查后端健康状态
  useEffect(() => {
    fetch('/api/health').then(r => setBackendOk(r.ok)).catch(() => setBackendOk(false))
  }, [])

  const logsEndRef = useRef<HTMLDivElement>(null)
  const esRef      = useRef<EventSource | null>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function applyPreset(seconds: number) {
    const end   = new Date()
    const start = new Date(end.getTime() - seconds * 1000)
    setUntil(toDatetimeLocal(end))
    setSince(toDatetimeLocal(start))
  }

  function addLog(message: string, level: LogEntry['level'] = 'info') {
    setLogs((prev) => [
      ...prev,
      {
        id: ++logIdSeq,
        level,
        message,
        ts: new Date().toLocaleTimeString('en-US', { hour12: false }),
      },
    ])
  }

  function handleFetch() {
    if (!mint.trim() || isFetching) return

    esRef.current?.close()
    setLogs([])
    setProgress(null)
    setHasError(false)
    setIsFetching(true)
    onFetching()

    addLog(`Starting fetch for ${mint.trim()}`, 'system')

    const sinceTs = fromDatetimeLocal(since)
    const untilTs = fromDatetimeLocal(until)

    if (untilTs <= sinceTs) {
      addLog('End time must be after start time', 'error')
      setIsFetching(false)
      setHasError(true)
      return
    }

    const params = new URLSearchParams({
      mint:         mint.trim(),
      since:        String(sinceTs),
      until:        String(untilTs),
      parsePercent: String(parsePercent),
      sigScanCap:   String(SCAN_MODES[scanMode].cap),
      minAmount:    String(minAmount),
    })

    const es = new EventSource(`/api/fetch?${params}`)
    esRef.current = es

    es.addEventListener('log', (e) => {
      const d = JSON.parse(e.data) as { level: LogEntry['level']; message: string }
      addLog(d.message, d.level)
    })

    es.addEventListener('step', (e) => {
      const d = JSON.parse(e.data) as { step: number; total: number; label: string }
      setProgress({
        step: d.step,
        totalSteps: d.total,
        label: d.label,
        progressDone: 0,
        progressTotal: 100,
      })
    })

    es.addEventListener('progress', (e) => {
      const d = JSON.parse(e.data) as { label: string; done: number; total: number }
      setProgress((prev) =>
        prev ? { ...prev, progressDone: d.done, progressTotal: d.total } : null,
      )
    })

    es.addEventListener('done', async (e) => {
      const d = JSON.parse(e.data) as { type: 'done'; data: FlowData }
      addLog('✓ Fetch complete! Loading visualization...', 'system')
      es.close()
      setIsFetching(false)
      let fullData = d.data
      try {
        const res = await fetch('/api/data')
        if (res.ok) fullData = await res.json()
      } catch { /* fallback */ }
      saveToLocalHistory(fullData)
      setHistoryRefresh((n) => n + 1)
      setTimeout(() => onDone(fullData), 600)
    })

    es.addEventListener('error', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { message: string }
        addLog(`Error: ${d.message}`, 'error')
      } catch {
        addLog('Connection lost or unknown error', 'error')
      }
      es.close()
      setIsFetching(false)
      setHasError(true)
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED && isFetching) {
        addLog('Connection closed unexpectedly. Is the backend server running?', 'error')
        setIsFetching(false)
        setHasError(true)
      }
    }
  }

  function handleCancel() {
    esRef.current?.close()
    setIsFetching(false)
    addLog('Cancelled by user', 'warn')
  }

  const isValid   = mint.trim().length >= 32
  const rangeOk   = fromDatetimeLocal(until) > fromDatetimeLocal(since)

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <span className="font-mono font-semibold text-accent tracking-wider uppercase text-sm">
          Sol Token Flow
        </span>
      </header>

      <div className="flex-1 flex items-start justify-center pt-16 px-4">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold text-slate-100">Analyze Token Flow</h1>
            <p className="text-muted text-sm font-mono">
              Crawl and visualize buy/sell activity for any Solana meme token
            </p>
          </div>

          <div className="card space-y-5">
            {/* Mint address */}
            <div className="space-y-2">
              <label className="label">Token Mint Address *</label>
              <input
                type="text"
                value={mint}
                onChange={(e) => setMint(e.target.value)}
                placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
                className="w-full bg-surface border border-border rounded-lg px-4 py-3
                           font-mono text-sm text-slate-200 placeholder-muted
                           focus:outline-none focus:border-accent transition-colors"
                disabled={isFetching}
              />
            </div>

            {/* Time Range */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="label">Time Range</label>
                <span className="text-[10px] text-muted font-mono">your local timezone</span>
              </div>

              {/* Quick presets */}
              <div className="flex gap-1.5 flex-wrap">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p.seconds)}
                    disabled={isFetching}
                    className="px-3 py-2.5 min-h-[44px] rounded font-mono text-xs border transition-colors
                               bg-surface border-border text-muted
                               hover:border-accent hover:text-slate-200 disabled:opacity-40
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Datetime pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] text-muted font-mono uppercase tracking-wider">From</span>
                  <input
                    type="datetime-local"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                    disabled={isFetching}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5
                               font-mono text-xs text-slate-200
                               focus:outline-none focus:border-accent transition-colors
                               disabled:opacity-40
                               [color-scheme:dark]"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-muted font-mono uppercase tracking-wider">To</span>
                  <input
                    type="datetime-local"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    disabled={isFetching}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5
                               font-mono text-xs text-slate-200
                               focus:outline-none focus:border-accent transition-colors
                               disabled:opacity-40
                               [color-scheme:dark]"
                  />
                </div>
              </div>

              {!rangeOk && since && until && (
                <p className="text-[11px] text-sell font-mono">End time must be after start time</p>
              )}
            </div>

            {/* Advanced options */}
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs font-mono text-muted hover:text-slate-300 transition-colors flex items-center gap-1 py-2 -my-1 focus-visible:outline-none focus-visible:text-accent"
              disabled={isFetching}
            >
              <span className="text-accent">{showAdvanced ? '▾' : '▸'}</span>
              Advanced options
            </button>

            {showAdvanced && (
              <div className="space-y-5 border-t border-border pt-4">

                {/* Scan Depth */}
                <div className="space-y-2">
                  <label className="label">Scan Depth</label>
                  <div className="flex gap-1.5">
                    {SCAN_MODES.map((mode, i) => (
                      <button
                        key={mode.label}
                        onClick={() => setScanMode(i)}
                        disabled={isFetching}
                        className={`px-3 py-2 rounded font-mono text-xs border transition-colors
                          ${scanMode === i
                            ? 'bg-accent/20 border-accent text-accent'
                            : 'bg-surface border-border text-muted hover:border-accent hover:text-slate-200'
                          } disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted font-mono">{SCAN_MODES[scanMode].desc}</p>
                </div>

                {/* Parse % slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="label">Parse Depth</label>
                    <span className="font-mono text-sm text-accent font-semibold">{parsePercent}%</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={parsePercent}
                    onChange={(e) => setParsePercent(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                    disabled={isFetching}
                  />
                  <div className="flex justify-between text-[10px] font-mono text-muted">
                    <span>10% fastest</span>
                    <span>100% complete</span>
                  </div>
                  <p className="text-xs text-muted font-mono">
                    {parsePercent === 100
                      ? 'Parse all scanned sigs'
                      : `Parse ${parsePercent}% of scanned sigs, uniformly sampled across time`
                    }
                    <span className="text-slate-600"> · max 10,000 txns</span>
                  </p>
                </div>

                {/* Min amount */}
                <div className="space-y-2">
                  <label className="label">Min Token Amount per Transfer</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={minAmount || ''}
                    placeholder="0"
                    onChange={(e) => setMinAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-40 bg-surface border border-border rounded-lg px-4 py-2.5
                               font-mono text-sm text-slate-200
                               focus:outline-none focus:border-accent transition-colors"
                    disabled={isFetching}
                  />
                  <p className="text-xs text-muted font-mono">
                    Filter out small transfers — 0 = show all
                  </p>
                </div>
              </div>
            )}

            {/* Fetch button */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleFetch}
                disabled={!isValid || !rangeOk || isFetching}
                className={`flex-1 py-3 rounded-lg font-mono font-semibold text-sm transition-all
                  ${isValid && rangeOk && !isFetching
                    ? 'bg-accent hover:bg-indigo-500 text-white cursor-pointer'
                    : 'bg-border text-muted cursor-not-allowed'
                  }`}
              >
                {isFetching ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Fetching...
                  </span>
                ) : 'Fetch & Analyze'}
              </button>

              {isFetching && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-3 rounded-lg border border-border text-muted
                             font-mono text-sm hover:border-sell hover:text-sell transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {progress && isFetching && (
            <div className="card space-y-2">
              <div className="flex justify-between text-xs font-mono text-muted">
                <span>Step {progress.step}/{progress.totalSteps}: {progress.label}</span>
                {progress.progressTotal > 0 && (
                  <span>{progress.progressDone.toLocaleString()} / {progress.progressTotal.toLocaleString()}</span>
                )}
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{
                    width: `${
                      progress.progressTotal > 0
                        ? Math.min(100, (progress.progressDone / progress.progressTotal) * 100)
                        : (progress.step / progress.totalSteps) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Terminal log */}
          {logs.length > 0 && (
            <div className="card bg-[#0a0a14]">
              <div className="flex items-center justify-between mb-3">
                <span className="label">Output</span>
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
              </div>
              <div className="h-64 overflow-y-auto space-y-0.5 font-mono text-xs pr-1">
                {logs.map((entry) => (
                  <div key={entry.id} className="flex gap-3 leading-5">
                    <span className="text-[#444466] shrink-0">{entry.ts}</span>
                    <span className={
                      entry.level === 'error' ? 'text-sell' :
                      entry.level === 'warn'  ? 'text-gold' :
                      entry.level === 'system'? 'text-accent' : 'text-slate-400'
                    }>
                      {entry.level === 'system' ? '›' : entry.level === 'warn' ? '!' : entry.level === 'error' ? '✕' : ' '}
                    </span>
                    <span className={
                      entry.level === 'error' ? 'text-sell' :
                      entry.level === 'warn'  ? 'text-yellow-300' :
                      entry.level === 'system'? 'text-slate-200' : 'text-slate-400'
                    }>
                      {entry.message}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Error retry hint */}
          {hasError && (
            <div className="card border-sell/30 text-center space-y-2">
              <p className="text-sell text-sm font-mono">Fetch failed. Check the log above.</p>
              <p className="text-muted text-xs font-mono">
                Make sure the backend is running:
                <code className="ml-2 bg-surface px-2 py-0.5 rounded text-accent">npm run serve</code>
              </p>
            </div>
          )}

          {/* History panel */}
          <div className="card">
            <HistoryPanel refreshTrigger={historyRefresh} onLoad={(data) => onDone(data)} />
          </div>

          {backendOk === false && (
            <p className="text-center text-muted text-xs font-mono pb-8">
              Backend must be running on port 3001 ·{' '}
              <code className="text-accent">npm run serve</code>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
