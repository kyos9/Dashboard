import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DashboardCard } from '../types'

function fmt(n: number | null, digits = 2): string {
  return n === null || n === undefined ? '-' : n.toFixed(digits)
}

function Badge({ children, variant }: { children: React.ReactNode; variant: string }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

export function Dashboard() {
  const [cards, setCards] = useState<DashboardCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    api
      .getDashboard()
      .then(setCards)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleConfirm = async (buyId: number) => {
    setBusyId(buyId)
    try {
      await api.confirmBuy(buyId, true)
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <p>불러오는 중...</p>
  if (error) return <p className="error-text">{error}</p>
  if (cards.length === 0) return <p className="hint">등록된 종목이 없습니다. 종목 관리 화면에서 추가해주세요.</p>

  return (
    <div>
      <h2>종목별 현재 상태</h2>
      <div className="card-grid">
        {cards.map((card) => (
          <div key={card.ticker} className="card">
            <div className="card-header">
              <h3>{card.ticker}</h3>
              {card.data_stale && <Badge variant="danger">데이터 갱신 필요</Badge>}
            </div>
            <p className="card-price">{fmt(card.indicators.close)}</p>

            <div className="badge-row">
              {card.knee_buy_v2 && <Badge variant="success">무릎매수 충족</Badge>}
              {card.shoulder_sell_ref && <Badge variant="orange">어깨매도(참고)</Badge>}
              {card.rebalance_signal.active &&
                card.rebalance_signal.reasons.map((r) => (
                  <Badge variant="purple" key={r}>
                    {r}
                  </Badge>
                ))}
            </div>

            <table className="stat-table">
              <tbody>
                <tr>
                  <td>MA20</td>
                  <td>{fmt(card.indicators.ma20)}</td>
                  <td>MA50</td>
                  <td>{fmt(card.indicators.ma50)}</td>
                </tr>
                <tr>
                  <td>이격도</td>
                  <td>{fmt(card.indicators.disparity)}%</td>
                  <td>ADX</td>
                  <td>{fmt(card.indicators.adx)}</td>
                </tr>
                <tr>
                  <td>+DI / -DI</td>
                  <td colSpan={3}>
                    {fmt(card.indicators.plus_di)} / {fmt(card.indicators.minus_di)}
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="card-footer">
              {card.current_period_buy ? (
                <div>
                  <p style={{ margin: '0 0 6px' }}>
                    이번 기간 매수: <strong>{card.current_period_buy.type === 'signal' ? '시그널' : '정기(폴백)'}</strong>
                    <br />
                    {card.current_period_buy.exec_date} · {card.current_period_buy.amount.toLocaleString()}
                  </p>
                  {card.current_period_buy.status === 'recommended' ? (
                    <div className="btn-group">
                      <Badge variant="warning">추천 (미확정)</Badge>
                      <button disabled={busyId === card.current_period_buy.id} onClick={() => handleConfirm(card.current_period_buy!.id)}>
                        매수완료 확인
                      </button>
                    </div>
                  ) : (
                    <Badge variant="success">확정됨</Badge>
                  )}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>
                  이번 기간 매수 추천 없음
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
