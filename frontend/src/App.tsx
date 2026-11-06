import { Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppStateProvider } from './AppState'
import { AppHeader } from './components/AppHeader'
import { TabBar } from './components/TabBar'
import { AuthGate, useAuth } from './components/AuthGate'
import { RequireLogin } from './components/LoginPrompt'
import { PageBoundary } from './components/PageBoundary'
import { PageSkeleton } from './components/Skeleton'
import { Dashboard } from './pages/Dashboard'
import { GuestHome } from './pages/GuestHome'
import { AiSummaryPage, FundamentalsPage, MacroPanel, Policy, RebalancePanel, SettingsPage, StockDetailPage, StockManager, preloadPages } from './lib/pageChunks'
import { POLICY_PATH } from './lib/policy'

/** 첫 화면. 손님은 매크로 한 줄 + 로그인 안내, 들어온 사람은 내 대시보드. */
function Home() {
  const { guest } = useAuth()
  return guest ? <GuestHome /> : <Dashboard />
}

/**
 * 나눠 받는 탭을 감싼다 (ROADMAP 8-5) — 받는 동안은 회색 틀, 못 받으면 이 자리에만 안내.
 * 주소가 바뀌면 새로 만든다: 한 탭에서 넘어졌어도 다른 탭은 다시 그려 본다.
 */
function Tab({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <PageBoundary key={pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </PageBoundary>
  )
}

/**
 * 없는 주소 (0.45.0 D2). 예전에는 머리글·바닥글만 있고 본문이 비어 무엇이 잘못됐는지 몰랐다.
 * `/chart` · `/history` 는 옛 차트 주소라 종목 안으로 넘긴다(`ToStock`).
 */
function NotFound() {
  return (
    <div className="empty-state">
      <h3>없는 화면입니다</h3>
      <p>주소가 바뀌었거나 잘못 들어왔습니다.</p>
      <Link to="/" className="link-button">
        첫 화면으로
      </Link>
    </div>
  )
}

/**
 * 옛 차트 주소(`/history?ticker=VOO`, `/chart?ticker=VOO`)는 그 종목 안으로 — 북마크·알림 링크가 깨지지 않게
 * (디자인 4차 묶음 3: 차트는 종목 안의 탭). 종목이 없으면 종목 탭으로.
 */
function ToStock() {
  const { search } = useLocation()
  const ticker = new URLSearchParams(search).get('ticker')
  return <Navigate to={ticker ? `/stocks/${encodeURIComponent(ticker)}` : '/stocks'} replace />
}

/** 첫 화면이 그려진 뒤 한가할 때 다른 탭 코드를 받아 둔다 */
function PreloadTabs() {
  useEffect(() => preloadPages(), [])
  return null
}

function App() {
  return (
    <AuthGate>
      <AppStateProvider>
        <BrowserRouter>
          <AppHeader />
          <TabBar />
          <PreloadTabs />
          <main className="page">
            {/* 탭은 손님에게도 다 보인다 — 무엇이 있는지는 보여주고, 내 종목이 필요한
                화면에서 로그인을 권한다. 매크로만 로그인 없이 열린다. */}
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/history" element={<ToStock />} />
              <Route
                path="/fundamentals"
                element={
                  <RequireLogin title="로그인하면 담은 종목의 재무를 볼 수 있습니다">
                    <Tab>
                      <FundamentalsPage />
                    </Tab>
                  </RequireLogin>
                }
              />
              <Route
                path="/macro"
                element={
                  <Tab>
                    <MacroPanel />
                  </Tab>
                }
              />
              {/* 방침은 로그인 전에도 열린다 — 구글 동의 화면이 이 주소를 가리킨다 */}
              <Route
                path={POLICY_PATH}
                element={
                  <Tab>
                    <Policy />
                  </Tab>
                }
              />
              <Route
                path="/rebalance"
                element={
                  <RequireLogin title="로그인하면 내 포트폴리오의 비중을 볼 수 있습니다">
                    <Tab>
                      <RebalancePanel />
                    </Tab>
                  </RequireLogin>
                }
              />
              <Route
                path="/stocks"
                element={
                  <RequireLogin title="로그인하면 종목을 담을 수 있습니다">
                    <Tab>
                      <StockManager />
                    </Tab>
                  </RequireLogin>
                }
              />
              <Route
                path="/stocks/:ticker"
                element={
                  <RequireLogin title="로그인하면 담은 종목의 차트를 볼 수 있습니다">
                    <Tab>
                      <StockDetailPage />
                    </Tab>
                  </RequireLogin>
                }
              />
              <Route
                path="/settings"
                element={
                  <Tab>
                    <SettingsPage />
                  </Tab>
                }
              />
              {/* AI 정리는 창이 아니라 화면 하나 (디자인 4차 묶음 2 — 긴 글 읽기) */}
              <Route
                path="/ai/:kind"
                element={
                  <RequireLogin title="로그인하면 AI 정리를 볼 수 있습니다">
                    <Tab>
                      <AiSummaryPage />
                    </Tab>
                  </RequireLogin>
                }
              />
              <Route path="/chart" element={<ToStock />} />
              <Route path="*" element={<NotFound />} />
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
