import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './AppState'
import { AppHeader } from './components/AppHeader'
import { AuthGate, useAuth } from './components/AuthGate'
import { RequireLogin } from './components/LoginPrompt'
import { Dashboard } from './pages/Dashboard'
import { GuestHome } from './pages/GuestHome'
import { HistoryChart } from './pages/HistoryChart'
import { MacroPanel } from './pages/MacroPanel'
import { RebalancePanel } from './pages/RebalancePanel'
import { StockManager } from './pages/StockManager'

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
                    <HistoryChart />
                  </RequireLogin>
                }
              />
              <Route path="/macro" element={<MacroPanel />} />
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
        </BrowserRouter>
      </AppStateProvider>
    </AuthGate>
  )
}

export default App
