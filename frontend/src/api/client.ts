import type {
  AdminUser,
  AiAnalysis,
  AiContext,
  AiModelsResponse,
  AiProviderName,
  AiTarget,
  AuthStatus,
  DashboardCard,
  FxInfo,
  Holding,
  FundamentalsResponse,
  HistoryResponse,
  RebalanceCurrent,
  RebalanceSnapshot,
  RebalanceTarget,
  RefreshResult,
  Settings,
  SettingsUpdate,
  ListingRefreshResult,
  ListingStatus,
  SymbolMatch,
  HealthInfo,
  LogsResponse,
  SlowRequestsResponse,
  MacroHistory,
  MacroOverview,
  MacroPinned,
  MacroRefreshResult,
  MacroSeriesInfo,
  PushKind,
  PushSettings,
  PushSubscriptionInput,
  Stock,
  StockCreateInput,
  StockCreateResult,
  StockRefreshResult,
  StockUpdateInput,
  UserStatus,
} from '../types'

import { clearCache } from '../lib/cache'

const BASE = '/api'

/** AI 키를 싣는 헤더. 본문에 넣지 않는다 (서버 `routers/ai.py` 참고) */
const AI_KEY_HEADER = 'X-AI-Key'

/** 구글 로그인 시작 주소. fetch 가 아니라 **화면 이동**으로 가야 한다 (구글 화면을 거친다) */
export const GOOGLE_LOGIN_URL = `${BASE}/auth/google/start`

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
  /** 화면이 갈래를 나눠야 하는 오류의 이름 (예: AI 키가 틀림 → 키 입력을 다시 연다) */
  readonly code: string | null

  constructor(status: number, hint: string | null, detail: string, code: string | null = null) {
    super(hint || detail || `요청이 실패했습니다 (HTTP ${status})`)
    this.name = 'ApiError'
    this.status = status
    this.hint = hint
    this.detail = detail
    this.code = code
  }
}

function parseError(status: number, statusText: string, body: string): ApiError {
  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.detail
    if (detail && typeof detail === 'object') {
      return new ApiError(status, detail.hint ?? null, detail.message ?? body, detail.code ?? null)
    }
    if (typeof detail === 'string') {
      return new ApiError(status, null, detail)
    }
  } catch {
    // JSON이 아니면 본문을 그대로 쓴다
  }
  return new ApiError(status, null, body || `${status} ${statusText}`)
}

async function failure(res: Response, path: string): Promise<ApiError> {
  const body = await res.text().catch(() => '')
  // 로그인 자체가 실패한 401은 로그인 화면이 직접 다루므로 신호를 보내지 않는다
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  return parseError(res.status, res.statusText, body)
}

/**
 * 서버의 값을 바꾸지 않는 POST — 이것들은 캐시를 비우지 않는다. AI 는 글만 받아 오고,
 * 시험 알림은 기기에 한 번 울릴 뿐이다.
 */
