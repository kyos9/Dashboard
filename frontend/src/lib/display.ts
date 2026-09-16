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

/**
 * 표에 적을 종목 이름.
 *
 * 국내주식은 종목명(삼성전자), 해외주식은 티커(VOO)를 쓴다. `005930.KS`는 사람이 읽고
 * 무슨 회사인지 알 수 없고, 반대로 해외 종목은 티커가 곧 이름이라 "Vanguard S&P 500 ETF"를
 * 길게 적어봐야 칸만 넓어진다. 이름이 비어 있으면 티커로 떨어진다.
 */
export function stockLabel(stock: { ticker: string; name?: string | null; market: Market }): string {
  if (stock.market !== 'KR') return stock.ticker
  const name = (stock.name ?? '').trim()
  return name === '' ? stock.ticker : name
}

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
   "지금 사야 하나"는 색이 아니라 지표 칸에 붙는 조건 표시와 종합 신호등만 말한다. (약세
   구간이 곧 매수 조건이라 색과 신호가 반대로 보이는 일이 생기는데, 그게 정상이다.) */

/** 이격도 = (종가/MA20 - 1) x 100. 매수 시그널은 이격도 < 0을 요구한다. */
export function readDisparity(v: number | null): Reading {
  if (v === null) return { tone: 'grey', note: '데이터 없음' }
  if (v >= 5) return { tone: 'green', note: 'MA20 크게 상회' }
  if (v >= 0) return { tone: 'green', note: 'MA20 상회' }
  if (v > -5) return { tone: 'red', note: 'MA20 하회' }
  return { tone: 'red', note: 'MA20 크게 하회' }
}

/** ADX = 추세의 강도(방향은 말하지 않음). 매수 시그널은 ADX > 20을 요구한다. */
export function readAdx(v: number | null): Reading {
  if (v === null) return { tone: 'grey', note: '데이터 없음' }
  if (v < 20) return { tone: 'grey', note: '추세 없음' }
  if (v < 25) return { tone: 'blue', note: '추세 형성' }
  if (v < 40) return { tone: 'amber', note: '추세 강함' }
  return { tone: 'amber', note: '추세 매우 강함' }
}

/** +DI/-DI 우열 = 추세의 방향. 매수 시그널은 -DI > +DI(약세 구간)를 요구한다. */
export function readDi(plus: number | null, minus: number | null): Reading {
  if (plus === null || minus === null) return { tone: 'grey', note: '데이터 없음' }
  const gap = plus - minus
  if (gap > 0) return { tone: 'green', note: `강세 우위 +${num(gap, 1)}` }
  if (gap < 0) return { tone: 'red', note: `약세 우위 ${num(gap, 1)}` }
  return { tone: 'grey', note: '방향 중립' }
}

/** 거래량비율 = 거래량MA5 / 거래량MA20. 매수 시그널은 > 1.1을 대체조건으로 본다. */
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
   스펙상의 이름은 무릎매수 v2 / 어깨매도(참고)지만, 화면에는 "매수 시그널 / 매도 시그널"로
   적는다. 조건이 여러 갈래여도 사람이 볼 때 알아야 하는 건 결국 사라는 건지 팔라는 건지다.
   두 시그널은 원리상 동시에 뜰 수 있으므로, 실행 가능한 쪽인 매수를 우선한다.
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
    return { state: 'buy', tone: 'green', label: '매수 시그널', desc: '매수 조건 4개를 모두 만족합니다.' }
  }
  if (card.shoulder_sell_ref) {
    return { state: 'hot', tone: 'red', label: '매도 시그널', desc: '매도 조건 충족(참고) — 실제 매도 실행일은 리뷰 마감일입니다.' }
  }
  return { state: 'watch', tone: 'amber', label: '관망', desc: '매수·매도 어느 조건도 충족하지 않습니다.' }
}

/* ---------- 매수 조건 분해 ----------
   시그널이 왜 떴는지 / 무엇이 하나 모자라는지 화면에서 바로 보이게 한다.

   조건은 각각 자기가 나온 지표 칸에 붙는다. 네 개를 한곳에 모아두면 "DI 약세"가 무슨
   숫자에서 나온 말인지 눈으로 이을 수 없어서, 조건을 봐도 지표를 다시 찾아 읽어야 했다. */

/** 조건이 붙는 지표 칸 */
export type MetricKey = 'disparity' | 'adx' | 'di' | 'volume'

export interface SignalCondition {
  key: keyof KneeConditions
  metric: MetricKey
  label: string
  detail: string
  /** 열 머리글에 한 번만 적는 짧은 조건식 */
  header: string
}

export const SIGNAL_CONDITIONS: SignalCondition[] = [
  {
    key: 'di_bearish',
    metric: 'di',
    label: 'DI 약세',
    detail: '-DI > +DI — 하락 방향이 우위',
    header: '-DI > +DI',
  },
  {
    key: 'disparity_negative',
    metric: 'disparity',
    label: '이격도 < 0',
    detail: '종가가 MA20 아래',
    header: '< 0',
  },
  {
    key: 'volatility_or_volume',
    metric: 'volume',
    label: '변동성·거래량',
    detail: 'StdDev20 축소 또는 거래량비 > 1.1',
    header: '변동성↓ 또는 >1.1',
  },
  {
    key: 'adx_trending',
    metric: 'adx',
    label: 'ADX > 20',
    detail: '추세가 형성된 구간',
    header: '> 20',
  },
]

export const CONDITION_BY_METRIC: Record<MetricKey, SignalCondition> = SIGNAL_CONDITIONS.reduce(
  (acc, condition) => ({ ...acc, [condition.metric]: condition }),
  {} as Record<MetricKey, SignalCondition>,
)

/** 조건 충족 여부를 기호와 말로. null은 "판정 불가"이지 "미충족"이 아니다 */
export function conditionMark(met: boolean | null | undefined): { sign: string; word: string } {
  if (met === true) return { sign: '✓', word: '충족' }
  if (met === false) return { sign: '·', word: '미충족' }
  return { sign: '?', word: '판정 불가' }
}

export const CATEGORY_UNSET = '미분류'

export function categoryOf(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? CATEGORY_UNSET : trimmed
}
