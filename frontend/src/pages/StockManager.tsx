import { useEffect, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { money } from '../lib/display'
import type { DcaPeriod, RebalancePeriod, Stock, StockCreateInput } from '../types'

const emptyForm: StockCreateInput = {
  ticker: '',
  name: '',
  category: '',
  dca_amount: 0,
  dca_period: 'monthly',
  rebalance_period: 'quarterly',
  target_weight_pct: 0,
}

/** 구분 입력을 돕는 예시값 — 자유 입력이므로 강제되지 않는다 */
const CATEGORY_SUGGESTIONS = ['지수', '알파', '안전자산']

function StockRow({ stock, onSaved, onError }: { stock: Stock; onSaved: () => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState(stock.name ?? '')
  const [category, setCategory] = useState(stock.category ?? '')
  const [dcaAmount, setDcaAmount] = useState(String(stock.dca_amount))
  const [dcaPeriod, setDcaPeriod] = useState<DcaPeriod>(stock.dca_period)
  const [rebalancePeriod, setRebalancePeriod] = useState<RebalancePeriod>(stock.rebalance_period)
  const [targetWeight, setTargetWeight] = useState(String(stock.target_weight_pct))
  const [bandPct, setBandPct] = useState(stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct))
  const [reviewOverride, setReviewOverride] = useState(stock.review_date_override ?? '')
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateStock(stock.ticker, {
        name: name.trim() === '' ? undefined : name.trim(),
        category: category.trim() === '' ? null : category.trim(),
        dca_amount: Number(dcaAmount),
        dca_period: dcaPeriod,
        rebalance_period: rebalancePeriod,
        target_weight_pct: Number(targetWeight),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
        review_date_override: reviewOverride === '' ? null : reviewOverride,
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    try {
      if (stock.active) await api.deactivateStock(stock.ticker)
      else await api.updateStock(stock.ticker, { active: true })
      onSaved()
    } catch (e) {
      onError(e)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    onError(null)
    try {
      await api.refreshStock(stock.ticker)
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <tr className={stock.active ? '' : 'inactive'}>
      <td>
        <div className="ticker-cell">
          <span className="ticker-name mono">{stock.ticker}</span>
          {!stock.active && <span className="badge badge-grey">비활성</span>}
        </div>
      </td>
      <td>
        <input type="text" value={name} placeholder="표시 이름" onChange={(e) => setName(e.target.value)} />
      </td>
      <td>
        <input
          type="text"
          list="category-options"
          value={category}
          placeholder="예: 지수"
          onChange={(e) => setCategory(e.target.value)}
        />
      </td>
      <td>
        <div className="input-with-button">
          <input type="number" step="any" value={dcaAmount} onChange={(e) => setDcaAmount(e.target.value)} />
          <select value={dcaPeriod} onChange={(e) => setDcaPeriod(e.target.value as DcaPeriod)} style={{ width: 74 }}>
            <option value="monthly">월</option>
            <option value="quarterly">분기</option>
          </select>
        </div>
      </td>
      <td>
        <div className="input-with-button">
          <input type="number" step="any" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
          <span className="unit">%</span>
        </div>
      </td>
      <td>
        <select
          value={rebalancePeriod}
          onChange={(e) => setRebalancePeriod(e.target.value as RebalancePeriod)}
        >
          <option value="quarterly">분기</option>
          <option value="semiannual">반기</option>
        </select>
      </td>
      <td>
        <div className="input-with-button">
          <input
            type="number"
            step="any"
            placeholder="기본값"
            value={bandPct}
            onChange={(e) => setBandPct(e.target.value)}
          />
          <span className="unit">%p</span>
        </div>
      </td>
      <td>
        <input type="date" value={reviewOverride} onChange={(e) => setReviewOverride(e.target.value)} />
      </td>
      <td>
        <div className="btn-group">
          <button className="primary sm" onClick={save} disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button className="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? '갱신 중…' : '시세 갱신'}
          </button>
          <button className="sm ghost" onClick={toggleActive}>
            {stock.active ? '비활성화' : '활성화'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export function StockManager() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [stocks, setStocks] = useState<Stock[]>([])
  const [form, setForm] = useState<StockCreateInput>(emptyForm)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<{ tone: 'green' | 'amber'; text: string; detail?: string } | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api
      .listStocks()
      .then(setStocks)
      .catch(setError)
  }, [refreshKey])

  const handleSaved = () => {
    setError(null)
    notifyDataChanged()
  }

  const handleCreate = async () => {
    const ticker = (form.ticker ?? '').trim().toUpperCase()
    if (!ticker) {
      setError('티커를 입력해주세요. (예: VOO)')
      return
    }
    setCreating(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api.createStock({
        ...form,
        ticker,
        name: form.name?.trim() === '' ? undefined : form.name,
        category: form.category?.trim() === '' ? null : form.category,
      })
      setForm(emptyForm)
      setNotice(
        result.data_loaded
          ? {
              tone: 'green',
              text: `${result.stock.ticker} 추가 완료 — 전체 시세를 내려받아 지표와 시그널을 계산했습니다.`,
            }
          : {
              tone: 'amber',
              text:
                `${result.stock.ticker}은(는) 등록됐지만 시세를 받지 못했습니다. ` +
                (result.data_hint ?? '아래 "시세 갱신"으로 다시 시도해주세요.'),
              detail: result.data_error ?? undefined,
            },
      )
      notifyDataChanged()
    } catch (e) {
      setError(e)
    } finally {
      setCreating(false)
    }
  }

  const targetSum = stocks.filter((s) => s.active).reduce((sum, s) => sum + s.target_weight_pct, 0)

  return (
    <div>
      <datalist id="category-options">
        {CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="page-head">
        <div>
          <h2>종목 관리</h2>
          <p className="hint">
            티커를 추가하면 전체 히스토리를 내려받아 지표·시그널을 계산합니다. 구분(지수/알파/안전자산 등)은
            자유 입력이며 대시보드 필터로 쓰입니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />
      {notice && (
        <div className={`callout ${notice.tone}`}>
          <span className="ico">{notice.tone === 'green' ? '✓' : '⚠'}</span>
          <div>
            {notice.text}
            {notice.detail && (
              <details className="error-detail">
                <summary>기술적 원인 보기</summary>
                <p>{notice.detail}</p>
              </details>
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-head">
          <h3>관심 종목 추가</h3>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="new-ticker">티커</label>
            <input
              id="new-ticker"
              type="text"
              placeholder="VOO"
              value={form.ticker}
              onChange={(e) => setForm({ ...form, ticker: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
          </div>
          <div className="field">
            <label htmlFor="new-name">표시 이름</label>
            <input
              id="new-name"
              type="text"
              placeholder="S&P 500 ETF"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-category">구분</label>
            <input
              id="new-category"
              type="text"
              list="category-options"
              placeholder="지수"
              value={form.category ?? ''}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-amount">DCA 금액</label>
            <input
              id="new-amount"
              type="number"
              step="any"
              value={form.dca_amount}
              onChange={(e) => setForm({ ...form, dca_amount: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="new-period">DCA 주기</label>
            <select
              id="new-period"
              value={form.dca_period}
              onChange={(e) => setForm({ ...form, dca_period: e.target.value as DcaPeriod })}
            >
              <option value="monthly">월</option>
              <option value="quarterly">분기</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="new-weight">목표 비중 (%)</label>
            <input
              id="new-weight"
              type="number"
              step="any"
              value={form.target_weight_pct}
              onChange={(e) => setForm({ ...form, target_weight_pct: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="primary" onClick={handleCreate} disabled={creating}>
              {creating ? '추가하는 중…' : '+ 종목 추가'}
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          DCA 금액 {money(form.dca_amount ?? 0)}을(를) {form.dca_period === 'monthly' ? '매월' : '매 분기'}{' '}
          매수하는 것으로 기록합니다. 시세 조회에 실패해도 종목 등록은 유지되며 나중에 다시 갱신할 수 있습니다.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>등록된 종목 {stocks.length}개</h3>
          <span className={`badge ${Math.abs(targetSum - 100) < 0.01 ? 'badge-green' : 'badge-amber'}`}>
            활성 종목 목표 비중 합계 {targetSum.toFixed(1)}%
          </span>
        </div>

        {stocks.length === 0 ? (
          <div className="empty-state">
            <h3>등록된 종목이 없습니다</h3>
            <p>위 입력창에 티커를 넣고 "종목 추가"를 눌러주세요.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" style={{ minWidth: 1260 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 92 }}>티커</th>
                  <th style={{ minWidth: 130 }}>표시 이름</th>
                  <th style={{ minWidth: 104 }}>구분</th>
                  <th style={{ minWidth: 215 }}>DCA 금액 / 주기</th>
                  <th style={{ minWidth: 155 }}>목표 비중</th>
                  <th style={{ minWidth: 92 }}>
                    리밸런싱
                    <br />
                    주기
                  </th>
                  <th style={{ minWidth: 155 }}>
                    밴드 임계값
                    <br />
                    (비워두면 기본값)
                  </th>
                  <th style={{ minWidth: 140 }}>
                    리뷰 마감일
                    <br />
                    직접 지정
                  </th>
                  <th style={{ minWidth: 210 }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <StockRow key={s.ticker} stock={s} onSaved={handleSaved} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
