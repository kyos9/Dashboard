import type { ReactNode } from 'react'
import { LOGIN_ERRORS, browser, useAuth } from './AuthGate'

/**
 * 손님(로그인 전) 화면 조각들 (ROADMAP 4-4).
 *
 * 구글 모드에서는 문을 세우지 않는다. 처음 온 사람이 무엇을 하는 도구인지 보지도 못하고
 * 로그인부터 하라는 화면을 만나면 대개 돌아간다. 그래서 들어와서 매크로를 둘러보고,
 * 자기 포트폴리오가 필요해지는 자리(대시보드·리밸런싱·종목 관리)에서 로그인을 권한다.
 */

/** "구글 계정으로 로그인". 서버 설정이 덜 됐으면 막고 이유를 툴팁에 둔다. */
export function LoginButton({ className = 'primary', label = '구글 계정으로 로그인' }: {
  className?: string
  label?: string
}) {
  const { login, configProblem } = useAuth()
  return (
    <button
      type="button"
      className={className}
      onClick={login}
      disabled={configProblem !== null}
      title={configProblem ? `${LOGIN_ERRORS.config} (${configProblem})` : undefined}
    >
      {label}
    </button>
  )
}

/**
 * 로그인하지 못한 이유 — 구글에서 거절돼 돌아왔거나, 서버 설정이 덜 됐거나.
 *
 * 헤더 바로 아래, **어느 탭에 있든** 보인다. 거절된 사람은 첫 화면으로 돌아오는데, 이유가
 * 한 탭 안에만 있으면 다른 탭으로 옮기는 순간 사라져 "눌러도 안 된다"만 남는다.
 */
export function GuestNotice() {
  const { guest, loginError, dismissLoginError, configProblem } = useAuth()
  if (!guest || (!loginError && !configProblem)) return null
  return (
    <div className="header-alert" role="alert">
      <span aria-hidden="true">⚠</span>
      <span>
        {loginError ?? `${LOGIN_ERRORS.config} (${configProblem})`}
      </span>
      {loginError && (
        <button className="ghost sm" onClick={dismissLoginError} aria-label="안내 닫기">
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * 가입 신청을 하고 승인을 기다리는 사람에게. 로그인 버튼 자리에 "기다리는 중"을 둔다 —
 * 로그인 버튼을 또 보여주면 눌러도 같은 화면이라 고장 난 것으로 보인다.
 */
export function PendingPrompt() {
  const { user } = useAuth()
  return (
    <div className="empty-state login-prompt">
      <h3>가입 신청을 받았습니다</h3>
      <p>
        {user?.email ? <b>{user.email}</b> : '이 계정'}으로 신청했습니다. 관리자가 승인하면 내 종목과
        포트폴리오를 만들 수 있습니다.
      </p>
      <p className="hint">
        승인을 기다리는 동안에도 <b>매크로</b> 탭은 볼 수 있습니다. 승인된 뒤에는 다시 로그인할 필요 없이
        아래 버튼이나 새로고침으로 바로 들어옵니다.
      </p>
      <button type="button" className="primary" onClick={() => browser.go('/')}>
        승인됐는지 확인
      </button>
    </div>
  )
}

/** 내 종목이 있어야 뜻이 있는 화면을 대신하는 안내. */
export function LoginPrompt({ title, children }: { title: string; children?: ReactNode }) {
  const { pending } = useAuth()
  if (pending) return <PendingPrompt />
  return (
    <div className="empty-state login-prompt">
      <h3>{title}</h3>
      {children}
      <p className="hint">
        구글 계정으로 들어오면 계정마다 자기 종목과 포트폴리오가 따로 저장됩니다. 로그인
        없이도 <b>매크로</b> 탭은 볼 수 있습니다.
      </p>
      <LoginButton />
    </div>
  )
}

/** 손님이면 안내를, 들어와 있으면 화면을 보여준다. */
export function RequireLogin({ title, children }: { title: string; children: ReactNode }) {
  const { guest } = useAuth()
  if (guest) return <LoginPrompt title={title} />
  return <>{children}</>
}
