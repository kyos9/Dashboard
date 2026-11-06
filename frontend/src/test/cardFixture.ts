import type { DashboardCard, LatestIndicators } from '../types'

/** 테스트용 카드 하나 — 시세·신호가 다 비어 있는 기본값에 고칠 것만 덮는다 (묶음 3 종목 탭·종목 안 테스트) */
export const EMPTY_INDICATORS: LatestIndicators = {
  date: '2026-09-16',
  close: 100,
  prev_close: 99,
  change_pct: 1.01,
  ma5: null,
  ma20: null,
  ma50: null,
  ma200: null,
  stddev20: null,
  vol_ratio: null,
  roc5: null,
  disparity: null,
  plus_di: null,
  minus_di: null,
  adx: null,
}

export function dashCard(overrides: Partial<DashboardCard> & { ticker: string }): DashboardCard {
  return {
    name: null,
    category: null,
    market: 'US',
    currency: 'USD',
    data_stale: false,
    price_source: 'yahoo',
    indicators: EMPTY_INDICATORS,
    knee_buy_v2: false,
    knee_conditions: { di_bearish: null, disparity_negative: null, volatility_or_volume: null, adx_trending: null },
    shoulder_sell_ref: false,
    last_buy_signal_date: null,
    rebalance_signal: { active: false, reasons: [] },
    ...overrides,
  }
}
