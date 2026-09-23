import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
 * - 비밀번호 하나: 비밀번호 칸.
 * - 구글 계정: "구글 계정으로 로그인" 버튼. 들어오면 계정마다 자기 데이터가 보인다.
 */
interface AuthValue {
  /** 서버가 잠겨 있는지. 개인 PC에서는 false */
  locked: boolean
  mode: AuthMode
  /** 구글 모드에서 들어와 있는 사람 */
  user: AuthUser | null
  logout: () => Promise<void>
  /** 탈퇴. 성공하면 로그인 화면으로 돌아간다 */
  withdraw: () => Promise<void>
}

const Ctx = createContext<AuthValue>({
  locked: false,
  mode: 'open',
  user: null,
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
    '이 구글 계정은 아직 들어올 수 없습니다. 주인에게 쓰시는 구글 이메일 주소를 알려주고 추가해 달라고 해주세요.',
  cancelled: '구글 화면에서 로그인을 취소했습니다.',
  expired: '로그인이 중간에 끊겼습니다 (시간이 지났거나 다른 창에서 시작했습니다). 다시 눌러주세요.',
  failed: '구글 로그인을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  config: '서버의 구글 로그인 설정이 덜 됐습니다. 주인에게 알려주세요.',
}

/** 화면 이동. 테스트가 바꿔 끼운다 (jsdom 은 실제로 이동하지 못한다). */
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
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(takeLoginError)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return
        setLocked(status.locked)
        // 옛 서버는 mode 를 안 보낸다 — 그때는 잠겼으면 비밀번호 문이다
        setMode(status.mode ?? (status.locked ? 'password' : 'open'))
        setUser(status.user ?? null)
        setConfigProblem(status.config_problem ?? null)
        setPhase(status.locked && !status.authenticated ? 'locked' : 'open')
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
    // 세션이 만료되면 어느 화면에서 무슨 요청을 하고 있었든 여기로 돌아온다
    const onUnauthorized = () => {
      setLocked(true)
      setUser(null)
      setPhase('locked')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setPassword('')
      setError(null)
      setUser(null)
      setPhase('locked')
    }
  }, [])

  const withdraw = useCallback(async () => {
    // 실패하면 그대로 던진다 — 확인 창이 사유를 보여준다. 여기서 삼키면 "눌렀는데
    // 그대로"가 되고, 탈퇴가 됐는지 안 됐는지 알 수 없다.
    await api.withdraw()
    setUser(null)
    setError(null)
    setPhase('locked')
  }, [])

  const value = useMemo(
    () => ({ locked, mode, user, logout, withdraw }),
    [locked, mode, user, logout, withdraw],
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

  if (phase === 'locked' && mode === 'google') {
    return (
      <div className="login-shell">
        <div className="panel login-panel">
          <div className="login-brand">
            <span aria-hidden="true">📈</span>
            <h1>신호판</h1>
          </div>
          <p className="hint">구글 계정으로 들어갑니다. 계정마다 자기 종목과 포트폴리오가 따로 보입니다.</p>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {configProblem && (
            <p className="error-text" role="alert">
              {LOGIN_ERRORS.config} ({configProblem})
            </p>
          )}

          <button
            type="button"
            className="primary"
            disabled={configProblem !== null}
            onClick={() => browser.go(GOOGLE_LOGIN_URL)}
          >
            구글 계정으로 로그인
          </button>
        </div>
      </div>
    )
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
