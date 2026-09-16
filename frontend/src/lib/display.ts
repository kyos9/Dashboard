import type { Currency, DashboardCard, KneeConditions, Market } from '../types'

/* ---------- 통화 ----------
   원화와 달러는 자릿수 감각이 다르다. 79,600원을 "79,600.00"으로 쓰면 읽기 어렵고,
   $458.92를 "$459"로 반올림하면 정보가 사라진다. 통화별로 소수 자릿수를 나눈다. */

interface CurrencyMeta {
  symbol: string
  label: string
  /** 가격 표시 소수 자릿수 */
  priceDigits: number
  /** 금액(평가금액/주문금액) 표시 소수 자릿수 */
  amountDigits: number
}

export const CURRENCY_META: Record<Currency, CurrencyMeta> = {
  KRW: { symbol: '₩', label: '원', priceDigits: 0, amountDigits: 0 },
  USD: { symbol: '$', label: '달러', priceDigits: 2, amountDigits: 2 },
}

export const MARKET_LABEL: Record<Market, string> = { US: '미국', KR: '한국' }

export function currencyMeta(currency: Currency | null | undefined): CurrencyMeta {
  return CURRENCY_META[currency ?? 'USD'] ?? CURRENCY_META.USD
}

/* ---------- 숫자 포맷 ---------- */

export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function signed(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${num(value, digits)}${suffix}`
}

/** 통화 금액 — 소수점 없이 천단위 구분 (통화 구분이 필요 없는 자리에서 쓴다) */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return Math.round(value).toLocaleString('ko-KR')
}

/** 종목 가격 — 원화는 정수, 달러는 센트까지 */
export function price(value: number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const { symbol, priceDigits } = currencyMeta(currency)
  return `${symbol}${value.toLocaleString('ko-KR', {
    minimumFractionDigits: priceDigits,
    maximumFractionDigits: priceDigits,
  })}`
}

/** 평가금액·주문금액 — 통화 기호를 붙여 어느 돈인지 분명히 한다 */
export function amount(value: number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const { symbol, amountDigits } = currencyMeta(currency)
  return `${symbol}${value.toLocaleString('ko-KR', {
    minimumFractionDigits: amountDigits,
    maximumFractionDigits: amountDigits,
  })}`
}

/** 부호를 붙인 금액 — 조정 필요금액처럼 방향이 중요한 자리에 쓴다 */
export function signedAmount(value: number | null | undefined, currency: Currency): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${amount(Math.abs(value), currency)}`
}

/** 보유수량처럼 소수가 길어질 수 있는 값을 읽기 좋게 자른다 */
export function qty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return Number(value.toFixed(4)).toLocaleString('ko-KR', { maximumFractionDigits: 4 })
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey'

export interface Reading {
  tone: Tone
  note: string
}

/* ---------- 지표 해석 ----------
   숫자만 보고 판단하기 어려운 지표에 한 줄 해석을 붙인다.

   색 규칙은 하나로 통일한다: 초록 = 강세/상승, 빨강 = 약세/하락, 방향이 없는 지표는 중립색.
   "지금 사야 하나"는 색이 아니라 무릎매수 조건 칩과 종합 신호등만 말한다. (약세 구간이
   곧 무릎매수 조건이라 색과 신호가 반대로 보이는 일이 생기는데, 그게 정상이다.) */

/** 이격도 = (종가/MA20 - 1) x 100. 무릎매수는 이격도 < 0을 요구한다. */
export function readDisparity(v: number | null): Reading {
  if (v === null) return { tone: 'grey', note: '데이터 없음' }
  if (v >= 5) return { tone: 'green', note: 'MA20 크게 상회' }
  if (v >= 0) return { tone: 'green', note: 'MA20 상회' }
  if (v > -5) return { tone: 'red', note: 'MA20 하회' }
  return { tone: 'red', note: 'MA20 크게 하회' }
}

/** ADX = 추세의 강도(방향은 말하지 않음). 무릎매수는 ADX > 20을 요구한다. */
export function readAdx(v: number | null): Reading {
  if (v === null) return { tone: 'grey', note: '데이터 없음' }
  if (v < 20) return { tone: 'grey', note: '추세 없음' }
  if (v < 25) return { tone: 'blue', note: '추세 형성' }
  if (v < 40) return { tone: 'amber', note: '추세 강함' }
  return { tone: 'amber', note: '추세 매우 강함' }
}

