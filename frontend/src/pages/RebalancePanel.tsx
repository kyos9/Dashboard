import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Holding, RebalanceRow, RebalanceTarget, Settings } from '../types'

interface MergedRow {
  ticker: string
  current: RebalanceRow
  target: RebalanceTarget | null
  holding: Holding | null
}

function EditableRow({ row, onSaved, onError }: { row: MergedRow; onSaved: () => void; onError: (e: string) => void }) {
  const [targetWeight, setTargetWeight] = useState(row.current.target_weight_pct)
  const [bandPct, setBandPct] = useState<string>(
    row.target?.rebalance_band_pct === null || row.target?.rebalance_band_pct === undefined
      ? ''
      : String(row.target.rebalance_band_pct),
  )
  const [quantity, setQuantity] = useState<string>(row.holding ? String(row.holding.quantity) : '0')
  const [saving, setSaving] = useState(false)

  const saveTarget = async () => {
    setSaving(true)
    try {
      await api.updateRebalanceTarget(row.ticker, {
        target_weight_pct: targetWeight,
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
      })
      onSaved()
    } catch (e) {
      onError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const saveHolding = async () => {
    setSaving(true)
    try {
      await api.updateHolding(row.ticker, Number(quantity))
      onSaved()
    } catch (e) {
      onError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const signal = row.current.rebalance_signal

  return (
    <tr>
      <td>
        <strong>{row.ticker}</strong>
      </td>
      <td>
        <input type="number" style={{ width: 60 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <button onClick={saveHolding} disabled={saving}>
          저장
        </button>
      </td>
      <td>
        <input
          type="number"
          style={{ width: 60 }}
          value={targetWeight}
          onChange={(e) => setTargetWeight(Number(e.target.value))}
        />
        %
      </td>
      <td>{row.current.actual_weight_pct.toFixed(1)}%</td>
      <td style={{ color: row.current.excess_pct > 0 ? '#dc2626' : row.current.excess_pct < 0 ? '#2563eb' : undefined }}>
        {row.current.excess_pct > 0 ? '+' : ''}
        {row.current.excess_pct.toFixed(1)}%p
      </td>
      <td>
        <input
          type="number"
          style={{ width: 60 }}
          placeholder="기본값"
          value={bandPct}
          onChange={(e) => setBandPct(e.target.value)}
        />
        <button onClick={saveTarget} disabled={saving}>
          저장
        </button>
      </td>
      <td>{row.current.next_review_date}</td>
      <td>{row.current.shoulder_signal_fired_in_period ? '발동' : '-'}</td>
      <td>
        {signal.active
          ? signal.reasons.map((r) => (
              <span
                key={r}
                style={{
                  display: 'inline-block',
                  background: '#7c3aed',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '2px 8px',
                  fontSize: 11,
                  marginRight: 4,
                }}
              >
                {r}
              </span>
            ))
          : '-'}
      </td>
    </tr>
  )
}

export function RebalancePanel() {
  const [rows, setRows] = useState<MergedRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [bandInput, setBandInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    Promise.all([api.getRebalanceCurrent(), api.listRebalanceTargets(), api.listHoldings(), api.getSettings()])
      .then(([current, targets, holdings, s]) => {
        const targetByTicker = new Map(targets.map((t) => [t.ticker, t]))
        const holdingByTicker = new Map(holdings.map((h) => [h.ticker, h]))
        setRows(
          current.map((c) => ({
            ticker: c.ticker,
            current: c,
            target: targetByTicker.get(c.ticker) ?? null,
            holding: holdingByTicker.get(c.ticker) ?? null,
          })),
        )
        setSettings(s)
        setBandInput(String(s.default_rebalance_band_pct))
      })
      .catch((e) => setError(String(e)))
  }

  useEffect(load, [])

  const saveSettings = async () => {
    try {
      await api.updateSettings({ default_rebalance_band_pct: Number(bandInput) })
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div>
      <h2>리밸런싱</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ marginBottom: 16 }}>
        전역 기본 밴드 임계값:{' '}
        <input type="number" style={{ width: 60 }} value={bandInput} onChange={(e) => setBandInput(e.target.value)} />
        %p <button onClick={saveSettings}>저장</button>
        {settings && <span style={{ marginLeft: 8, color: '#888' }}>(현재 적용값: {settings.default_rebalance_band_pct}%p)</span>}
      </div>

      {rows.length === 0 ? (
        <p>등록된 종목이 없습니다.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th>티커</th>
              <th>보유수량</th>
              <th>목표비중</th>
              <th>현재비중</th>
              <th>초과분</th>
              <th>밴드(%p)</th>
              <th>다음 리뷰 마감일</th>
              <th>어깨매도(참고) 발동</th>
              <th>비중조절 신호</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <EditableRow key={row.ticker} row={row} onSaved={load} onError={setError} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
