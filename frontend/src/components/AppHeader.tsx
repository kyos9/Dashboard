import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import type { HealthInfo } from '../types'

type Theme = 'dark' | 'light'

const THEME_KEY = 'signalboard.theme'

function readStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 브라우저가 저장소를 막아둔 경우 기본값으로 진행
  }
  return 'dark'
}

const TABS = [
  { to: '/', label: '대시보드', end: true },
  { to: '/history', label: '히스토리 차트', end: false },
  { to: '/rebalance', label: '리밸런싱', end: false },
  { to: '/stocks', label: '종목 관리', end: false },
]

export function AppHeader() {
  const { refreshAll, refreshing, lastSync, refreshError } = useAppState()
  const [theme, setTheme] = useState<Theme>(readStoredTheme)
  const [health, setHealth] = useState<HealthInfo | null>(null)

  // 실행 중인 백엔드 버전을 헤더에 띄운다 — 업데이트 후 서버를 다시 켰는지 한눈에 확인하려고.
  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // 저장 실패는 무시 — 이번 세션에만 적용된다
    }
  }, [theme])

  const status = refreshing
    ? { dot: 'warn', text: '시세 갱신 중…' }
    : refreshError
      ? { dot: 'bad', text: '갱신 실패' }
      : lastSync
        ? { dot: 'ok', text: '시세 연동 정상' }
        : { dot: 'ok', text: '저장된 데이터 표시 중' }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            📈
          </span>
          <div className="brand-text">
            <h1 className="brand-title">
              신호판
              <span className="badge badge-blue">무릎매수 v2</span>
              {health && (
                <span
                  className="badge badge-grey mono"
                  title={
                    `시세 제공자 — 해외: ${health.providers_by_market.US.join(' → ')}` +
                    ` / 국내: ${health.providers_by_market.KR.join(' → ')}`
                  }
                >
                  v{health.version}
                </span>
              )}
            </h1>
            <p className="brand-sub">기술적 타이밍 시그널 · DCA 매수 워크플로우 · 비중조절 신호</p>
          </div>
        </div>

        <div className="header-right">
          <span className="status-pill">
            <span className={`status-dot ${status.dot}`} aria-hidden="true" />
            {status.text}
            {lastSync && <span className="mono">갱신 {lastSync.toLocaleTimeString('ko-KR')}</span>}
          </span>
          <button onClick={() => void refreshAll()} disabled={refreshing} className="primary">
            {refreshing ? '갱신 중…' : '전체 새로고침'}
          </button>
          <button
            className="ghost"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}
            title={theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {refreshError && (
        <div className="header-alert">
          <span aria-hidden="true">⚠</span>
          <span>{refreshError}</span>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}
