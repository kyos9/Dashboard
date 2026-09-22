import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './AppState'
import { AppHeader } from './components/AppHeader'
import { AuthGate } from './components/AuthGate'
import { Dashboard } from './pages/Dashboard'
import { HistoryChart } from './pages/HistoryChart'
import { MacroPanel } from './pages/MacroPanel'
import { RebalancePanel } from './pages/RebalancePanel'
import { StockManager } from './pages/StockManager'

function App() {
  return (
    <AuthGate>
      <AppStateProvider>
        <BrowserRouter>
          <AppHeader />
          <main className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/history" element={<HistoryChart />} />
              <Route path="/macro" element={<MacroPanel />} />
              <Route path="/rebalance" element={<RebalancePanel />} />
              <Route path="/stocks" element={<StockManager />} />
            </Routes>
          </main>
        </BrowserRouter>
      </AppStateProvider>
    </AuthGate>
  )
}

export default App
