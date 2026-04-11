// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { saveToLocalHistory, loadLocalHistory, deleteFromLocalHistory } from './localHistory'
import type { FlowData } from '../types'

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function makeFlowData(mint: string, days = 7, overrides: Partial<FlowData['meta']> = {}): FlowData {
  return {
    meta: {
      mint,
      mintShort:       `${mint.slice(0, 6)}...${mint.slice(-4)}`,
      days,
      fetchedAt:       new Date().toISOString(),
      sinceTimestamp:  1700000000,
      addressFetched:  mint,
      tokenName:       'Test Token',
      tokenSymbol:     'TEST',
      totalTxns:       10,
      totalFlows:      20,
      since:           1700000000,
      until:           1700100000,
      totalVolume:     1000,
      uniqueAddresses: 5,
      uniqueSignatures: 10,
      topSource:       'RAYDIUM',
      topSourceCount:  8,
      poolLikeCount:   2,
      ...overrides,
    },
    flows:        [],
    hourlyVolume: [],
    topAddresses: [],
    edges:        [],
  }
}

beforeEach(() => {
  localStorage.clear()
})

// ─── 基本读写 ─────────────────────────────────────────────────────────────────

describe('loadLocalHistory', () => {
  it('localStorage 为空时返回 []', () => {
    expect(loadLocalHistory()).toEqual([])
  })

  it('localStorage 中有无效 JSON 时返回 []', () => {
    localStorage.setItem('sol-token-flow-history', 'not-json{{{')
    expect(loadLocalHistory()).toEqual([])
  })

  it('localStorage 中是非数组 JSON 时返回 []', () => {
    localStorage.setItem('sol-token-flow-history', JSON.stringify({ wrong: true }))
    expect(loadLocalHistory()).toEqual([])
  })
})

describe('saveToLocalHistory', () => {
  it('保存后 loadLocalHistory 能读回数据', () => {
    const data = makeFlowData('mint1111111111111111111111111111111111111111')
    saveToLocalHistory(data)
    const records = loadLocalHistory()
    expect(records).toHaveLength(1)
    expect(records[0].data.meta.mint).toBe(data.meta.mint)
  })

  it('返回唯一 id 字符串', () => {
    const data = makeFlowData('mint1111111111111111111111111111111111111111')
    const id = saveToLocalHistory(data)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('两次保存产生不同 id', async () => {
    const data = makeFlowData('mintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    const id1 = saveToLocalHistory(data)
    await new Promise(r => setTimeout(r, 2))  // 等 1ms 确保 Date.now() 不同
    const id2 = saveToLocalHistory(data)
    // 同一 mint+days 会被去重替换，仍只有一条
    const records = loadLocalHistory()
    expect(records).toHaveLength(1)
    // 新 id 替换了旧 id
    expect(records[0].id).toBe(id2)
  })

  it('新记录出现在最前面（倒序）', () => {
    const data1 = makeFlowData('mint1111111111111111111111111111111111111111')
    const data2 = makeFlowData('mint2222222222222222222222222222222222222222')
    saveToLocalHistory(data1)
    saveToLocalHistory(data2)
    const records = loadLocalHistory()
    expect(records[0].data.meta.mint).toBe(data2.meta.mint)
    expect(records[1].data.meta.mint).toBe(data1.meta.mint)
  })
})

// ─── 去重逻辑 ─────────────────────────────────────────────────────────────────

describe('saveToLocalHistory — 去重', () => {
  it('相同 mint + days 的旧记录被替换', () => {
    const mint = 'mintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const data1 = makeFlowData(mint, 7, { totalFlows: 10 })
    const data2 = makeFlowData(mint, 7, { totalFlows: 20 })
    saveToLocalHistory(data1)
    saveToLocalHistory(data2)
    const records = loadLocalHistory()
    expect(records).toHaveLength(1)
    expect(records[0].data.meta.totalFlows).toBe(20)
  })

  it('相同 mint 但不同 days → 不去重，两条都保留', () => {
    const mint = 'mintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    saveToLocalHistory(makeFlowData(mint, 7))
    saveToLocalHistory(makeFlowData(mint, 14))
    expect(loadLocalHistory()).toHaveLength(2)
  })

  it('不同 mint → 不去重', () => {
    saveToLocalHistory(makeFlowData('mint1111111111111111111111111111111111111111'))
    saveToLocalHistory(makeFlowData('mint2222222222222222222222222222222222222222'))
    expect(loadLocalHistory()).toHaveLength(2)
  })
})

// ─── 上限控制 ─────────────────────────────────────────────────────────────────

describe('saveToLocalHistory — MAX_RECORDS = 8', () => {
  it('保存超过 8 条时最旧的被丢弃', () => {
    for (let i = 0; i < 10; i++) {
      const mint = `mint${String(i).padStart(40, '0')}`
      saveToLocalHistory(makeFlowData(mint))
    }
    expect(loadLocalHistory()).toHaveLength(8)
  })

  it('超出后保留的是最新的 8 条', () => {
    const mints = Array.from({ length: 10 }, (_, i) => `mint${String(i).padStart(40, '0')}`)
    for (const mint of mints) saveToLocalHistory(makeFlowData(mint))
    const records = loadLocalHistory()
    const savedMints = records.map(r => r.data.meta.mint)
    // 最新的 8 条是 mints[2..9]（mints[0], mints[1] 被丢弃）
    expect(savedMints).toContain(mints[9])
    expect(savedMints).toContain(mints[2])
    expect(savedMints).not.toContain(mints[0])
    expect(savedMints).not.toContain(mints[1])
  })
})

// ─── 删除 ─────────────────────────────────────────────────────────────────────

describe('deleteFromLocalHistory', () => {
  it('按 id 删除指定记录', () => {
    const data1 = makeFlowData('mint1111111111111111111111111111111111111111')
    const data2 = makeFlowData('mint2222222222222222222222222222222222222222')
    const id1 = saveToLocalHistory(data1)
    saveToLocalHistory(data2)

    deleteFromLocalHistory(id1)
    const records = loadLocalHistory()
    expect(records).toHaveLength(1)
    expect(records[0].data.meta.mint).toBe(data2.meta.mint)
  })

  it('删除不存在的 id 不报错，记录不变', () => {
    saveToLocalHistory(makeFlowData('mint1111111111111111111111111111111111111111'))
    expect(() => deleteFromLocalHistory('nonexistent-id')).not.toThrow()
    expect(loadLocalHistory()).toHaveLength(1)
  })

  it('删除唯一一条记录后列表为空', () => {
    const id = saveToLocalHistory(makeFlowData('mint1111111111111111111111111111111111111111'))
    deleteFromLocalHistory(id)
    expect(loadLocalHistory()).toEqual([])
  })
})
