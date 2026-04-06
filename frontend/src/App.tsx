import { useState, useEffect } from 'react'
import type { FlowData } from './types'
import FetchForm from './components/FetchForm'
import Dashboard from './components/Dashboard'

type AppState = 'form' | 'fetching' | 'done'

function getUrlParams() {
  const p = new URLSearchParams(window.location.search)
  return {
    mint:  p.get('mint') ?? '',
    since: p.get('since') ? parseInt(p.get('since')!) : undefined,
    until: p.get('until') ? parseInt(p.get('until')!) : undefined,
  }
}

function pushUrlState(mint: string, since?: number, until?: number) {
  const url = new URL(window.location.href)
  if (mint) {
    url.searchParams.set('mint', mint)
    if (since && until) {
      url.searchParams.set('since', String(since))
      url.searchParams.set('until', String(until))
    } else {
      url.searchParams.delete('since')
      url.searchParams.delete('until')
    }
  } else {
    url.searchParams.delete('mint')
    url.searchParams.delete('since')
    url.searchParams.delete('until')
  }
  window.history.replaceState(null, '', url.toString())
}

export default function App() {
  const [state, setState] = useState<AppState>('form')
  const [data, setData]   = useState<FlowData | null>(null)
  const [urlParams, setUrlParams] = useState<ReturnType<typeof getUrlParams> | null>(null)

  useEffect(() => {
    setUrlParams(getUrlParams())
  }, [])

  function handleDone(flowData: FlowData) {
    setData(flowData)
    setState('done')
    pushUrlState(flowData.meta.mint, flowData.meta.since, flowData.meta.until)  // undefined-safe
  }

  function handleReset() {
    setData(null)
    setState('form')
    pushUrlState('', 0, 0)
  }

  if (state === 'done' && data) {
    return <Dashboard data={data} onBack={handleReset} />
  }

  // 等 URL params 解析完再渲染，确保 initialMint 正确传入 useState
  if (urlParams === null) return null

  return (
    <FetchForm
      initialMint={urlParams?.mint ?? ''}
      initialSince={urlParams?.since}
      initialUntil={urlParams?.until}
      onFetching={() => setState('fetching')}
      onDone={handleDone}
    />
  )
}
