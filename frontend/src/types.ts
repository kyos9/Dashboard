export type DcaPeriod = 'monthly' | 'quarterly'
export type RebalancePeriod = 'quarterly' | 'semiannual'
export type BuyType = 'signal' | 'fallback'
export type BuyStatus = 'recommended' | 'confirmed'

export interface Stock {
  ticker: string
  name: string | null
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
  dca_amount?: number
  dca_period?: DcaPeriod
  rebalance_period?: RebalancePeriod
  target_weight_pct?: number
  rebalance_band_pct?: number | null
  review_date_override?: string | null
}

export type StockUpdateInput = Partial<Omit<StockCreateInput, 'ticker'>> & { active?: boolean }

export interface LatestIndicators {
  date: string | null
  close: number | null
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

export interface DashboardCard {
  ticker: string
  name: string | null
  data_stale: boolean
  indicators: LatestIndicators
  knee_buy_v2: boolean
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

export interface Settings {
  default_rebalance_band_pct: number
}

export interface RebalanceTarget {
  ticker: string
  target_weight_pct: number
  rebalance_band_pct: number | null
  rebalance_period: RebalancePeriod
  review_date_override: string | null
}

export interface RebalanceRow {
  ticker: string
  target_weight_pct: number
  actual_weight_pct: number
  excess_pct: number
  next_review_date: string
  shoulder_signal_fired_in_period: boolean
  rebalance_signal: RebalanceSignal
}
