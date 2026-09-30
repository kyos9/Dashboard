/**
 * 대시보드 포트폴리오 보기의 계산 (ROADMAP 8-3).
 *
 * 숫자(손익·변동·비중)는 서버가 낸 것을 그대로 쓴다 — 리밸런싱 화면과 같은 응답이라 두 화면의
 * 합계가 어긋날 수 없다. 여기서 하는 일은 **줄 세우기·신호 모으기·말 만들기**뿐이다.
 */
import type { Currency, DashboardCard, FxInfo, RebalanceRow } from '../types'
import { signed, trafficLight } from './display'

/** 한 종목 — 리밸런싱 행(돈)과 대시보드 카드(시세·시그널)를 티커로 붙인 것 */
export interface PortfolioItem {
  row: RebalanceRow
  card: DashboardCard | null
  /** 내가 정한 순서 (서버가 준 순서) */
  order: number
}

export function joinItems(rows: RebalanceRow[], cards: DashboardCard[]): PortfolioItem[] {
  const cardBy = new Map(cards.map((card) => [card.ticker, card]))
  return rows.map((row, order) => ({ row, card: cardBy.get(row.ticker) ?? null, order }))
}

/* ---------- 신호 점 ----------
   포트폴리오 보기에서 시그널은 부수다. 줄 끝에 점 하나로만 있고, 누르면 시그널 보기로 간다.
   정기 리뷰 도래는 모든 종목에 한꺼번에 걸리므로 점으로 찍지 않는다 — 맨 위 리뷰 줄이 알린다. */

export type SignalKind = 'buy' | 'sell' | 'over' | 'under'

export interface SignalMark {
  kind: SignalKind
  label: string
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  buy: '매수 시그널',
  sell: '매도 시그널',
  over: '과중 — 매도 검토',
  under: '미달 — 매수 검토',
}

export function signalsOf(item: PortfolioItem): SignalMark[] {
  const out: SignalKind[] = []
  const card = item.card
  // 시세가 오래된 종목은 시그널 보기에서도 판정하지 않는다 — 같은 규칙
  if (card && trafficLight(card).state !== 'stale') {
    if (card.knee_buy_v2) out.push('buy')
    if (card.shoulder_sell_ref) out.push('sell')
  }
  const reasons = item.row.rebalance_signal.reasons
  if (reasons.some((r) => r.includes('매도 검토'))) out.push('over')
  if (reasons.some((r) => r.includes('매수 검토'))) out.push('under')
  return out.map((kind) => ({ kind, label: SIGNAL_LABEL[kind] }))
}

/* ---------- 정렬 ---------- */

export type SortKey = 'value' | 'return' | 'change' | 'drift' | 'mine'

export const SORT_LABEL: Record<SortKey, string> = {
  value: '평가금액',
  return: '수익률',
  change: '등락',
  drift: '비중 차이',
  mine: '내가 정한 순서',
}

export const SORT_KEYS = Object.keys(SORT_LABEL) as SortKey[]

/** 큰 것부터. 모르는 값(null)은 맨 뒤로, 같으면 내가 정한 순서 */
function byDesc(pick: (item: PortfolioItem) => number | null | undefined) {
  return (a: PortfolioItem, b: PortfolioItem) => {
    const x = pick(a)
    const y = pick(b)
    const xn = x === null || x === undefined || Number.isNaN(x)
    const yn = y === null || y === undefined || Number.isNaN(y)
    if (xn !== yn) return xn ? 1 : -1
    if (!xn && !yn && x !== y) return (y as number) - (x as number)
    return a.order - b.order
  }
}

export function sortItems(items: PortfolioItem[], key: SortKey): PortfolioItem[] {
  const copy = [...items]
  switch (key) {
    case 'value':
      return copy.sort(byDesc((i) => i.row.current_value_base))
    case 'return':
      return copy.sort(byDesc((i) => i.row.shown_return_pct ?? i.row.return_pct))
    case 'change':
      return copy.sort(byDesc((i) => i.row.change_pct))
    case 'drift':
      // 목표에서 많이 벗어난 것부터 — 방향은 상관없다
      return copy.sort(byDesc((i) => Math.abs(i.row.excess_pct)))
    default:
      return copy.sort((a, b) => a.order - b.order)
  }
}

