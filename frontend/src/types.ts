export type DcaPeriod = 'monthly' | 'quarterly'
export type RebalancePeriod = 'quarterly' | 'semiannual'
export type BuyType = 'signal' | 'fallback'
export type BuyStatus = 'recommended' | 'confirmed'

/** 거래소 구분 — 통화와 거래일 캘린더가 여기서 갈린다 */
export type Market = 'US' | 'KR'
export type Currency = 'USD' | 'KRW'

/** 지금 무엇으로 종목이 검색되고 있는지 */
export interface ListingStatus {
  /** 한국거래소에서 받아 캐시한 종목 수 (0이면 아직 못 받았다는 뜻) */
  cached_count: number
  /** 캐시를 받아온 시각 */
  updated_at: string | null
  /** 앱에 내장된 주요 종목 수 */
  seed_count: number
  /** 내장 목록을 정리한 시점 (이후 신규 상장·사명 변경은 들어 있지 않다) */
  seed_as_of: string
}

/** 종목 검색 결과 한 건 */
export interface SymbolMatch {
  ticker: string
  name: string
  market: Market
  /** KOSPI / KOSDAQ / KONEX — 해외 종목은 null */
  board: string | null
  instrument: string
  /** ticker | seed | cache | krx | yahoo | guess */
  source: string
  /** false면 시장이 확정되지 않은 추정 — 사용자가 직접 골라야 한다 */
  confident: boolean
}

export interface Stock {
  ticker: string
  name: string | null
  category: string | null
  market: Market
  currency: Currency
  active: boolean
  added_at: string
  dca_amount: number
  dca_period: DcaPeriod
  rebalance_period: RebalancePeriod
  target_weight_pct: number
  rebalance_band_pct: number | null
  review_date_override: string | null
}

export interface StockCreateInput {
  ticker: string
  name?: string
  category?: string | null
  dca_amount?: number
  dca_period?: DcaPeriod
  rebalance_period?: RebalancePeriod
  target_weight_pct?: number
  rebalance_band_pct?: number | null
  review_date_override?: string | null
}

export type StockUpdateInput = Partial<Omit<StockCreateInput, 'ticker'>> & { active?: boolean }

/** 종목 등록 결과 — 최초 시세 백필이 실제로 됐는지까지 알려준다 */
export interface StockCreateResult {
  stock: Stock
  data_loaded: boolean
  /** 제공자별 기술적 원인 */
  data_error: string | null
  /** 사용자가 다음에 할 일 */
  data_hint: string | null
  /** 이름으로 등록했을 때 사용자가 입력한 원문 (예: "삼성전자") */
  resolved_from: string | null
}

export interface LatestIndicators {
  date: string | null
  close: number | null
  prev_close: number | null
  change_pct: number | null
  ma5: number | null
  ma20: number | null
  ma50: number | null
  ma200: number | null
  stddev20: number | null
  vol_ratio: number | null
  roc5: number | null
  disparity: number | null
  plus_di: number | null
  minus_di: number | null
  adx: number | null
}

export interface PendingBuy {
  id: number
  type: BuyType
  status: BuyStatus
  exec_date: string
  amount: number
}

export interface RebalanceSignal {
  active: boolean
  reasons: string[]
}

/** 무릎매수(v2) 네 조건의 개별 충족 여부. null = 데이터 부족으로 판정 불가 */
export interface KneeConditions {
  di_bearish: boolean | null
  disparity_negative: boolean | null
  volatility_or_volume: boolean | null
  adx_trending: boolean | null
}

export interface DashboardCard {
  ticker: string
  name: string | null
  category: string | null
  market: Market
  currency: Currency
  data_stale: boolean
  /** 최신 종가를 준 제공자 (naver/yahoo/stooq). 이 값을 기록하기 전에 받은 시세는 null */
  price_source: string | null
  indicators: LatestIndicators
  knee_buy_v2: boolean
  knee_conditions: KneeConditions
  shoulder_sell_ref: boolean
  current_period_buy: PendingBuy | null
  rebalance_signal: RebalanceSignal
}

export interface HistoryPoint {
  date: string
  close: number
}

export interface HistoryMarker {
  date: string
  kind: 'buy_signal' | 'buy_fallback' | 'shoulder_ref'
  status: BuyStatus | null
}

export interface HistoryResponse {
  ticker: string
  prices: HistoryPoint[]
  markers: HistoryMarker[]
}

export interface Holding {
  ticker: string
  quantity: number
  updated_at: string
}

/** 적용 중인 원/달러 환율과 그 출처 */
export interface FxInfo {
  usd_krw: number
  /** override(수동) | stored(저장된 조회값) | fetched(방금 조회) | fallback(추정) */
  source: string
  updated_at: string | null
  /** true면 조회 실패로 폴백 상수를 쓰는 중 — 화면에 추정치임을 알려야 한다 */
  is_estimate: boolean
}

export interface Settings {
  default_rebalance_band_pct: number
  /** 비중 계산의 기준이 되는 통화 */
  base_currency: Currency
  /** 사용자가 직접 지정한 환율 (없으면 자동 조회값 사용) */
  usd_krw_override: number | null
  fx: FxInfo
}

export type SettingsUpdate = Partial<Omit<Settings, 'fx'>>

export interface RebalanceTarget {
  ticker: string
  target_weight_pct: number
  rebalance_band_pct: number | null
  rebalance_period: RebalancePeriod
  review_date_override: string | null
}

export interface RebalanceRow {
  ticker: string
  name: string | null
  /** 이 종목을 실제로 사고파는 통화 */
  currency: Currency
  target_weight_pct: number
  actual_weight_pct: number
  excess_pct: number
  next_review_date: string
  shoulder_signal_fired_in_period: boolean
  rebalance_signal: RebalanceSignal
  quantity: number
  /** 현지 통화 기준 */
  last_close: number | null
  current_value: number
  /** 기준통화로 환산한 평가금액 — 비중은 이 값으로 계산된다 */
  current_value_base: number
}

/** 리밸런싱 현황 전체. 통화가 섞이면 "전제"(기준통화·환율)까지 알아야 숫자를 읽을 수 있다 */
export interface RebalanceCurrent {
  base_currency: Currency
  fx: FxInfo
  total_value_base: number
  rows: RebalanceRow[]
}

export interface RefreshResult {
  ticker: string
  ok: boolean
  rows_upserted: number | null
  error: string | null
  hint: string | null
}

/** 백엔드가 알려주는 실행 중인 버전 — 업데이트가 반영됐는지 확인용 */
export interface HealthInfo {
  status: string
  version: string
  /** 시장별 제공자 순서 (국내는 네이버를 먼저 쓴다) */
  providers_by_market: Record<Market, string[]>
}
