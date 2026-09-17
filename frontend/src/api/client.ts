import type {
  AuthStatus,
  DashboardCard,
  FxInfo,
  Holding,
  HistoryResponse,
  RebalanceCurrent,
  RebalanceTarget,
  RefreshResult,
  Settings,
  SettingsUpdate,
  ListingStatus,
  SymbolMatch,
  HealthInfo,
  LogsResponse,
  Stock,
  StockCreateInput,
  StockCreateResult,
  StockUpdateInput,
} from '../types'

const BASE = '/api'

/**
 * 열쇠가 풀렸다는 신호 — 세션이 만료됐거나 서버에서 잠금이 켜졌다.
 * 로그인 화면(AuthGate)이 이걸 듣고 다시 뜬다. 화면마다 401을 따로 처리하면
 * 어느 한 곳을 빠뜨렸을 때 "아무것도 안 나오는데 이유를 모르는" 상태가 된다.
 */
export const UNAUTHORIZED_EVENT = 'signalboard:unauthorized'

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
    // 로그인 자체가 실패한 401은 로그인 화면이 직접 다루므로 신호를 보내지 않는다
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw parseError(res.status, res.statusText, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  getHealth: () => request<HealthInfo>('/health'),

  /** 잠겨 있는지 · 들어와 있는지. 화면이 제일 먼저 묻는다 */
  getAuthStatus: () => request<AuthStatus>('/auth/status'),
  login: (password: string) =>
    request<AuthStatus>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<AuthStatus>('/auth/logout', { method: 'POST' }),

  /** 종목명/코드로 후보를 찾는다 — 사용자가 고른 뒤에 등록한다 */
  searchSymbols: (q: string, limit = 8) =>
    request<SymbolMatch[]>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** 지금 몇 종목이 검색 가능한지 — 내장 목록만인지, 거래소 목록까지 받았는지 */
  getListingStatus: () => request<ListingStatus>('/symbols/listing-status'),
  /** 한국거래소 상장목록을 다시 받아 캐시한다 (신규 상장·사명 변경 반영) */
  refreshSymbolListing: () =>
    request<{ ok: boolean; count: number; error?: string; hint?: string }>(
      '/symbols/refresh-listing',
      { method: 'POST' },
    ),

  listStocks: () => request<Stock[]>('/stocks'),
  createStock: (payload: StockCreateInput) =>
    request<StockCreateResult>('/stocks', { method: 'POST', body: JSON.stringify(payload) }),
  updateStock: (ticker: string, payload: StockUpdateInput) =>
    request<Stock>(`/stocks/${ticker}`, { method: 'PUT', body: JSON.stringify(payload) }),
  /** 화면에 보여줄 순서를 저장한다 (보낸 차례가 곧 순서) */
  updateStockOrder: (tickers: string[]) =>
    request<Stock[]>('/stocks/order', { method: 'PUT', body: JSON.stringify({ tickers }) }),
  /** 종목과 딸린 기록을 전부 지운다 — 되돌릴 수 없다 */
  purgeStock: (ticker: string) =>
    request<void>(`/stocks/${encodeURIComponent(ticker)}/purge`, { method: 'DELETE' }),
  deactivateStock: (ticker: string) => request<Stock>(`/stocks/${ticker}`, { method: 'DELETE' }),
  /** `full`이면 처음 등록할 때처럼 전체 기간을 다시 받는다 (평소 갱신은 최근 2년) */
  refreshStock: (ticker: string, full = false) =>
    request<unknown>(`/stocks/${ticker}/refresh${full ? '?full=true' : ''}`, { method: 'POST' }),
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

  getLogs: (level: 'warning' | 'all' = 'warning') =>
    request<LogsResponse>(`/logs?level=${level}`),
  /** 로그 파일 원본 주소. fetch가 아니라 브라우저가 직접 받게 둔다 */
  logsDownloadUrl: () => `${BASE}/logs/download`,
}
