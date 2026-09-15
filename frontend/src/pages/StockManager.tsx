import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DcaPeriod, RebalancePeriod, Stock, StockCreateInput } from '../types'

const emptyForm: StockCreateInput = {
  ticker: '',
  dca_amount: 0,
  dca_period: 'monthly',
  rebalance_period: 'quarterly',
  target_weight_pct: 0,
  rebalance_band_pct: undefined,
}

function StockRow({ stock, onSaved, onError }: { stock: Stock; onSaved: () => void; onError: (e: string) => void }) {
  const [dcaAmount, setDcaAmount] = useState(stock.dca_amount)
  const [dcaPeriod, setDcaPeriod] = useState<DcaPeriod>(stock.dca_period)
  const [rebalancePeriod, setRebalancePeriod] = useState<RebalancePeriod>(stock.rebalance_period)
  const [targetWeight, setTargetWeight] = useState(stock.target_weight_pct)
  const [bandPct, setBandPct] = useState<string>(
    stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct),
  )
  const [reviewOverride, setReviewOverride] = useState<string>(stock.review_date_override ?? '')
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateStock(stock.ticker, {
        dca_amount: dcaAmount,
        dca_period: dcaPeriod,
        rebalance_period: rebalancePeriod,
        target_weight_pct: targetWeight,
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
        review_date_override: reviewOverride === '' ? null : reviewOverride,
      })
      onSaved()
    } catch (e) {
      onError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    try {
      if (stock.active) {
        await api.deactivateStock(stock.ticker)
      } else {
        await api.updateStock(stock.ticker, { active: true })
      }
      onSaved()
    } catch (e) {
      onError(String(e))
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.refreshStock(stock.ticker)
      onSaved()
    } catch (e) {
      onError(String(e))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <tr className={stock.active ? '' : 'inactive'}>
      <td>
        <strong>{stock.ticker}</strong>
      </td>
      <td>
        <input type="number" style={{ width: 90 }} value={dcaAmount} onChange={(e) => setDcaAmount(Number(e.target.value))} />
      </td>
      <td>
        <select value={dcaPeriod} onChange={(e) => setDcaPeriod(e.target.value as DcaPeriod)}>
          <option value="monthly">월</option>
          <option value="quarterly">분기</option>
        </select>
      </td>
      <td>
        <div className="input-with-button">
          <input type="number" value={targetWeight} onChange={(e) => setTargetWeight(Number(e.target.value))} />
          <span>%</span>
        </div>
      </td>
      <td>
        <select value={rebalancePeriod} onChange={(e) => setRebalancePeriod(e.target.value as RebalancePeriod)}>
          <option value="quarterly">분기</option>
          <option value="semiannual">반기</option>
        </select>
      </td>
      <td>
        <input type="number" style={{ width: 80 }} placeholder="기본값" value={bandPct} onChange={(e) => setBandPct(e.target.value)} />
      </td>
      <td>
        <input type="date" value={reviewOverride} onChange={(e) => setReviewOverride(e.target.value)} />
      </td>
      <td>
        <div className="btn-group">
          <button className="primary" onClick={save} disabled={saving}>
            저장
          </button>
          <button onClick={refresh} disabled={refreshing}>
            새로고침
          </button>
          <button onClick={toggleActive}>{stock.active ? '비활성화' : '활성화'}</button>
        </div>
      </td>
    </tr>
  )
}

export function StockManager() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [form, setForm] = useState<StockCreateInput>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    api.listStocks().then(setStocks).catch((e) => setError(String(e)))
  }

  useEffect(load, [])

  const handleCreate = async () => {
    if (!form.ticker.trim()) {
      setError('티커를 입력해주세요.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await api.createStock({ ...form, ticker: form.ticker.trim().toUpperCase() })
      setForm(emptyForm)
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <h2>종목 관리</h2>
      {error && <p className="error-text">{error}</p>}

      <div className="form-row" style={{ marginBottom: 20 }}>
        <input
          style={{ width: 120 }}
          placeholder="티커 (예: VOO)"
          value={form.ticker}
          onChange={(e) => setForm({ ...form, ticker: e.target.value })}
        />
        <div className="field-group">
          <input
            type="number"
            style={{ width: 100 }}
            placeholder="DCA 금액"
            value={form.dca_amount}
            onChange={(e) => setForm({ ...form, dca_amount: Number(e.target.value) })}
          />
          <select value={form.dca_period} onChange={(e) => setForm({ ...form, dca_period: e.target.value as DcaPeriod })}>
            <option value="monthly">월</option>
            <option value="quarterly">분기</option>
          </select>
        </div>
        <div className="field-group">
          <input
            type="number"
            style={{ width: 90 }}
            placeholder="목표비중 %"
            value={form.target_weight_pct}
            onChange={(e) => setForm({ ...form, target_weight_pct: Number(e.target.value) })}
          />
        </div>
        <button className="primary" onClick={handleCreate} disabled={creating}>
          종목 추가
        </button>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>티커</th>
              <th>DCA 금액</th>
              <th>DCA 주기</th>
              <th>목표비중</th>
              <th>리밸런싱 주기</th>
              <th>밴드(%p)</th>
              <th>리뷰 마감일 오버라이드</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
              <StockRow key={s.ticker} stock={s} onSaved={load} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
