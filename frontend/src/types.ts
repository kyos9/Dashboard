/** 포트폴리오를 다시 들여다보는 주기 — 종목마다가 아니라 포트폴리오에 하나 */
export type ReviewPeriod = 'quarterly' | 'semiannual' | 'annual'

/** 거래소 구분 — 통화와 거래일 캘린더가 여기서 갈린다 */
export type Market = 'US' | 'KR' | 'JP'
export type Currency = 'USD' | 'KRW' | 'JPY'

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
  /** 전체 자금(현금 포함) 중 이 종목에 두려는 비중 */
  target_weight_pct: number
  /** 이 종목만의 허용 오차. null이면 설정의 기본 밴드 */
  rebalance_band_pct: number | null
  /** 화면에 보여줄 순서 — 사용자가 정한다 */
  sort_order: number
  /** 등록 직후 시세를 뒤에서 받는 중이면 'loading', 받다가 실패했으면 'failed' */
  data_status?: DataStatus | null
  /** 실패했을 때 사용자가 할 일 */
  data_hint?: string | null
}

export type DataStatus = 'loading' | 'failed'

export interface StockCreateInput {
  ticker: string
  name?: string
  category?: string | null
  target_weight_pct?: number
  rebalance_band_pct?: number | null
  /** 이미 들고 있는 종목이면 등록하면서 같이 적는다 */
  quantity?: number
  /** 평균 매입단가 (종목의 거래 통화) */
  avg_cost?: number | null
}

export type StockUpdateInput = Partial<
  Omit<StockCreateInput, 'ticker' | 'name' | 'quantity' | 'avg_cost'>
> & {
  active?: boolean
  /** 화면에 보여줄 이름. null이면 지우고 티커로 되돌린다 */
  name?: string | null
}

/** 종목 등록 결과 — 최초 시세 백필이 실제로 됐는지까지 알려준다 */
/** 종목 하나 새로고침. 쿨다운 중이면 받지 않고 `skipped` 와 언제 받았는지(`hint`)가 온다 */
export interface StockRefreshResult {
  ticker: string
  rows_upserted?: number
  skipped?: boolean
  hint?: string
}

export interface StockCreateResult {
  stock: Stock
  data_loaded: boolean
  /** 시세를 뒤에서 받기 시작했다 — 끝났는지는 종목 목록의 data_status 로 본다 */
  data_pending?: boolean
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
  /** 무릎매수(v2)가 마지막으로 뜬 날. 한 번도 없으면 null */
  last_buy_signal_date: string | null
  /** 등록 직후 시세를 뒤에서 받는 중이거나 받다가 실패 */
  data_status?: DataStatus | null
  rebalance_signal: RebalanceSignal
}

export type FundamentalKey =
  | 'per'
  | 'pbr'
  | 'dividend_yield'
  | 'roe'
  | 'operating_margin'
  | 'revenue_yoy'
  | 'operating_income_yoy'
  | 'eps_yoy'
  | 'debt_ratio'
  | 'fcf'

export interface FundamentalMetric {
  key: FundamentalKey
  value: number | null
  period_end: string | null
  /** 이 값을 이루는 공시가 나온 날 (여럿이면 가장 늦은 날) */
  filed_at: string | null
  /** 공시일을 결산일로 추정했나 (야후 출처) */
  estimated: boolean
  /** 값이 없는 이유 ("적자", "자본잠식") */
  note: string | null
}

export interface PerRange {
  min: number
  max: number
  median: number
  current: number | null
  /** 지난 기간 중 지금 PER 이하였던 날의 비율 (%) */
  position_pct: number | null
  since: string
  days: number
}

export interface FundamentalQuarter {
  period_end: string
  /** 그 분기 숫자가 처음 공시된 날 */
  filed_at: string
  estimated: boolean
  /** 뒤에 정정 공시로 값이 바뀌었나 */
  revised: boolean
  revenue: number | null
  operating_income: number | null
  net_income: number | null
  eps_diluted: number | null
  operating_cf: number | null
  capex: number | null
  fcf: number | null
}

/** ok · none(재무 없음: ETF 등) · unsupported(아직 못 읽는 출처) · error · null(아직 안 받음) */
export type FundamentalState = 'ok' | 'none' | 'unsupported' | 'error'

/** 종목 하나의 재무. "재무" 화면 목록은 이것의 줄들이다 (분기 표는 비어 온다). */
export interface FundamentalsResponse {
  ticker: string
  name?: string | null
  category?: string | null
  state: FundamentalState | null
  message: string | null
  source: string | null
  checked_at: string | null
  currency: Currency
  price: number | null
  price_date: string | null
  metrics: FundamentalMetric[]
  per_range: PerRange | null
  quarters: FundamentalQuarter[]
}

