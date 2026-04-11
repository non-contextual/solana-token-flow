/**
 * Express SSE 服务器
 *
 * 端口: 3001（前端通过 Vite proxy 转发 /api/* 请求到此）
 *
 * 接口:
 *   GET /api/fetch?mint=...&days=7&pool=...&limit=3000
 *     → Server-Sent Events 流：实时推送进度，最后 emit done/error 事件
 *
 *   GET /api/data
 *     → 返回最近一次保存的 flow_data.json
 *
 *   GET /api/history
 *     → [{id, mint, mintShort, days, fetchedAt, totalSwaps, totalTxns}] 按时间倒序
 *
 *   GET /api/history/:id
 *     → 加载指定存档的完整 FlowData
 *
 *   DELETE /api/history/:id
 *     → 删除指定存档
 *
 *   GET /api/health
 *     → { ok: true }
 */

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { config as loadEnv } from 'dotenv'
import { runPipeline } from './pipeline'
import type { PipelineEvent } from './pipeline'

loadEnv({ path: path.resolve(__dirname, '../../.env') })

const API_KEY = process.env.HELIUS_API_KEY
if (!API_KEY) {
  console.error('❌  HELIUS_API_KEY not found in .env')
  process.exit(1)
}

const app = express()
app.use(cors())
app.use(express.json())

const ARCHIVE_DIR = path.resolve(__dirname, '../output')

// ── /api/health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, apiKey: `${API_KEY!.slice(0, 8)}...` })
})

// ── /api/history — 返回所有存档的 meta 列表 ──────────────────────────────────
app.get('/api/history', (_req, res) => {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    res.json([])
    return
  }

  const entries = fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((filename) => {
      try {
        const raw = fs.readFileSync(path.join(ARCHIVE_DIR, filename), 'utf-8')
        const data = JSON.parse(raw)
        return { id: filename.replace('.json', ''), ...data.meta }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) =>
      new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime(),
    )

  res.json(entries)
})

// ── /api/history/:id — 加载指定存档 ──────────────────────────────────────────
app.get('/api/history/:id', (req, res) => {
  // 防止路径穿越攻击
  const safeId = path.basename(req.params.id)
  const filepath = path.join(ARCHIVE_DIR, `${safeId}.json`)

  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Archive not found' })
    return
  }

  res.setHeader('Content-Type', 'application/json')
  res.sendFile(filepath)
})

// ── /api/history/:id — 删除指定存档 ──────────────────────────────────────────
app.delete('/api/history/:id', (req, res) => {
  const safeId = path.basename(req.params.id)
  const filepath = path.join(ARCHIVE_DIR, `${safeId}.json`)

  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'Archive not found' })
    return
  }

  fs.unlinkSync(filepath)
  res.json({ ok: true })
})

// ── /api/data — 返回最近一次保存的数据 ────────────────────────────────────────
app.get('/api/data', (_req, res) => {
  const dataPath = path.resolve(__dirname, '../../frontend/public/data/flow_data.json')
  if (fs.existsSync(dataPath)) {
    res.setHeader('Content-Type', 'application/json')
    res.sendFile(dataPath)
  } else {
    res.status(404).json({ error: 'No data yet. Start a fetch first.' })
  }
})

// ── /api/fetch — SSE 进度流 + 最终数据 ────────────────────────────────────────
app.get('/api/fetch', async (req, res) => {
  const {
    mint,
    since:        sinceParam,
    until:        untilParam,
    days         = '7',
    parsePercent = '100',
    sigScanCap   = '',
    minAmount    = '0',
  } = req.query as Record<string, string>

  if (!mint || mint.length < 32) {
    res.status(400).json({ error: 'Invalid mint address' })
    return
  }

  // since/until 优先；否则用 days 往前推
  const nowTs   = Math.floor(Date.now() / 1000)
  const untilTs = untilParam ? parseInt(untilParam) : nowTs
  const sinceTs = sinceParam ? parseInt(sinceParam)
                             : untilTs - Math.min(Math.max(parseInt(days) || 7, 1), 365) * 86400

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // 关闭 nginx 缓冲（如果有反代的话）
  res.flushHeaders()

  // SSE 发送函数
  const sendEvent = (eventName: string, data: unknown) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
    // 手动 flush（部分 Node 版本需要）
    if (typeof (res as any).flush === 'function') (res as any).flush()
  }

  // 连接关闭时（用户离开页面）中止标记
  let aborted = false
  req.on('close', () => { aborted = true })

  try {
    await runPipeline(
      {
        mint,
        since:        sinceTs,
        until:        untilTs,
        parsePercent: Math.min(Math.max(parseInt(parsePercent) || 100, 1), 100),
        sigScanCap:   sigScanCap !== '' ? (parseInt(sigScanCap) || 0) : undefined,
        minAmount:    Math.max(0, parseFloat(minAmount) || 0),
        apiKey:       API_KEY!,
      },
      (event: PipelineEvent) => {
        if (aborted) return
        // 将 pipeline 事件直接透传给前端
        sendEvent(event.type, event)
      },
    )
  } catch (err) {
    if (!aborted) {
      sendEvent('error', { type: 'error', message: (err as Error).message })
    }
  }

  if (!aborted) res.end()
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`\n  🚀  sol-token-flow server`)
  console.log(`  Local: http://localhost:${PORT}`)
  console.log(`  API  : http://localhost:${PORT}/api/fetch?mint=<ADDR>&days=7\n`)
})