/** +DI/-DI 우열 = 추세의 방향. 무릎매수는 -DI > +DI(약세 구간)를 요구한다. */
export function readDi(plus: number | null, minus: number | null): Reading {
  if (plus === null || minus === null) return { tone: 'grey', note: '데이터 없음' }
  const gap = plus - minus
  if (gap > 0) return { tone: 'green', note: `강세 우위 +${num(gap, 1)}` }
  if (gap < 0) return { tone: 'red', note: `약세 우위 ${num(gap, 1)}` }
  return { tone: 'grey', note: '방향 중립' }
}

/** 거래량비율 = 거래량MA5 / 거래량MA20. 무릎매수는 > 1.1을 대체조건으로 본다. */
export function readVolume(v: number | null): Reading {
  if (v === null) return { tone: 'grey', note: '데이터 없음' }
  if (v >= 1.5) return { tone: 'amber', note: '거래량 급증' }
  if (v > 1.1) return { tone: 'blue', note: '거래량 증가' }
  if (v < 0.8) return { tone: 'grey', note: '거래량 한산' }
  return { tone: 'grey', note: '거래량 보통' }
}

/** 종가와 MA200의 거리 — 장기 추세 방어선 */
export function readMa200(close: number | null, ma200: number | null): Reading & { pct: number | null } {
  if (close === null || ma200 === null || ma200 === 0) {
    return { tone: 'grey', note: '데이터 없음', pct: null }
  }
  const pct = (close / ma200 - 1) * 100
  return pct >= 0
    ? { tone: 'green', note: '장기 상승추세', pct }
    : { tone: 'red', note: '200일선 이탈', pct }
}

/* ---------- 종합 신호등 ----------
   참고 대시보드의 신호등 UI를 우리 시그널 체계(무릎매수 v2 / 어깨매도 참고)에 맞춰 옮긴 것.
   두 시그널은 원리상 동시에 뜰 수 있으므로, 실행 가능한 쪽인 무릎매수를 우선한다.
   개별 배지는 따로 표시하므로 어느 쪽도 가려지지 않는다. */

export type TrafficState = 'buy' | 'watch' | 'hot' | 'stale'

export interface Traffic {
  state: TrafficState
  tone: Tone
  label: string
  desc: string
}

/** 시세 제공자 이름 → 화면 표기. 값이 이상할 때 어디를 볼지 알려준다. */
const PROVIDER_LABEL: Record<string, string> = {
  naver: '네이버',
  yahoo: '야후',
  stooq: 'Stooq',
}

export function providerLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return PROVIDER_LABEL[source] ?? source
}

export function trafficLight(card: DashboardCard): Traffic {
  if (card.data_stale) {
    return { state: 'stale', tone: 'grey', label: '데이터 갱신 필요', desc: '최근 시세가 없어 판정할 수 없습니다.' }
  }
  if (card.knee_buy_v2) {
    return { state: 'buy', tone: 'green', label: '무릎매수 충족', desc: '무릎매수(v2) 4개 조건을 모두 만족합니다.' }
  }
  if (card.shoulder_sell_ref) {
    return { state: 'hot', tone: 'red', label: '과열 주의', desc: '어깨매도(참고) 조건 충족 — 매도 실행일은 리뷰 마감일입니다.' }
  }
  return { state: 'watch', tone: 'amber', label: '추세 관망', desc: '매수/과열 어느 조건도 충족하지 않습니다.' }
}

/* ---------- 무릎매수 조건 분해 ----------
   시그널이 왜 떴는지 / 무엇이 하나 모자라는지 화면에서 바로 보이게 한다. */

export const KNEE_CONDITION_LABELS: { key: keyof KneeConditions; label: string; detail: string }[] = [
  { key: 'di_bearish', label: 'DI 약세', detail: '-DI > +DI — 하락 방향이 우위' },
  { key: 'disparity_negative', label: '이격도 < 0', detail: '종가가 MA20 아래' },
  { key: 'volatility_or_volume', label: '변동성·거래량', detail: 'StdDev20 축소 또는 거래량비 > 1.1' },
  { key: 'adx_trending', label: 'ADX > 20', detail: '추세가 형성된 구간' },
]

export function kneeMetCount(conditions: KneeConditions): number {
  return KNEE_CONDITION_LABELS.filter(({ key }) => conditions[key] === true).length
}

export const CATEGORY_UNSET = '미분류'

export function categoryOf(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? CATEGORY_UNSET : trimmed
}