export interface HistoryPoint {
  date: string
  close: number
}

/** 시그널이 뜬 날. 차트에 점 하나로 찍힌다 */
export interface HistoryMarker {
  date: string
  kind: 'buy' | 'sell'
}

/** 이 종목에 대해 실제로 저장돼 있는 시세 구간 (요청한 범위와 무관) */
export interface HistoryCoverage {
  first_date: string | null
  last_date: string | null
  rows: number
}

export interface HistoryResponse {
  ticker: string
  prices: HistoryPoint[]
  markers: HistoryMarker[]
  coverage: HistoryCoverage
}

export interface Holding {
  ticker: string
  quantity: number
  /** 평균 매입단가 (거래 통화). 모르면 null — 손익만 비고 비중은 그대로 계산된다 */
  avg_cost: number | null
  updated_at: string
}

/** 적용 중인 원/달러 환율과 그 출처 */
/** 한 통화의 원화 환산값과 그 출처 */
export interface FxQuote {
  currency: Currency
  /** 1단위 = 몇 원 */
  krw_rate: number
  /** override(직접 입력) | stored(저장된 조회값) | fetched | fallback(추정치) */
  source: string
  updated_at: string | null
  is_estimate: boolean
}

/** 적용 중인 환율 묶음. 통화코드 -> 환율 */
export interface FxInfo {
  rates: Partial<Record<Currency, FxQuote>>
  /** 하나라도 추정치면 참 — 화면에 알려야 한다 */
  is_estimate: boolean
}

export interface Settings {
  default_rebalance_band_pct: number
  /** 비중 계산의 기준이 되는 통화 */
  base_currency: Currency
  /** 사용자가 직접 지정한 환율 (없으면 자동 조회값 사용) */
  /** 통화코드 -> 직접 입력한 환율 (없는 통화는 자동 조회값을 쓴다) */
  fx_overrides: Partial<Record<Currency, number>>
  fx: FxInfo
  review_period: ReviewPeriod
  /** 다음 리뷰일을 직접 정했을 때. 그 무렵 기록을 남기면 다시 주기로 돌아간다 */
  review_date_override: string | null
  /** 통화코드 -> 현금 */
  cash: Partial<Record<Currency, number>>
  /** 현금으로 둘 비중(%) */
  cash_target_pct: number
}

export type SettingsUpdate = Partial<Omit<Settings, 'fx' | 'fx_overrides' | 'cash'>> & {
  /** 값에 null을 주면 그 통화만 자동 조회로 돌아간다 */
  fx_overrides?: Partial<Record<Currency, number | null>>
  /** 값에 null·0을 주면 그 통화 현금을 지운다. 안 보낸 통화는 그대로 */
  cash?: Partial<Record<Currency, number | null>>
}

export interface RebalanceTarget {
  ticker: string
  target_weight_pct: number
  rebalance_band_pct: number | null
}

export interface RebalanceRow {
  ticker: string
  name: string | null
  /** 이 종목을 실제로 사고파는 통화 */
  currency: Currency
  target_weight_pct: number
  actual_weight_pct: number
  excess_pct: number
  /** 이 종목에 적용되는 허용 오차 (종목별 값 또는 기본 밴드) */
  band_pct: number
  shoulder_signal_fired_in_period: boolean
  rebalance_signal: RebalanceSignal
  quantity: number
  avg_cost: number | null
  /** 현지 통화 기준 */
  last_close: number | null
  current_value: number
  /** 기준통화로 환산한 평가금액 — 비중은 이 값으로 계산된다 */
  current_value_base: number
  /** 손익 — 거래 통화 기준. 평단가를 모르면 null */
  cost_value: number | null
  unrealized_pnl: number | null
  return_pct: number | null
}

/** 현금 한 줄 — 종목과 나란히 비중을 잰다 */
export interface CashRow {
  amounts: Partial<Record<Currency, number>>
  value_base: number
  target_pct: number
  actual_pct: number
  excess_pct: number
}

export interface ReviewStatus {
  period: ReviewPeriod
  /** 다음 리뷰일. 오늘이 이 날 이후면 due */
  next_date: string
  due: boolean
  override: string | null
  last_snapshot_at: string | null
}

/** 리밸런싱 현황 전체. 통화가 섞이면 "전제"(기준통화·환율)까지 알아야 숫자를 읽을 수 있다 */
export interface RebalanceCurrent {
  base_currency: Currency
  fx: FxInfo
  /** 현금까지 더한 전체 자금 — 목표비중은 이것 대비 */
  total_value_base: number
  holdings_value_base: number
  /** 평단가를 아는 종목끼리의 합계. 하나도 모르면 null */
  cost_value_base: number | null
  unrealized_pnl_base: number | null
  cash: CashRow
  /** 종목 목표 + 현금 목표. 100이 아니면 알려준다 */
  target_sum_pct: number
  review: ReviewStatus
  rows: RebalanceRow[]
}

