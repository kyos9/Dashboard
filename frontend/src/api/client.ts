import type {
  DashboardCard,
  Holding,
  HistoryResponse,
  RebalanceRow,
  RebalanceTarget,
  Settings,
  Stock,
  StockCreateInput,
  StockUpdateInput,
} from '../types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  listStocks: () => request<Stock[]>('/stocks'),
  createStock: (payload: StockCreateInput) =>
    request<Stock>('/stocks', { method: 'POST', body: JSON.stringify(payload) }),
  updateStock: (ticker: string, payload: StockUpdateInput) =>
    request<Stock>(`/stocks/${ticker}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deactivateStock: (ticker: string) => request<Stock>(`/stocks/${ticker}`, { method: 'DELETE' }),
  refreshStock: (ticker: string) => request<unknown>(`/stocks/${ticker}/refresh`, { method: 'POST' }),

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
  updateSettings: (payload: Settings) =>
    request<Settings>('/rebalance/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  getRebalanceCurrent: () => request<RebalanceRow[]>('/rebalance/current'),
}
