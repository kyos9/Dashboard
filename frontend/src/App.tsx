import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { NavBar } from './components/NavBar'
import { Dashboard } from './pages/Dashboard'
import { HistoryChart } from './pages/HistoryChart'
import { RebalancePanel } from './pages/RebalancePanel'
import { StockManager } from './pages/StockManager'

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <main style={{ padding: 20 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/history" element={<HistoryChart />} />
          <Route path="/rebalance" element={<RebalancePanel />} />
          <Route path="/stocks" element={<StockManager />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
