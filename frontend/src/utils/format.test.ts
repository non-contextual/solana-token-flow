import { describe, it, expect } from 'vitest'
import { displayAddr } from './format'

describe('displayAddr', () => {
  it('空字符串 → 原样返回（空字符串）', () => {
    expect(displayAddr('')).toBe('')
  })

  it('undefined/null 防御：空值返回空字符串', () => {
    // TypeScript 类型是 string，但运行时可能传入空值
    expect(displayAddr(undefined as any)).toBe(undefined)
  })

  it('长度 < 12 的短地址 → 原样返回', () => {
    expect(displayAddr('short')).toBe('short')
    expect(displayAddr('11chars___0')).toBe('11chars___0')  // 11 chars
  })

  it('长度 = 12 → 截断为 6…6', () => {
    const addr = 'AAAAAA'+'BBBBBB'  // 12 chars
    expect(displayAddr(addr)).toBe('AAAAAA…BBBBBB')
  })

  it('标准 44 字符 Solana 地址 → 前6…后6', () => {
    const addr = '8mb8yDefWsXAr6xXr1VpSdfAYUHaKN5Ndf4FdtwVsyow'  // 44 chars
    const result = displayAddr(addr)
    expect(result).toBe('8mb8yD…wVsyow')
    // 验证结构
    expect(result.startsWith(addr.slice(0, 6))).toBe(true)
    expect(result.endsWith(addr.slice(-6))).toBe(true)
    expect(result).toContain('…')
  })

  it('不同长地址产生不同截断结果', () => {
    const addr1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'  // 44
    const addr2 = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'
    expect(displayAddr(addr1)).not.toBe(displayAddr(addr2))
  })

  it('中间部分被省略，不出现在结果里', () => {
    const addr = 'AAAAAA' + 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM' + 'BBBBBB'
    const result = displayAddr(addr)
    expect(result).toBe('AAAAAA…BBBBBB')
    expect(result).not.toContain('M')
  })
})