const READ_ONLY_POSTS = [/^\/ai\//, /^\/push\/test$/]

/**
 * 쓰기 요청이 끝났으면(성공이든 실패든) 화면 캐시를 비운다 (ROADMAP 8-1).
 *
 * 화면마다 저장 뒤 `notifyDataChanged` 를 부르지만, 하나라도 빠뜨리면 다른 탭이 고치기 전
 * 값을 보여준다. 여기서 한 번에 막는다. 실패도 비운다 — 여러 건을 한꺼번에 보내다 일부만
 * 저장됐을 수 있다. 응답을 받은 **뒤에** 비운다: 먼저 비우면 그 사이에 떠난 읽기가 고치기
 * 전 값을 새 세대로 담는다.
 */
function invalidatesCache(path: string, init?: RequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return false
  return !READ_ONLY_POSTS.some((pattern) => pattern.test(path))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (invalidatesCache(path, init)) clearCache()
  if (!res.ok) throw await failure(res, path)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// --- 써지는 대로 받기 (AI, 3c-2) ---------------------------------------------
// 서버는 text/event-stream 으로 start → delta… → done (또는 error) 을 보낸다. 웹을 찾는 종목 분석은
// 사이사이 search 가 온다 (9-13). EventSource 는
// POST·헤더를 못 쓰므로(키는 헤더로 간다) fetch 로 받아 직접 나눈다.

export interface SseEvent {
  event: string
  data: string
}

/** 받은 글에서 끝난 이벤트(빈 줄로 끝난 것)만 떼어 내고, 남은 조각을 돌려준다. */
export function takeSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const blocks = buffer.replace(/\r\n?/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

export interface AiStreamStart {
  provider: AiProviderName
  model: string
  as_of: string | null
}

/** 웹을 찾는 중 (9-13). reset 이면 서버가 그 앞의 글(검색 전 머리말)을 버렸다 — 화면도 지운다 */
export interface AiStreamSearch {
  count: number
  reset: boolean
}

export interface AiStreamHandlers {
  onStart?: (info: AiStreamStart) => void
  onSearch?: (info: AiStreamSearch) => void
  /** 새로 온 글 조각 */
  onDelta: (text: string) => void
  /** 멈추기·팝업 닫기 — 끊으면 서버가 제공자와의 연결도 닫는다 */
  signal?: AbortSignal
}

/** 흘려받기가 done 없이 끝났다 — 서버나 중간 연결이 끊겼다 */
const CUT_HINT = 'AI 글을 받는 도중에 연결이 끊겼습니다. 다시 받아 보세요.'

/**
 * 정리마다의 주소. 종목 정리는 옛 모양(`/ai/context/{t}` · `/ai/analyze/{t}/stream`)을 그대로 두고,
 * 종목 분석(관리자만)은 `/ai/research/{t}/…`, 나머지는 `/ai/{kind}/…`.
 */
export function aiPath(target: AiTarget, what: 'context' | 'stream'): string {
  if (target.kind === 'stock') {
    const t = encodeURIComponent(target.ticker)
    return what === 'context' ? `/ai/context/${t}` : `/ai/analyze/${t}/stream`
  }
  if (target.kind === 'research') return `/ai/research/${encodeURIComponent(target.ticker)}/${what}`
  return `/ai/${target.kind}/${what}`
}

async function streamAi(path: string, key: string, body: unknown, handlers: AiStreamHandlers): Promise<AiAnalysis> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [AI_KEY_HEADER]: key },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  // 글을 쓰기 전의 거절(키·한도·모델)은 평소 오류와 같은 JSON 으로 온다
  if (!res.ok) throw await failure(res, path)

  let result: AiAnalysis | null = null
  const handle = (ev: SseEvent) => {
    const data = JSON.parse(ev.data)
    if (ev.event === 'start') handlers.onStart?.(data as AiStreamStart)
    else if (ev.event === 'delta') handlers.onDelta(String(data.text ?? ''))
    else if (ev.event === 'search') handlers.onSearch?.(data as AiStreamSearch)
    else if (ev.event === 'done') result = data as AiAnalysis
    else if (ev.event === 'error') throw new ApiError(data.status ?? 502, data.hint ?? null, data.message ?? '', data.code ?? null)
  }

  let buffer = ''
  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const taken = takeSseEvents(done ? `${buffer}\n\n` : buffer)
      buffer = taken.rest
      taken.events.forEach(handle)
      if (done) break
    }
  } else {
    // 흘려받기를 못 하는 브라우저 — 다 온 뒤에 한 번에 나눈다
    takeSseEvents(`${await res.text()}\n\n`).events.forEach(handle)
  }
  if (!result) throw new ApiError(502, CUT_HINT, 'stream ended without done', 'cut')
  return result
}

