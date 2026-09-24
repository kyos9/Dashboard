import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { GOOGLE_LOGIN_URL, api, UNAUTHORIZED_EVENT } from '../api/client'
import type { AuthMode, AuthUser } from '../types'

/**
 * 서버에 올려둔 화면 앞에 세우는 문 (ROADMAP 5단계 · 4단계).
 *
 * 문은 셋 중 하나다 — 서버가 정한다.
 * - 잠금 없음 (개인 PC): 아무 일도 하지 않고 화면을 넘긴다.
 * - 비밀번호 하나: 비밀번호 칸. 맞춰야 화면이 열린다.
 * - 구글 계정: **문을 세우지 않는다.** 손님(로그인 전)도 화면에 들어와 둘러보고, 헤더의
 *   "로그인" 버튼으로 들어온다. 손님은 공용 매크로만 보고, 내 종목 화면들은 로그인
 *   안내로 바뀐다 (`RequireLogin`). 들어오면 계정마다 자기 데이터가 보인다.
 *
 * 누가 무엇을 하는지:
 * - 관리자(주인) — 전원의 시세·매크로 갱신, 진단 로그, 예상치 입력, 가입 승인
 * - 사용자 — 자기 종목·보유·설정
 * - 손님 — 매크로 보기. 구글로 가입 신청을 하고 승인을 기다리는 사람도 여기다.
 */
interface AuthValue {
  /** 서버가 잠겨 있는지. 개인 PC에서는 false */
  locked: boolean
  mode: AuthMode
  /** 구글 모드에서 들어와 있는 사람 */
  user: AuthUser | null
  /** 구글 모드에서 로그인 전 — 또는 가입 신청 뒤 승인을 기다리는 중. 공용 매크로만 본다 */
  guest: boolean
  /** 구글로 들어왔지만 관리자 승인을 기다리는 중 (`guest` 도 참이다) */
  pending: boolean
  /** 관리자에게만 — 기다리는 가입 신청 수. 헤더의 사용자 버튼에 뜬다 */
  pendingCount: number
  /** 승인·거절한 뒤 신청 수를 다시 센다 */
  recountPending: () => void
  /** 관리자 전용 버튼(전체 새로고침·진단·예상치 입력 등)을 보여줄지. 혼자 쓰는 서버는 늘 관리자다 */
  isAdmin: boolean
  /** 구글 로그인으로 보낸다 */
  login: () => void
  /** 로그인을 못 하는 이유 (서버 설정이 덜 됐다). 있으면 로그인 버튼을 막는다 */
  configProblem: string | null
  /** 구글에서 돌아왔는데 못 들어온 이유 (`?login_error=`) */
  loginError: string | null
  dismissLoginError: () => void
  logout: () => Promise<void>
  /** 탈퇴. 성공하면 손님 화면으로 돌아간다 */
  withdraw: () => Promise<void>
}

const Ctx = createContext<AuthValue>({
  locked: false,
  mode: 'open',
  user: null,
  guest: false,
  pending: false,
  pendingCount: 0,
  recountPending: () => {},
  isAdmin: true,
  login: () => {},
  configProblem: null,
  loginError: null,
  dismissLoginError: () => {},
  logout: async () => {},
  withdraw: async () => {},
})

export function useAuth(): AuthValue {
  return useContext(Ctx)
}

/**
 * 구글에서 돌아왔는데 들어오지 못한 이유 (`/?login_error=…`). 서버는 한 단어만 보내고
 * 문장은 여기서 고른다 — 주소창에 내부 사정을 띄우지 않으려는 것이다.
 *
 * **거절된 사람이 뭘 해야 하는지를 적는다.** 허용목록에 넣는 건 주인인데, 들어오려는
 * 사람은 그걸 모른다. 이유 없이 로그인 화면으로 되돌아가면 앱이 고장 난 것으로 보인다.
 */
export const LOGIN_ERRORS: Record<string, string> = {
  not_allowed:
    '이 구글 계정은 이메일 확인이 안 된 계정이라 들어올 수 없습니다. 다른 구글 계정으로 로그인해 주세요.',
  rejected: '가입 신청이 받아들여지지 않았습니다. 잘못된 것 같으면 관리자에게 문의해 주세요.',
  blocked: '이 계정은 관리자가 이용을 멈췄습니다. 관리자에게 문의해 주세요.',
  busy: '지금은 가입 신청이 많이 밀려 있어 새 신청을 받지 못합니다. 며칠 뒤 다시 시도해 주세요.',
  cancelled: '구글 화면에서 로그인을 취소했습니다.',
  expired: '로그인이 중간에 끊겼습니다 (시간이 지났거나 다른 창에서 시작했습니다). 다시 눌러주세요.',
  failed: '구글 로그인을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  config: '서버의 구글 로그인 설정이 덜 됐습니다. 관리자에게 알려주세요.',
}

/** 화면 이동. 테스트가 바꿔 끼운다 (jsdom 은 실제로 이동하지 못한다).
 *
 * 로그아웃·탈퇴 뒤에도 이걸로 첫 화면을 **새로 연다.** 화면마다 앞 사람의 종목을 들고
 * 있으므로, 하나라도 비우는 걸 잊으면 다음 사람(같은 폰의 가족)에게 보인다. 새로
 * 여는 것은 빠뜨릴 곳이 없다. */
