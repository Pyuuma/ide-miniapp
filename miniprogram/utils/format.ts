function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function formatDateTime(input: Date | string | number | null | undefined): string {
  if (!input) return '-'
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(input: Date | string | number | null | undefined): string {
  if (!input) return '-'
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDurationMs(ms: number): string {
  const abs = Math.abs(ms)
  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  if (days > 0) return `${days} 天 ${hours} 小时`
  const minutes = Math.floor((abs % 3600000) / 60000)
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

export function timeAgo(input: Date | string | number | null | undefined): string {
  if (!input) return '-'
  const d = input instanceof Date ? input : new Date(input)
  const diff = Date.now() - d.getTime()
  return formatDurationMs(diff) + '前'
}
