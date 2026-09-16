import { useState } from 'react'
import { api } from '../api/client'
import { CURRENCY_META, MARKET_LABEL } from '../lib/display'
import type { DcaPeriod, RebalancePeriod, Stock } from '../types'
import { ErrorNotice } from './ErrorNotice'
import { NumberInput } from './NumberInput'

interface Props {
  stock: Stock
  onSaved: () => void
  onClose: () => void
}

/**
 * 대시보드에서 바로 종목 설정을 고치고 지운다.
 *
 * 값이 이상해 보여서 고치려면 종목 관리 화면으로 옮겨가 그 종목을 다시 찾아야 했다.
 * 보고 있는 자리에서 고칠 수 있어야 한다.
 */
export function StockEditModal({ stock, onSaved, onClose }: Props) {
  const [name, setName] = useState(stock.name ?? '')
  const [category, setCategory] = useState(stock.category ?? '')
  const [dcaAmount, setDcaAmount] = useState(String(stock.dca_amount))
  const [dcaPeriod, setDcaPeriod] = useState<DcaPeriod>(stock.dca_period)
  const [rebalancePeriod, setRebalancePeriod] = useState<RebalancePeriod>(stock.rebalance_period)
  const [targetWeight, setTargetWeight] = useState(String(stock.target_weight_pct))
  const [bandPct, setBandPct] = useState(
    stock.rebalance_band_pct === null ? '' : String(stock.rebalance_band_pct),
  )
  const [reviewOverride, setReviewOverride] = useState(stock.review_date_override ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const meta = CURRENCY_META[stock.currency]

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.updateStock(stock.ticker, {
        name: name.trim() === '' ? undefined : name.trim(),
        category: category.trim() === '' ? null : category.trim(),
        dca_amount: Number(dcaAmount || 0),
        dca_period: dcaPeriod,
        rebalance_period: rebalancePeriod,
        target_weight_pct: Number(targetWeight || 0),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
        review_date_override: reviewOverride === '' ? null : reviewOverride,
      })
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const deactivate = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.deactivateStock(stock.ticker)
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const purge = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.purgeStock(stock.ticker)
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${stock.name ?? stock.ticker} 설정`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{stock.name ?? stock.ticker}</h3>
            <span className="hint">
              {stock.ticker} · {MARKET_LABEL[stock.market]} · {meta.symbol}
              {stock.currency}
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        <div className="form-grid">
          <div className="field">
            <label htmlFor="edit-name">표시 이름</label>
            <input
              id="edit-name"
              type="text"
              value={name}
              placeholder={stock.ticker}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-category">구분</label>
            <input
              id="edit-category"
              type="text"
              list="category-options"
              value={category}
              placeholder="예: 지수"
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-amount">DCA 금액 ({meta.symbol})</label>
            <NumberInput
              id="edit-amount"
              value={dcaAmount}
              onChange={setDcaAmount}
              allowDecimal={stock.currency !== 'KRW'}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-dca-period">DCA 주기</label>
            <select
              id="edit-dca-period"
              value={dcaPeriod}
              onChange={(e) => setDcaPeriod(e.target.value as DcaPeriod)}
            >
              <option value="monthly">월</option>
              <option value="quarterly">분기</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-weight">목표 비중 (%)</label>
            <NumberInput id="edit-weight" value={targetWeight} onChange={setTargetWeight} />
          </div>
          <div className="field">
            <label htmlFor="edit-rebalance-period">리밸런싱 주기</label>
            <select
              id="edit-rebalance-period"
              value={rebalancePeriod}
              onChange={(e) => setRebalancePeriod(e.target.value as RebalancePeriod)}
            >
              <option value="quarterly">분기</option>
              <option value="semiannual">반기</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-band">밴드 임계값 (%p)</label>
            <NumberInput
              id="edit-band"
              value={bandPct}
              onChange={setBandPct}
              placeholder="기본값"
            />
          </div>
          <div className="field">
            <label htmlFor="edit-review">리뷰 마감일 직접 지정</label>
            <input
              id="edit-review"
              type="date"
              value={reviewOverride}
              onChange={(e) => setReviewOverride(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-foot">
          <div className="btn-group">
            <button className="primary" onClick={() => void save()} disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button onClick={onClose} disabled={busy}>
              취소
            </button>
          </div>
          <div className="btn-group">
            {stock.active && (
              <button className="ghost" onClick={() => void deactivate()} disabled={busy}>
                목록에서 감추기
              </button>
            )}
            <button className="danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
              완전 삭제
            </button>
          </div>
        </div>

        {confirmingDelete && (
          <div className="callout amber" role="alertdialog">
            <span className="ico">⚠</span>
            <div>
              <strong>{stock.ticker}</strong>의 시세·지표·매수 기록까지 전부 지웁니다. 되돌릴 수
              없고, 다시 등록하면 히스토리를 처음부터 새로 받아야 합니다. 잠시 치워두려는
              것이라면 <strong>목록에서 감추기</strong>를 쓰세요.
              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="danger" onClick={() => void purge()} disabled={busy}>
                  {busy ? '지우는 중…' : '네, 완전히 지웁니다'}
                </button>
                <button onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
