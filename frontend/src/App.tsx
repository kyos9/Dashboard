import { Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './AppState'
import { AppHeader } from './components/AppHeader'
import { AuthGate, useAuth } from './components/AuthGate'
import { RequireLogin } from './components/LoginPrompt'
import { Dashboard } from './pages/Dashboard'
import { GuestHome } from './pages/GuestHome'
import { MacroPanel } from './pages/MacroPanel'
import { Policy } from './pages/Policy'
import { RebalancePanel } from './pages/RebalancePanel'
import { StockManager } from './pages/StockManager'
import { lazyChunk } from './lib/lazyChunk'
import { POLICY_PATH } from './lib/policy'

// 차트 라이브러리(lightweight-charts)는 번들의 3분의 1이다. 차트를 열 때만 받는다 —
// 첫 화면은 표와 숫자뿐이라, 폰에서 처음 여는 사람이 차트 코드까지 기다릴 이유가 없다.
const HistoryChart = lazyChunk(() => import('./pages/HistoryChart'), 'HistoryChart')

/** 첫 화면. 손님은 매크로 한 줄 + 로그인 안내, 들어온 사람은 내 대시보드. */
function Home() {
  const { guest } = useAuth()
  return guest ? <GuestHome /> : <Dashboard />
}

function App() {
  return (
    <AuthGate>
      <AppStateProvider>
        <BrowserRouter>
          <AppHeader />
          <main className="page">
            {/* 탭은 손님에게도 다 보인다 — 무엇이 있는지는 보여주고, 내 종목이 필요한
                화면에서 로그인을 권한다. 매크로만 로그인 없이 열린다. */}
            <Routes>
              <Route path="/" element={<Home />} />
              <Route
                path="/history"
                element={
                  <RequireLogin title="로그인하면 담은 종목의 차트를 볼 수 있습니다">
                    <Suspense fallback={<p className="hint">차트를 불러오는 중…</p>}>
                      <HistoryChart />
                    </Suspense>
                  </RequireLogin>
                }
              />
              <Route path="/macro" element={<MacroPanel />} />
              {/* 방침은 로그인 전에도 열린다 — 구글 동의 화면이 이 주소를 가리킨다 */}
              <Route path={POLICY_PATH} element={<Policy />} />
              <Route
                path="/rebalance"
                element={
                  <RequireLogin title="로그인하면 내 포트폴리오의 비중을 볼 수 있습니다">
                    <RebalancePanel />
                  </RequireLogin>
                }
              />
              <Route
                path="/stocks"
                element={
                  <RequireLogin title="로그인하면 종목을 담을 수 있습니다">
                    <StockManager />
                  </RequireLogin>
                }
              />
            </Routes>
          </main>
          <footer className="site-footer">
            <a href={POLICY_PATH}>개인정보처리방침 · 이용약관</a>
            <span>시그널은 참고용이며 투자 권유가 아닙니다.</span>
          </footer>
        </BrowserRouter>
      </AppStateProvider>
    </AuthGate>
  )
}

export default App