/* ---------- 평가손익을 한 통화로 (9-12) ----------
   기본은 종목마다 제 통화다 — VOO 는 달러, 삼성전자는 원. 섞여 있으면 줄끼리 크기를 견줄 수 없어서
   통화 하나를 고르면 그 통화로 바꿔 보인다. 바꾸는 환율은 **지금 환율 하나**(비중을 잴 때와 같은
   값)이다. 환율 효과를 켠 외화 종목은 서버가 이미 산 환율로 원화 손익을 냈으므로 그 값을 바꾼다. */

export type PnlCurrency = 'local' | Currency

const PNL_CURRENCIES: Currency[] = ['KRW', 'USD', 'JPY']

/** 1단위가 몇 원인가. 원은 1, 모르는 통화는 null */
function krwRate(currency: Currency, fx: FxInfo): number | null {
  if (currency === 'KRW') return 1
  const rate = fx.rates[currency]?.krw_rate
  return rate && rate > 0 ? rate : null
}

/**
 * 고를 수 있는 통화. 내 종목들의 통화와 고를 통화 모두 환율을 알아야 바꿀 수 있다 — 하나라도
 * 모르면 종목별만 남는다(바꾸지 못한 줄이 "—"로 비는 것보다 낫다).
 */
export function pnlCurrencyOptions(fx: FxInfo, held: Currency[]): PnlCurrency[] {
  if (held.some((c) => krwRate(c, fx) === null)) return ['local']
  return ['local', ...PNL_CURRENCIES.filter((c) => krwRate(c, fx) !== null)]
}

export function convertAmount(value: number, from: Currency, to: Currency, fx: FxInfo): number | null {
  if (from === to) return value
  const a = krwRate(from, fx)
  const b = krwRate(to, fx)
  return a === null || b === null ? null : (value * a) / b
}

/** 이 줄의 평가손익을 고른 통화로. 'local' 이면 서버가 준 그대로(환율 효과를 켰으면 원화) */
export function pnlIn(
  row: RebalanceRow,
  choice: PnlCurrency,
  fx: FxInfo,
): { value: number | null; currency: Currency } {
  const value = row.shown_pnl ?? row.unrealized_pnl
  const currency = row.shown_currency ?? row.currency
  if (choice === 'local' || value === null || value === undefined) {
    return { value: value ?? null, currency: choice === 'local' ? currency : choice }
  }
  return { value: convertAmount(value, currency, choice, fx), currency: choice }
}

/* ---------- 기기에 기억하는 것 ----------
   고른 정렬·보기는 이 기기의 편의다. 저장이 막힌 브라우저(사생활 보호 창)에서도 화면은 떠야 한다. */

const SORT_STORE = 'dashboard.sort'
const VIEW_STORE = 'dashboard.view'
const PNL_STORE = 'dashboard.pnl-currency'

export type DashboardView = 'portfolio' | 'signal'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 기억 못 해도 지금 화면은 바뀐다
  }
}

export function loadSort(): SortKey {
  const saved = read(SORT_STORE)
  return SORT_KEYS.includes(saved as SortKey) ? (saved as SortKey) : 'value'
}

export function saveSort(key: SortKey) {
  write(SORT_STORE, key)
}

export function loadView(): DashboardView {
  return read(VIEW_STORE) === 'signal' ? 'signal' : 'portfolio'
}

export function saveView(view: DashboardView) {
  write(VIEW_STORE, view)
}

/** 고른 손익 통화. 기억이 없거나 이상하면 종목별 통화 */
export function loadPnlCurrency(): PnlCurrency {
  const saved = read(PNL_STORE)
  return saved === 'KRW' || saved === 'USD' || saved === 'JPY' ? saved : 'local'
}

export function savePnlCurrency(choice: PnlCurrency) {
  write(PNL_STORE, choice)
}

/* ---------- 말 ---------- */

/** "주가 +12.0% · 환율 +3.1% → 합계 +15.5%". 합계는 둘의 합이 아니라 곱이다 */
export function fxSplitText(split: { price_pct: number; fx_pct: number }): string {
  const total = ((1 + split.price_pct / 100) * (1 + split.fx_pct / 100) - 1) * 100
  return `주가 ${signed(split.price_pct, 1, '%')} · 환율 ${signed(split.fx_pct, 1, '%')} → 합계 ${signed(total, 1, '%')}`
}

/** 오르면 up, 내리면 down — 색은 CSS 가 정한다 */
export function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0 || Number.isNaN(value)) return ''
  return value > 0 ? 'up' : 'down'
}