/** 리밸런싱 기록에 얼려둔 종목 한 줄 */
export interface SnapshotRow {
  ticker: string
  name: string | null
  currency: Currency
  quantity: number
  avg_cost: number | null
  last_close: number | null
  current_value: number
  current_value_base: number
  target_weight_pct: number
  actual_weight_pct: number
  excess_pct: number
  return_pct: number | null
}

/** 리밸런싱 기록 — 리뷰할 때 남긴 모습 그대로 */
export interface RebalanceSnapshot {
  id: number
  taken_at: string
  review_date: string | null
  base_currency: Currency
  total_value_base: number
  note: string | null
  data: {
    rows: SnapshotRow[]
    cash: CashRow
    fx: Partial<Record<Currency, number>>
    holdings_value_base?: number
    unrealized_pnl_base?: number | null
  }
}

export interface RefreshResult {
  ticker: string
  ok: boolean
  rows_upserted: number | null
  error: string | null
  hint: string | null
}

/** 백엔드가 알려주는 실행 중인 버전 — 업데이트가 반영됐는지 확인용 */
/** 어느 문인가 — 잠금 없음(개인 PC) · 비밀번호 하나 · 구글 계정 */
export type AuthMode = 'open' | 'password' | 'google'

export interface AuthUser {
  email: string | null
  name: string | null
  /** 주인(1번). 주인은 탈퇴할 수 없다 */
  is_owner: boolean
  /** 승인 대기면 아직 손님과 같다 — 관리자가 승인해야 쓴다. 옛 서버는 보내지 않는다 */
  status?: 'active' | 'pending'
}

export type UserStatus = 'active' | 'pending' | 'rejected' | 'blocked'

/** 관리자의 사용자 목록 한 줄 */
export interface AdminUser {
  id: number
  email: string | null
  name: string | null
  status: UserStatus
  is_owner: boolean
  created_at: string | null
  last_login_at: string | null
  stock_count: number
}

export interface AuthStatus {
  /** 서버가 잠겨 있는지 (비밀번호든 구글이든). 개인 PC에서는 false */
  locked: boolean
  /** 지금 들어와 있는지 (잠겨 있지 않으면 항상 true) */
  authenticated: boolean
  /** 옛 서버는 보내지 않는다 — 없으면 locked 로 비밀번호/잠금 없음을 가른다 */
  mode?: AuthMode
  /** 구글 모드에서 들어와 있을 때만 */
  user?: AuthUser | null
  /** 구글 모드인데 서버 설정이 덜 됐으면 그 설명 */
  config_problem?: string | null
  /** 관리자에게만 — 기다리는 가입 신청 수 */
  pending_count?: number
  /** 관리자에게 연락할 곳 (`.env` 의 OPERATOR_CONTACT). 적지 않았으면 없다 */
  contact?: string
}

export interface HealthInfo {
  status: string
  locked?: boolean
  /** 잠긴 상태에서 로그인 전이면 내려오지 않는다 */
  version?: string
  /** 커밋 해시 앞 7자리. 사람이 읽으라고 있는 값이 아니라 대조용이다 */
  revision?: string | null
  /** 이미지를 만든 시각 (ISO8601 UTC). 읽기 좋게 바꾸는 것은 브라우저가 한다 */
  built_at?: string | null
  /** 시장별 제공자 순서 (국내는 네이버를 먼저 쓴다). 로그인 전이면 없다 */
  providers_by_market?: Record<Market, string[]>
}

export interface LogEntry {
  time: string
  level: string
  logger: string
  message: string
}

export interface LogsResponse {
  available: boolean
  path: string
  size_bytes: number
  modified_at: string | null
  level: 'warning' | 'all'
  entries: LogEntry[]
  counts: Record<string, number>
}

/* ---------- 매크로 지표 ---------- */

/** 차트에 찍을 점 하나. 변환까지 끝난 값이다 (CPI라면 지수가 아니라 전년비) */
export interface MacroPoint {
  as_of: string
  value: number
}

/**
 * 값이 어느 구간인가.
 *
 * 경계를 **서버가 들고 있다.** 화면 둘(매크로 탭과 홈)이 각자 25/45/55/75를 들고 있으면
 * 언젠가 한쪽만 고쳐져서 같은 숫자를 놓고 둘이 다른 이름을 말한다.
 */
export interface MacroZone {
  label: string
  /** 화면에 같이 적는 범위 ("25~44") — 이름만 적으면 33.7이 왜 공포인지 알 수 없다 */
  range: string
  /** 양 끝 구간인가 — 국면 배지로 올라갈지를 이걸로 고른다 */
  extreme: boolean
}

