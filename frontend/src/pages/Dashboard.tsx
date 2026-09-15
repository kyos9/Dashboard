import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DashboardCard } from '../types'

function fmt(n: number | null, digits = 2): string {
  return n === null || n === undefined ? '-' : n.toFixed(digits)
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: '#fff',
        background: color,
        marginRight: 6,
      }}
    >
      {children}
    </span>
  )
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
  if (error) return <p style={{ color: 'red' }}>{error}</p>
  if (cards.length === 0) return <p>등록된 종목이 없습니다. 종목 관리 화면에서 추가해주세요.</p>

  return (
    <div>
      <h2>종목별 현재 상태</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {cards.map((card) => (
          <div
            key={card.ticker}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 16,
              background: '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0 }}>{card.ticker}</h3>
              {card.data_stale && <Badge color="#dc2626">데이터 갱신 필요</Badge>}
            </div>
            <p style={{ fontSize: 24, margin: '8px 0' }}>{fmt(card.indicators.close)}</p>

            <div style={{ marginBottom: 8 }}>
              {card.knee_buy_v2 && <Badge color="#16a34a">무릎매수 충족</Badge>}
              {card.shoulder_sell_ref && <Badge color="#f97316">어깨매도(참고)</Badge>}
              {card.rebalance_signal.active &&
                card.rebalance_signal.reasons.map((r) => (
                  <Badge color="#7c3aed" key={r}>
                    {r}
                  </Badge>
                ))}
            </div>

            <table style={{ width: '100%', fontSize: 12, color: '#444', borderCollapse: 'collapse' }}>
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

            <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
              {card.current_period_buy ? (
                <div style={{ fontSize: 13 }}>
                  이번 기간 매수:{' '}
                  <strong>{card.current_period_buy.type === 'signal' ? '시그널' : '정기(폴백)'}</strong> /{' '}
                  {card.current_period_buy.exec_date} / {card.current_period_buy.amount.toLocaleString()}
                  {card.current_period_buy.status === 'recommended' ? (
                    <div style={{ marginTop: 6 }}>
                      <Badge color="#eab308">추천 (미확정)</Badge>
                      <button
                        disabled={busyId === card.current_period_buy.id}
                        onClick={() => handleConfirm(card.current_period_buy!.id)}
                      >
                        매수완료 확인
                      </button>
                    </div>
                  ) : (
                    <Badge color="#16a34a">확정됨</Badge>
                  )}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: '#888' }}>이번 기간 매수 추천 없음</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