export const api = {
  getHealth: () => request<HealthInfo>('/health'),

  /** 잠겨 있는지 · 들어와 있는지. 화면이 제일 먼저 묻는다 */
  getAuthStatus: () => request<AuthStatus>('/auth/status'),
  login: (password: string) =>
    request<AuthStatus>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<AuthStatus>('/auth/logout', { method: 'POST' }),
  /** 탈퇴 — 내 종목·보유수량·매수 기록·설정과 계정을 지운다 */
  withdraw: () => request<void>('/auth/me', { method: 'DELETE' }),
  /** 관리자 — 사용자 목록과 가입 승인 */
  listUsers: () => request<AdminUser[]>('/admin/users'),
  setUserStatus: (userId: number, status: Exclude<UserStatus, 'pending'>) =>
    request<AdminUser>(`/admin/users/${userId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  /** 종목명/코드로 후보를 찾는다 — 사용자가 고른 뒤에 등록한다 */
  searchSymbols: (q: string, limit = 8) =>
    request<SymbolMatch[]>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  /** 지금 몇 종목이 검색 가능한지 — 내장 목록만인지, 거래소 목록까지 받았는지 */
  getListingStatus: () => request<ListingStatus>('/symbols/listing-status'),
  /** 국내(네이버, 안 되면 한국거래소)·미국(나스닥 트레이더, 안 되면 SEC) 상장목록을 다시 받아
   *  캐시한다 (신규 상장·사명 변경 반영) */
  refreshSymbolListing: () =>
    request<ListingRefreshResult>('/symbols/refresh-listing', { method: 'POST' }),

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
  // `full` 은 관리자만 (아직 한 줄도 없는 종목은 서버가 알아서 전체를 받는다).
  // 같은 종목은 10분에 한 번만 실제로 받는다 — 그 안에 누르면 `skipped` 와 언제 받았는지가 온다.
  refreshStock: (ticker: string, full = false) =>
    request<StockRefreshResult>(`/stocks/${ticker}/refresh${full ? '?full=true' : ''}`, { method: 'POST' }),
  refreshAll: () => request<RefreshResult[]>('/stocks/refresh-all', { method: 'POST' }),

  getDashboard: () => request<DashboardCard[]>('/dashboard'),

  getHistory: (ticker: string, range: string = '1y') =>
    request<HistoryResponse>(`/history/${ticker}?range=${range}`),

  /** 차트 팝업의 "재무" 탭 — 공시 값과 그날 종가로 계산한 지표 */
  listFundamentals: () => request<FundamentalsResponse[]>('/fundamentals'),
  getFundamentals: (ticker: string) => request<FundamentalsResponse>(`/fundamentals/${ticker}`),

  listRebalanceTargets: () => request<RebalanceTarget[]>('/rebalance/targets'),
  updateRebalanceTarget: (ticker: string, payload: Partial<RebalanceTarget>) =>
    request<RebalanceTarget>(`/rebalance/targets/${ticker}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  listHoldings: () => request<Holding[]>('/rebalance/holdings'),
  /** 평단가(`avgCost`)·산 환율(`avgFx`)은 넘겼을 때만 바뀐다. null이면 "모름"으로 지운다 */
  updateHolding: (ticker: string, quantity: number, avgCost?: number | null, avgFx?: number | null) =>
    request<Holding>(`/rebalance/holdings/${ticker}`, {
      method: 'PUT',
      body: JSON.stringify({
        quantity,
        ...(avgCost === undefined ? {} : { avg_cost: avgCost }),
        ...(avgFx === undefined ? {} : { avg_fx: avgFx }),
      }),
    }),

  getSettings: () => request<Settings>('/rebalance/settings'),
  updateSettings: (payload: SettingsUpdate) =>
    request<Settings>('/rebalance/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  refreshFx: () => request<FxInfo>('/rebalance/fx/refresh', { method: 'POST' }),

  getRebalanceCurrent: () => request<RebalanceCurrent>('/rebalance/current'),

  /** 리밸런싱 기록 — 최근 것부터 */
  listSnapshots: () => request<RebalanceSnapshot[]>('/rebalance/snapshots'),
  /** 지금 모습을 기록으로 남긴다. 남기면 다음 리뷰일이 다음 기간으로 넘어간다 */
  createSnapshot: (note?: string) =>
    request<RebalanceSnapshot>('/rebalance/snapshots', {
      method: 'POST',
      body: JSON.stringify({ note: note || null }),
    }),
  deleteSnapshot: (id: number) =>
    request<void>(`/rebalance/snapshots/${id}`, { method: 'DELETE' }),

  /** 지표 목록 + 최신값 + 갱신 상태, 그리고 금리차 */
  getMacro: () => request<MacroOverview>('/macro'),
  /** 차트용 시계열. 기본 5년 — 지금 금리가 높은지는 2020년이 화면에 있어야 보인다 */
  getMacroHistory: (code: string, range: string = '5y') =>
    request<MacroHistory>(`/macro/${encodeURIComponent(code)}?range=${range}`),
  /** 사람이 누르는 갱신 — 배치와 달리 "받을 때가 됐는지"를 따지지 않는다 */
  refreshMacro: () => request<MacroRefreshResult[]>('/macro/refresh', { method: 'POST' }),

  /** 홈에 띄울 지표. 홈은 고른 것만 읽는다 — 셋 보여주려고 아홉 개를 계산할 이유가 없다 */
  getMacroPinned: () => request<MacroPinned>('/macro/pinned'),

  setMacroPinned: (codes: string[]) =>
    request<MacroPinned>('/macro/pinned', { method: 'PUT', body: JSON.stringify({ codes }) }),

  /** 예상치를 직접 넣는다. 같은 날 다시 넣으면 덮어쓴다 (오타를 고치는 길이 그것뿐이다) */
  setMacroForecast: (code: string, asOf: string, value: number) =>
    request<MacroSeriesInfo>(`/macro/${encodeURIComponent(code)}/forecast`, {
      method: 'PUT',
      body: JSON.stringify({ as_of: asOf, value }),
    }),

  /** 그 달에 직접 넣어둔 예상치를 지운다. 받아온 예상치는 안 건드린다 */
  clearMacroForecast: (code: string, asOf: string) =>
    request<MacroSeriesInfo>(
      `/macro/${encodeURIComponent(code)}/forecast?as_of=${encodeURIComponent(asOf)}`,
      { method: 'DELETE' },
    ),

  /** 푸시 알림 — 서버 공개키, 받을 종류, 이 기기 켜기·끄기, 시험 */
  getPushKey: () => request<{ public_key: string }>('/push/key'),
  getPushSettings: () => request<PushSettings>('/push/settings'),
  setPushKinds: (kinds: PushKind[]) =>
    request<PushSettings>('/push/settings', { method: 'PUT', body: JSON.stringify({ kinds }) }),
  addPushSubscription: (subscription: PushSubscriptionInput) =>
    request<{ ok: boolean }>('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  removePushSubscription: (endpoint: string) =>
    request<void>('/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  sendTestPush: () => request<{ sent: number; failed: number }>('/push/test', { method: 'POST' }),

  /**
   * AI 분석 (3c). **키는 헤더로만 보낸다** — 서버는 중계만 하고 저장하지 않는다.
   * 키는 이 기기에만 있다 (`lib/aiKey.ts`).
   */
  aiModels: (provider: AiProviderName, key: string) =>
    request<AiModelsResponse>('/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [AI_KEY_HEADER]: key },
      body: JSON.stringify({ provider }),
    }),
  /** AI 에게 보내는 내용 그대로 — 키 없이도 볼 수 있다 */
  aiContext: (target: AiTarget, question = '') =>
    request<AiContext>(
      `${aiPath(target, 'context')}${question.trim() ? `?question=${encodeURIComponent(question)}` : ''}`,
    ),
  /**
   * 정리를 써지는 대로 받는다 (3c-2). `question` — 사용자가 붙이는 요청 (선택, 비우면 기본 정리).
   * 다 쓰면 한 번에 받을 때와 같은 모양의 결과로 끝난다.
   */
  aiAnalyzeStream: (
    target: AiTarget,
    provider: AiProviderName,
    model: string,
    key: string,
    question: string,
    handlers: AiStreamHandlers,
  ) =>
    streamAi(
      aiPath(target, 'stream'),
      key,
      { provider, model, question: question.trim() || null },
      handlers,
    ),

  getLogs: (level: 'warning' | 'all' = 'warning') =>
    request<LogsResponse>(`/logs?level=${level}`),
  /** 로그 파일 원본 주소. fetch가 아니라 브라우저가 직접 받게 둔다 */
  logsDownloadUrl: () => `${BASE}/logs/download`,
  getSlowRequests: () => request<SlowRequestsResponse>('/logs/slow'),
}