/** 국면 배지 하나. 규칙 하나가 배지 하나다 — 합성 점수는 만들지 않는다 */
export interface MacroBadge {
  key: string
  label: string
  /** 왜 떴는지. 이름만으로는 −0.02와 −1.5가 같아 보인다 */
  detail: string
  tone: string
  as_of: string | null
}

/**
 * 예상치 한 줄.
 *
 * **값의 단위가 `MacroSeriesInfo.value` 와 같다** — 저장된 원본 지수(320.541)가 아니라
 * 화면에 뜨는 전년비(2.7)다. 예상치를 내는 쪽이 전부 전년비로만 발표하기 때문이다.
 */
export interface MacroForecast {
  /** 어느 달을 예측한 것인가 (그 달 1일) */
  as_of: string
  value: number
  /** manual | cleveland_fed */
  source: string
  /** 화면에 그대로 적는 출처 이름 ("직접 입력") */
  source_label: string
  /** 언제 한 예측인가. 나우캐스트는 매일 바뀌므로 이게 있어야 "언제 기준"인지 안다 */
  forecast_date: string
  /** 실제 − 예상 (%p). 아직 안 나온 달이면 null */
  surprise: number | null
}

/** 카드 한 장에 필요한 것 전부 */
export interface MacroSeriesInfo {
  code: string
  name: string
  note: string | null
  /** 변환을 거친 뒤의 단위 (percent | index | level) */
  unit: string
  transform: string
  /** "전년비" 같은 꼬리표. 없으면 원본 그대로라는 뜻 */
  transform_label: string | null
  frequency: string
  as_of: string | null
  value: number | null
  previous: number | null
  /** 직전 값과의 **차이** — 변화율이 아니다 (원래 값이 이미 %인 경우가 많다) */
  change: number | null
  released_at: string | null
  source: string | null
  /** 값이 어느 구간인가. **구간을 정해서 발표하는 지표에만** 있다 (지금은 공포·탐욕 하나) */
  zone: MacroZone | null
  /** 이 지표에 "예상치"라는 말이 성립하는가. 매일 나오는 값에는 컨센서스가 없다 */
  forecastable: boolean
  /** **방금 나온 값**의 예상치. "물가 상회" 배지가 보는 것이 이쪽이다 */
  forecast: MacroForecast | null
  /** 아직 안 나온 달의 예상치. 비교할 실제값이 없으니 배지도 없다 */
  pending_forecast: MacroForecast | null
  stale: boolean
  last_checked_at: string | null
  last_ok_at: string | null
  last_error: string | null
}

/** 장단기 금리차 — 받아온 지표가 아니라 두 금리에서 계산한 값 */
export interface TermSpread {
  as_of: string
  value: number
  long_code: string
  short_code: string
}

export interface MacroOverview {
  series: MacroSeriesInfo[]
  term_spread: TermSpread | null
  /** 지금 걸리는 규칙들. 비어 있으면 "눈에 띄는 국면 없음"이고 그것도 정보다 */
  badges: MacroBadge[]
  /** 홈에 띄우기로 고른 코드 — 카드의 ☆ 가 켜졌는지를 이걸로 판단한다 */
  pinned: string[]
}

/** 홈 화면 한 줄 */
export interface MacroPinned {
  /** 고른 코드. 꺼지거나 없어진 지표도 여기엔 남아 있다 */
  codes: string[]
  /** 그 중 실제로 보여줄 수 있는 것들, 고른 순서대로 */
  series: MacroSeriesInfo[]
  /**
   * 국면 배지. **고른 지표만 보고 만든 것이 아니다** — VIX 를 홈에서 내렸다고 공포 구간
   * 배지가 사라지면 화면이 "지금 조용하다"고 거짓말을 하게 된다.
   */
  badges: MacroBadge[]
}

/** 장단기 금리차를 홈에서 가리키는 이름. `macro_series` 에 없는 계산값이다 */
export const TERM_SPREAD_CODE = 'TERM_SPREAD'

export interface MacroHistory {
  code: string
  name: string
  unit: string
  transform: string
  transform_label: string | null
  points: MacroPoint[]
}

export interface MacroRefreshResult {
  code: string
  ok: boolean
  provider: string | null
  as_of: string | null
  inserted: number | null
  revised: number | null
  error: string | null
  hint: string | null
  skipped: string | null
}

/* ---------- 푸시 알림 ---------- */

/** 받을 알림 종류. 가입 신청은 관리자에게만 있다 (backend/app/services/alerts.py) */
export type PushKind = 'buy' | 'band' | 'review' | 'signup'

export interface PushSettings {
  kinds: PushKind[]
  available: PushKind[]
  /** 알림을 켜 둔 내 기기 수 */
  devices: number
}

/** 브라우저의 `PushSubscription.toJSON()` 모양 */
export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
