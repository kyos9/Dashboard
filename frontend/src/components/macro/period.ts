import { FREQUENCY_LABEL } from '../../lib/macro'
import type { MacroSeriesInfo } from '../../types'

/* 매크로 지표의 때 표시 — 화면 글만 만든다(계산 없음). 컴포넌트 파일에서 함수를 내보내면 fast refresh 가 깨져 따로 둔다 */

/** "2026-08-01" -> "2026-08". 값이 없으면 이번 달. */
export function monthOf(asOf: string | null): string {
  if (asOf) return asOf.slice(0, 7)
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 월간 · 분기 · 주간 값이 어느 때 것인지 — "2026년 10월분"(목업 14 ③ 가). 1월이면 지난해 12월분이 섞여 연도가 있어야 한다.
 * 일간은 적지 않는다(대부분이 일간이고, 받은 시각이 목록 위에 있다).
 */
export function periodOf(series: Pick<MacroSeriesInfo, 'frequency' | 'as_of'>): string {
  if (series.frequency === 'daily' || !series.as_of) return ''
  const [year, month] = series.as_of.slice(0, 7).split('-').map(Number)
  if (series.frequency === 'monthly') return `${year}년 ${month}월분`
  if (series.frequency === 'quarterly') return `${year}년 ${Math.ceil(month / 3)}분기분`
  if (series.frequency === 'weekly') return `${series.as_of} 주`
  return `${FREQUENCY_LABEL[series.frequency] ?? series.frequency} ${series.as_of}`
}