export const browser = {
  go: (url: string) => window.location.assign(url),
}

/** 주소에 붙어 온 로그인 실패 사유를 읽고, 주소에서는 지운다 (새로고침해도 다시 안 뜨게). */
function takeLoginError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const reason = params.get('login_error')
  if (reason === null) return null
  params.delete('login_error')
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  return LOGIN_ERRORS[reason] ?? LOGIN_ERRORS.failed
}

type Phase = 'checking' | 'open' | 'locked'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [locked, setLocked] = useState(false)
  const [mode, setMode] = useState<AuthMode>('open')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [configProblem, setConfigProblem] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(takeLoginError)
  const [busy, setBusy] = useState(false)
  // 401 신호는 한 번 달아둔 듣는 함수가 받는다 — 그 안에서 지금 문이 무엇인지 읽으려고
  const modeRef = useRef<AuthMode>('open')

  useEffect(() => {
    let cancelled = false
    api
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return
        setLocked(status.locked)
        // 옛 서버는 mode 를 안 보낸다 — 그때는 잠겼으면 비밀번호 문이다
        const current = status.mode ?? (status.locked ? 'password' : 'open')
        modeRef.current = current
        setMode(current)
        setUser(status.user ?? null)
        setConfigProblem(status.config_problem ?? null)
        setPendingCount(status.pending_count ?? 0)
        // 구글 모드는 로그인 전에도 연다 — 손님으로 둘러본다
        setPhase(status.locked && !status.authenticated && current !== 'google' ? 'locked' : 'open')
      })
      .catch(() => {
        // 서버에 못 닿는 것과 잠긴 것은 다른 문제다. 여기서 막아버리면 "백엔드가 안 떴다"는
        // 사실이 로그인 화면에 가려져, 비밀번호를 몇 번이고 다시 넣어보게 된다.
        if (!cancelled) setPhase('open')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 세션이 만료되면 어느 화면에서 무슨 요청을 하고 있었든 여기로 돌아온다.
    // 구글 모드는 문이 없으니 손님으로 돌아간다 (내 종목 화면이 로그인 안내로 바뀐다).
    const onUnauthorized = () => {
      setLocked(true)
      setUser(null)
      if (modeRef.current !== 'google') setPhase('locked')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  /** 나간 뒤. 구글 모드는 첫 화면을 새로 열어 손님으로, 비밀번호 문은 비밀번호 칸으로. */
  const leave = useCallback(() => {
    setPassword('')
    setError(null)
    setUser(null)
    if (modeRef.current === 'google') browser.go('/')
    else setPhase('locked')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      leave()
    }
  }, [leave])

  const withdraw = useCallback(async () => {
    // 실패하면 그대로 던진다 — 확인 창이 사유를 보여준다. 여기서 삼키면 "눌렀는데
    // 그대로"가 되고, 탈퇴가 됐는지 안 됐는지 알 수 없다.
    await api.withdraw()
    leave()
  }, [leave])

  const recountPending = useCallback(() => {
    api
      .getAuthStatus()
      .then((status) => setPendingCount(status.pending_count ?? 0))
      .catch(() => {})
  }, [])

  const login = useCallback(() => browser.go(GOOGLE_LOGIN_URL), [])
  const dismissLoginError = useCallback(() => setError(null), [])

  // 승인 대기인 사람은 서버에서 손님과 똑같이 다뤄진다 — 화면도 손님처럼 그린다
  const pending = mode === 'google' && user?.status === 'pending'
  const guest = mode === 'google' && (user === null || pending)
  // 혼자 쓰는 서버(잠금 없음·비밀번호)는 들어온 사람이 곧 1번 — 관리자다
  const isAdmin = mode === 'google' ? user?.is_owner === true : true

  const value = useMemo(
    () => ({
      locked,
      mode,
      user,
      guest,
      pending,
      pendingCount,
      recountPending,
      isAdmin,
      login,
      configProblem,
      loginError: mode === 'google' ? error : null,
      dismissLoginError,
      logout,
      withdraw,
    }),
    [
      locked, mode, user, guest, pending, pendingCount, recountPending, isAdmin, login,
      configProblem, error, dismissLoginError, logout, withdraw,
    ],
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      setPassword('')
      setLocked(true)
      setPhase('open')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'checking') {
    return <div className="login-shell" aria-busy="true" />
  }

  if (phase === 'locked') {
    return (
      <div className="login-shell">
        <form className="panel login-panel" onSubmit={submit}>
          <div className="login-brand">
            <span aria-hidden="true">📈</span>
            <h1>신호판</h1>
          </div>
          <p className="hint">비밀번호를 넣어야 열립니다.</p>

          <div className="field">
            <label htmlFor="dashboard-password">비밀번호</label>
            <input
              id="dashboard-password"
              type="password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="primary" disabled={busy || password.length === 0}>
            {busy ? '확인 중…' : '들어가기'}
          </button>
        </form>
      </div>
    )
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
