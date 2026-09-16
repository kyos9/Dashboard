import type {
  DashboardCard,
  FxInfo,
  Holding,
  HistoryResponse,
  RebalanceCurrent,
  RebalanceTarget,
  RefreshResult,
  Settings,
  SettingsUpdate,
  SymbolMatch,
  HealthInfo,
  Stock,
  StockCreateInput,
  StockCreateResult,
  StockUpdateInput,
} from '../types'

const BASE = '/api'

/**
 * API 오류. 백엔드는 실패 사유를 `hint`(사용자가 할 일)와 `message`(기술적 원인)로 나눠
 * 내려주므로, 화면에서 안내를 앞세우고 기술적 내용은 접어둘 수 있다.
 */
export class ApiError extends Error {
  readonly status: number
  readonly hint: string | null
  readonly detail: string

  constructor(status: number, hint: string | null, detail: string) {
    super(hint || detail || `요청이 실패했습니다 (HTTP ${status})`)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
    this.detail = detail
  }
}

function parseError(status: number, statusText: string, body: string): ApiError {
  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.detail
    if (detail && typeof detail === 'object') {
      return new ApiError(status, detail.hint ?? null, detail.message ?? body)
    }
    if (typeof detail === 'string') {
      return new ApiError(status, null, detail)
    }
  } catch {
    // JSON이 아니면 본문을 그대로 쓴다
  }
  return new ApiError(status, null, body || `${status} ${statusText}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw parseError(res.status, res.statusText, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  getHealth: () => request<HealthInfo>('/health'),

  /** 종목명/코드로 후보를 찾는다 — 사용자가 고른 뒤에 등록한다 */
  searchSymbols: (q: string, limit = 8) =>
    request<SymbolMatch[]>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  listStocks: () => request<Stock[]>('/stocks'),
  createStock: (payload: StockCreateInput) =>
    request<StockCreateResult>('/stocks', { method: 'POST', body: JSON.stringify(payload) }),
  updateStock: (ticker: string, payload: StockUpdateInput) =>
    request<Stock>(`/stocks/${ticker}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deactivateStock: (ticker: string) => request<Stock>(`/stocks/${ticker}`, { method: 'DELETE' }),
  refreshStock: (ticker: string) => request<unknown>(`/stocks/${ticker}/refresh`, { method: 'POST' }),
  refreshAll: () => request<RefreshResult[]>('/stocks/refresh-all', { method: 'POST' }),

  getDashboard: () => request<DashboardCard[]>('/dashboard'),

  getHistory: (ticker: string, range: string = '1y') =>
    request<HistoryResponse>(`/history/${ticker}?range=${range}`),

  confirmBuy: (id: number, applyToHolding: boolean) =>
    request<{ id: number; status: string }>(`/buy-executions/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ apply_to_holding: applyToHolding }),
    }),

  listRebalanceTargets: () => request<RebalanceTarget[]>('/rebalance/targets'),
  updateRebalanceTarget: (ticker: string, payload: Partial<RebalanceTarget>) =>
    request<RebalanceTarget>(`/rebalance/targets/${ticker}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listHoldings: () => request<Holding[]>('/rebalance/holdings'),
  updateHolding: (ticker: string, quantity: number) =>
    request<Holding>(`/rebalance/holdings/${ticker}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    }),

  getSettings: () => request<Settings>('/rebalance/settings'),
  updateSettings: (payload: SettingsUpdate) =>
    request<Settings>('/rebalance/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  refreshFx: () => request<FxInfo>('/rebalance/fx/refresh', { method: 'POST' }),

  getRebalanceCurrent: () => request<RebalanceCurrent>('/rebalance/current'),
}
