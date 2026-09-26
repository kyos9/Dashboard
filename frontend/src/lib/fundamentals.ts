/**
 * 재무 지표를 화면 글자로 (ROADMAP 3b).
 *
 * **판단하는 말을 쓰지 않는다** — "저평가", "고평가", "양호" 같은 말은 조언이 된다 (3절 규제).
 * 숫자와 그 숫자가 언제 공시된 것인지, 그리고 지난 5년 중 어디쯤인지만 적는다.
 */
import type {
  Currency,
  FundamentalKey,
  FundamentalMetric,
  FundamentalsResponse,
  PerRange,
} from '../types'
import { currencyMeta, num, signed } from './display'

/** 차트 팝업의 보기 — 차트 · 재무 · AI 정리 */
export type ChartTab = 'chart' | 'fundamentals' | 'ai'

/** 재무 탭을 보일까. ETF 처럼 재무제표가 없는 종목은 탭 자체를 숨긴다. */
export function hasFundamentalsTab(data: FundamentalsResponse | null): boolean {
  return data !== null && data.state !== 'none'
}

/** 보여줄 숫자가 없을 때 왜 없는지 — 팝업의 재무 탭과 "재무" 화면이 같이 쓴다 */
export function emptyReason(data: Pick<FundamentalsResponse, 'state' | 'message'>): string {
  if (data.state === null) return '아직 재무를 받지 않았습니다. 새벽 작업이 받아오면 여기에 보입니다.'
  if (data.state === 'none') return data.message ?? '재무제표가 없는 종목입니다.'
  if (data.state === 'unsupported') return data.message ?? '아직 이 종목의 재무를 읽지 못합니다.'
  return `재무를 받지 못했습니다${data.message ? ` — ${data.message}` : ''}. 다음 날 다시 시도합니다.`
}

/** 큰 금액 — 달러는 B·M, 원·엔은 조·억. 분기 매출 같은 숫자를 자릿수 세지 않고 읽게. */
export function bigAmount(value: number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const { symbol } = currencyMeta(currency)
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (currency === 'USD') {
    if (abs >= 1e12) return `${sign}${symbol}${num(abs / 1e12, 2)}T`
    if (abs >= 1e9) return `${sign}${symbol}${num(abs / 1e9, 1)}B`
    if (abs >= 1e6) return `${sign}${symbol}${num(abs / 1e6, 1)}M`
    return `${sign}${symbol}${num(abs, 0)}`
  }
  if (abs >= 1e12) return `${sign}${symbol}${num(abs / 1e12, 1)}조`
  if (abs >= 1e8) return `${sign}${symbol}${num(abs / 1e8, 0)}억`
  return `${sign}${symbol}${num(abs, 0)}`
}

/** 분기 이름 — 결산월로 (2026.06). 회계연도 이름(FY27 Q2)은 회사마다 달라 섞으면 헷갈린다. */
export function quarterLabel(periodEnd: string): string {
  return `${periodEnd.slice(0, 4)}.${periodEnd.slice(5, 7)}`
}

export interface MetricDef {
  key: FundamentalKey
  label: string
  /** 무엇을 무엇으로 나눴는지 — 마우스를 올리면 보인다 */
  help: string
}

export const METRIC_GROUPS: { title: string; items: MetricDef[] }[] = [
  {
    title: '가치',
    items: [
      { key: 'per', label: 'PER', help: '종가 ÷ 최근 4분기 희석 EPS 합' },
      { key: 'pbr', label: 'PBR', help: '종가 ÷ (최근 자본 ÷ 주식 수)' },
      { key: 'dividend_yield', label: '배당수익률', help: '최근 4분기 주당 배당 합 ÷ 종가' },
    ],
  },
  {
    title: '수익성',
    items: [
      { key: 'roe', label: 'ROE', help: '최근 4분기 순이익 합 ÷ 최근 자본' },
      { key: 'operating_margin', label: '영업이익률', help: '최근 4분기 영업이익 합 ÷ 매출 합' },
    ],
  },
  {
    title: '성장 (전년 같은 분기 대비)',
    items: [
      { key: 'revenue_yoy', label: '매출', help: '최근 분기 매출 ÷ 1년 전 같은 분기' },
      { key: 'operating_income_yoy', label: '영업이익', help: '최근 분기 영업이익 ÷ 1년 전 같은 분기' },
      { key: 'eps_yoy', label: 'EPS', help: '최근 분기 희석 EPS ÷ 1년 전 같은 분기' },
    ],
  },
  {
    title: '안정성 · 현금',
    items: [
      { key: 'debt_ratio', label: '부채비율', help: '부채 ÷ 자본' },
      { key: 'fcf', label: 'FCF (최근 1년)', help: '최근 4분기 영업현금흐름 − 설비투자' },
    ],
  },
]

/** 지표 값 한 칸의 글자 */
export function metricValue(metric: FundamentalMetric | undefined, currency: Currency): string {
  if (!metric) return '—'
  if (metric.value === null) return metric.note ?? '—'
  switch (metric.key) {
    case 'per':
    case 'pbr':
      return `${num(metric.value, metric.key === 'per' ? 1 : 2)}배`
    case 'dividend_yield':
      return `${num(metric.value, 2)}%`
    case 'roe':
    case 'operating_margin':
    case 'debt_ratio':
      return `${num(metric.value, 1)}%`
    case 'revenue_yoy':
    case 'operating_income_yoy':
    case 'eps_yoy':
      return signed(metric.value, 1, '%')
    case 'fcf':
      return bigAmount(metric.value, currency)
  }
}

/**
 * 값 밑의 근거 — 어느 분기까지, 언제 공시된 숫자로. 조각마다 나눠 돌려준다: 좁은 칸에서
 * 날짜가 "2026-" / "07-28" 로 갈라지지 않게 조각 단위로만 줄을 바꾼다.
 */
export function metricBasisParts(metric: FundamentalMetric | undefined): string[] {
  if (!metric?.period_end) return ['공시에 없음']
  const parts = [`${quarterLabel(metric.period_end)}까지`]
  if (metric.filed_at) parts.push(`공시 ${metric.filed_at}${metric.estimated ? ' (추정)' : ''}`)
  return parts
}

export function metricBasis(metric: FundamentalMetric | undefined): string {
  return metricBasisParts(metric).join(' · ')
}

/**
 * PER 이 지난 5년 중 어디쯤인지 — **사실만** 적는다.
 * "싸다"가 아니라 "지난 기간 중 지금보다 낮았던 날이 몇 %".
 */
export function perPositionText(range: PerRange): string | null {
  if (range.current === null || range.position_pct === null) return null
  return `지난 ${quarterLabel(range.since)}부터 PER이 지금(${num(range.current, 1)}배) 이하였던 날은 ${num(range.position_pct, 0)}%입니다.`
}

/** 막대 위 지금 위치 (0~100). 범위 밖이면 끝에 붙인다. */
export function perMarker(range: PerRange, value: number | null): number | null {
  if (value === null) return null
  if (range.max <= range.min) return 50
  return Math.min(100, Math.max(0, ((value - range.min) / (range.max - range.min)) * 100))
}

/** 이 종목의 숫자가 몇 분기까지인가 — 지표들의 근거 중 가장 늦은 분기. 하나도 없으면 null. */
export function latestQuarter(metrics: FundamentalMetric[]): string | null {
  let latest: string | null = null
  for (const m of metrics) {
    if (m.period_end && (latest === null || m.period_end > latest)) latest = m.period_end
  }
  return latest
}
