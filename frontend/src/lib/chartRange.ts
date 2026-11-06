import type { HistoryResponse } from '../types'

export const RANGE_OPTIONS = [
  { value: '6mo', label: '6개월', days: 182 },
  { value: '1y', label: '1년', days: 365 },
  { value: '5y', label: '5년', days: 365 * 5 },
  { value: 'max', label: '전체', days: null },
] as const
export type Range = (typeof RANGE_OPTIONS)[number]['value']

/**
 * 고른 기간보다 저장된 시세가 짧은가.
 *
 * "5년을 눌렀는데 1년만 보인다"는 차트가 아니라 받아둔 데이터의 문제다. 평소 갱신은
 * 최근 2년만 받으므로, 등록할 때 전체를 못 받았으면 그 앞은 영영 비어 있게 된다.
 * 전체(max)는 얼마나 더 있는지 알 길이 없어 항상 다시 받아볼 수 있게 둔다.
 */
export function needsBackfill(history: HistoryResponse | null, range: Range): boolean {
  const first = history?.coverage?.first_date
  if (!first) return false
  const days = RANGE_OPTIONS.find((r) => r.value === range)?.days
  if (days == null) return true
  const cutoff = new Date(Date.now() - days * 86_400_000)
  // 주말·휴장일 때문에 며칠은 늘 비는다 — 한 주 넘게 모자랄 때만 말한다
  return new Date(`${first}T00:00:00Z`).getTime() - cutoff.getTime() > 7 * 86_400_000
}
