/**
 * 地址显示格式化工具
 *
 * 始终从完整地址派生截断显示，不依赖存储的 label，
 * 保证旧数据（4…4 label）也能正确显示为 6…6。
 */
export function displayAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`
}
