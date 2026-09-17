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
import { api, UNAUTHORIZED_EVENT } from '../api/client'

/**
 * 서버에 올려둔 화면 앞에 세우는 문 (ROADMAP 5단계).
 *
 * 개인 PC에서는 아무 일도 하지 않는다 — 서버가 "잠겨 있지 않다"고 답하면 그대로
 * 화면을 넘긴다. 비밀번호를 정해둔 서버에서만 로그인 화면이 뜬다.
 */
interface AuthValue {
  /** 서버가 비밀번호로 잠겨 있는지. 개인 PC에서는 false */
  locked: boolean
  logout: () => Promise<void>
}

const Ctx = createContext<AuthValue>({ locked: false, logout: async () => {} })

export function useAuth(): AuthValue {
  return useContext(Ctx)
}

type Phase = 'checking' | 'open' | 'locked'

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return
        setLocked(status.locked)
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
      setPhase('locked')
    }
  }, [])

  const value = useMemo(() => ({ locked, logout }), [locked, logout])

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
