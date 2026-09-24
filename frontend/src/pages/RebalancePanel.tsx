import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { useAuth } from '../components/AuthGate'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorNotice } from '../components/ErrorNotice'
import { NumberInput } from '../components/NumberInput'
import {
  amount,
  CURRENCY_META,
  num,
  price,
  qty,
  REVIEW_PERIOD_LABEL,
  reviewCountdown,
  rowLabel,
  signed,
  signedAmount,
} from '../lib/display'
import { buildOrderPlan, krwRatesOf, NOISE_THRESHOLD_PCT } from '../lib/orderPlan'
import { applyTrade, type TradeSide } from '../lib/trade'
import type {
  CashRow,
  Currency,
  FxInfo,
  RebalanceRow,
  RebalanceSnapshot,
  RebalanceTarget,
  ReviewPeriod,
  ReviewStatus,
  Settings,
  Stock,
} from '../types'

interface Row {
  ticker: string
  current: RebalanceRow
  target: RebalanceTarget | null
  stock: Stock | null
}

/** 숫자 칸의 처음 값. 소수 끝자리 잡음(0.30000000004)은 떼고 보여준다 */
function initial(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(Number(value.toFixed(4)))
}

/* ---------- 보유 · 목표 ---------- */

function HoldingRow({
  row,
  onSaved,
  onError,
}: {
  row: Row
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const current = row.current
  const native = current.currency
  const meta = CURRENCY_META[native]
  const [quantity, setQuantity] = useState(initial(current.quantity))
  const [avgCost, setAvgCost] = useState(initial(current.avg_cost))
  const [targetWeight, setTargetWeight] = useState(String(current.target_weight_pct))
  const [bandPct, setBandPct] = useState(initial(row.target?.rebalance_band_pct))
  const [saving, setSaving] = useState(false)

  const [trading, setTrading] = useState(false)
  const [side, setSide] = useState<TradeSide>('buy')
  const [tradeQty, setTradeQty] = useState('')
  const [tradePrice, setTradePrice] = useState('')
  const [tradeProblem, setTradeProblem] = useState<string | null>(null)

  const label = row.stock?.name ?? row.ticker

  const save = async () => {
    setSaving(true)
    try {
      await api.updateHolding(row.ticker, Number(quantity || 0), avgCost === '' ? null : Number(avgCost))
      await api.updateRebalanceTarget(row.ticker, {
        target_weight_pct: Number(targetWeight || 0),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const openTrade = () => {
    setTrading(true)
    setSide('buy')
    setTradeQty('')
    // 대개 오늘 종가 근처에 산다 — 비워두는 것보다 고쳐 쓰는 편이 빠르다
    setTradePrice(initial(current.last_close))
    setTradeProblem(null)
  }

  const applyTradeNow = async () => {
    // 저장된 값에 반영한다 — 위 칸에서 고치다 만 숫자에 더하면 무엇에 더했는지 모르게 된다
    const result = applyTrade(
      { quantity: current.quantity, avg_cost: current.avg_cost },
      side,
      Number(tradeQty || 0),
      tradePrice === '' ? null : Number(tradePrice),
    )
    if (!result.ok) {
      setTradeProblem(result.reason)
      return
    }
    setSaving(true)
    try {
      await api.updateHolding(row.ticker, result.position.quantity, result.position.avg_cost)
      setTrading(false)
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  const pnl = current.unrealized_pnl
  return (
    <>
      <tr>
        <td>
          <div className="ticker-cell">
            <span className="ticker-name">{label}</span>
            <span className="ticker-sub">
              {row.ticker} · {price(current.last_close, native)}
            </span>
          </div>
        </td>
        <td>
          <NumberInput value={quantity} onChange={setQuantity} aria-label={`${row.ticker} 보유수량`} />
        </td>
        <td>
          <div className="input-with-button tight">
            <span className="unit">{meta.symbol}</span>
            <NumberInput
              value={avgCost}
              onChange={setAvgCost}
              placeholder="모름"
              allowDecimal={native === 'USD'}
              aria-label={`${row.ticker} 평단가`}
            />
          </div>
        </td>
        <td className={`num-cell ${pnl === null ? '' : pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}`}>
          {pnl === null ? (
            <span className="hint">평단가 입력 시</span>
          ) : (
            <div className="metric">
              <span className="metric-value">{signedAmount(pnl, native)}</span>
              <span className="metric-note">{signed(current.return_pct, 1, '%')}</span>
            </div>
          )}
        </td>
        <td>
          <div className="input-with-button tight">
            <NumberInput value={targetWeight} onChange={setTargetWeight} aria-label={`${row.ticker} 목표 비중`} />
            <span className="unit">%</span>
          </div>
        </td>
        <td>
          <div className="input-with-button tight">
            <NumberInput
              placeholder="기본값"
              value={bandPct}
              onChange={setBandPct}
              aria-label={`${row.ticker} 밴드 임계값`}
            />
            <span className="unit">%p</span>
          </div>
        </td>
        <td>
          <div className="btn-group tight">
            <button className="primary sm" onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button
              className="sm"
              onClick={() => (trading ? setTrading(false) : openTrade())}
              aria-expanded={trading}
              disabled={saving}
            >
              {trading ? '닫기' : '거래 입력'}
            </button>
          </div>
        </td>
      </tr>
      {trading && (
        <tr className="trade-row">
          <td colSpan={7}>
            <div className="trade-form">
              <span className="trade-title">{label} 거래 반영</span>
              <div className="chip-row" role="group" aria-label="매수 또는 매도">
                <button className={`chip${side === 'buy' ? ' active' : ''}`} onClick={() => setSide('buy')}>
                  샀다
                </button>
                <button className={`chip${side === 'sell' ? ' active' : ''}`} onClick={() => setSide('sell')}>
                  팔았다
                </button>
              </div>
              <div className="input-with-button tight">
                <NumberInput
                  value={tradeQty}
                  onChange={(v) => {
                    setTradeQty(v)
                    setTradeProblem(null)
                  }}
                  placeholder="수량"
                  aria-label={`${row.ticker} 거래 수량`}
                />
                <span className="unit">주</span>
              </div>
              {side === 'buy' && (
                <div className="input-with-button tight">
                  <span className="unit">{meta.symbol}</span>
                  <NumberInput
                    value={tradePrice}
                    onChange={(v) => {
                      setTradePrice(v)
                      setTradeProblem(null)
                    }}
                    placeholder="가격"
                    allowDecimal={native === 'USD'}
                    aria-label={`${row.ticker} 거래 가격`}
                  />
                </div>
              )}
              <button className="primary sm" onClick={() => void applyTradeNow()} disabled={saving}>
                반영
              </button>
              <span className="hint">
                {tradeProblem ??
                  (side === 'buy'
                    ? '수량을 더하고 평단가를 가중평균으로 다시 계산합니다.'
                    : '수량만 뺍니다. 평단가는 그대로입니다.')}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ---------- 현금 ---------- */

function CashCard({
  cash,
  settings,
  currencies,
  baseCurrency,
  onSaved,
  onError,
}: {
  cash: CashRow | null
  settings: Settings
  currencies: Currency[]
  baseCurrency: Currency
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [inputs, setInputs] = useState<Partial<Record<Currency, string>>>(() =>
    Object.fromEntries(currencies.map((c) => [c, initial(settings.cash[c])])),
  )
  const [target, setTarget] = useState(initial(settings.cash_target_pct))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.updateSettings({
        cash: Object.fromEntries(
          currencies.map((c) => [c, (inputs[c] ?? '') === '' ? null : Number(inputs[c])]),
        ),
        cash_target_pct: Number(target || 0),
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-title">현금</span>
        <span className="hint">
          {cash ? `${num(cash.actual_pct, 1)}% · 목표 ${num(cash.target_pct, 1)}%` : ''}
        </span>
      </div>
      {currencies.map((c) => (
        <div className="input-with-button" key={c}>
          <span className="unit">{CURRENCY_META[c].symbol}</span>
          <NumberInput
            value={inputs[c] ?? ''}
            onChange={(v) => setInputs((prev) => ({ ...prev, [c]: v }))}
            placeholder="0"
            allowDecimal={c === 'USD'}
            aria-label={`${CURRENCY_META[c].label} 현금`}
          />
        </div>
      ))}
      <div className="input-with-button">
        <span className="unit">목표</span>
        <NumberInput value={target} onChange={setTarget} placeholder="0" aria-label="현금 목표 비중" />
        <span className="unit">%</span>
        <button className="primary sm" onClick={() => void save()} disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
      <p className="kpi-foot">
        {cash && cash.value_base > 0
          ? `합계 ${amount(cash.value_base, baseCurrency)} · 목표 대비 ${signed(cash.excess_pct, 1, '%p')}`
          : '예수금·예금처럼 투자 대기 중인 돈. 목표비중은 현금까지 포함한 전체 자금 기준입니다.'}
      </p>
    </div>
  )
}

/* ---------- 리뷰 ---------- */

function ReviewSection({
  review,
  settings,
  onSaved,
  onError,
}: {
  review: ReviewStatus
  settings: Settings
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [override, setOverride] = useState(settings.review_date_override ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const update = async (payload: Parameters<typeof api.updateSettings>[0]) => {
    setBusy(true)
    try {
      await api.updateSettings(payload)
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  const record = async () => {
    setBusy(true)
    try {
      await api.createSnapshot(note.trim())
      setNote('')
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`panel review-panel${review.due ? ' due' : ''}`}>
      <div className="review-head">
        <div>
          <span className="kpi-title">다음 리뷰</span>
          <div className="kpi-figure">
            <span className="big">{review.due ? '리뷰할 때' : reviewCountdown(review)}</span>
            <span className="hint mono">{review.next_date}</span>
          </div>
          <p className="kpi-foot">
            {review.override
              ? '직접 정한 날입니다. 그 무렵 기록을 남기면 다시 주기로 돌아갑니다.'
              : `${REVIEW_PERIOD_LABEL[review.period]} 마지막 거래일`}
            {review.last_snapshot_at && ` · 마지막 기록 ${review.last_snapshot_at.slice(0, 10)}`}
          </p>
        </div>

        <div className="review-controls">
          <label className="field">
            <span>리뷰 주기</span>
            <select
              value={settings.review_period}
              disabled={busy}
              onChange={(e) => void update({ review_period: e.target.value as ReviewPeriod })}
            >
              {(Object.keys(REVIEW_PERIOD_LABEL) as ReviewPeriod[]).map((p) => (
                <option key={p} value={p}>
                  {REVIEW_PERIOD_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>다음 리뷰일 직접 정하기</span>
            <div className="input-with-button tight">
              <input
                type="date"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                aria-label="다음 리뷰일"
              />
              <button
                className="sm"
                disabled={busy || override === (settings.review_date_override ?? '')}
                onClick={() => void update({ review_date_override: override === '' ? null : override })}
              >
                적용
              </button>
              {settings.review_date_override && (
                <button
                  className="sm ghost"
                  disabled={busy}
                  onClick={() => {
                    setOverride('')
                    void update({ review_date_override: null })
                  }}
                >
                  주기로
                </button>
              )}
            </div>
          </label>
        </div>
      </div>

      {review.due && (
        <p className="review-due-text">
          비중을 확인하고 필요한 만큼 사고판 뒤, 수량을 고치고 아래에서 기록을 남기세요. 기록을 남기면
          다음 리뷰일이 다음 기간으로 넘어갑니다.
        </p>
      )}

      <div className="input-with-button record-row">
        <input
          type="text"
          value={note}
          maxLength={200}
          placeholder="메모 (선택)"
          onChange={(e) => setNote(e.target.value)}
          aria-label="기록 메모"
        />
        <button className="primary" onClick={() => void record()} disabled={busy}>
          {busy ? '기록 중…' : '지금 상태 기록하기'}
        </button>
      </div>
    </div>
  )
}

/* ---------- 지난 기록 ---------- */

function SnapshotList({
  snapshots,
  onDeleted,
  onError,
}: {
  snapshots: RebalanceSnapshot[]
  onDeleted: () => void
  onError: (e: unknown) => void
}) {
  const [deleting, setDeleting] = useState<RebalanceSnapshot | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async (snapshot: RebalanceSnapshot) => {
    setBusy(true)
    try {
      await api.deleteSnapshot(snapshot.id)
      setDeleting(null)
      onDeleted()
    } catch (e) {
      onError(e)
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  if (snapshots.length === 0) {
    return (
      <p className="hint">
        아직 남긴 기록이 없습니다. 리뷰할 때 "지금 상태 기록하기"를 누르면 그날의 수량·가격·비중이 그대로
        남아, 다음 리뷰 때 지난번과 비교할 수 있습니다.
      </p>
    )
  }

  return (
    <div className="snapshot-list">
      {snapshots.map((snapshot, index) => {
        const base = snapshot.base_currency
        const previous = snapshots[index + 1]
        // 기준통화가 다르면 금액을 나란히 빼는 게 뜻이 없다
        const change =
          previous && previous.base_currency === base
            ? snapshot.total_value_base - previous.total_value_base
            : null
        const pnl = snapshot.data.unrealized_pnl_base ?? null
        return (
          <details key={snapshot.id} className="snapshot">
            <summary>
              <span className="mono">{snapshot.taken_at.slice(0, 10)}</span>
              <span className="snapshot-total">{amount(snapshot.total_value_base, base)}</span>
              {change !== null && (
                <span className={`metric-note ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
                  직전 대비 {signedAmount(change, base)}
                </span>
              )}
              {snapshot.note && <span className="snapshot-note">{snapshot.note}</span>}
            </summary>
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>수량</th>
                    <th>가격</th>
                    <th>비중 (목표)</th>
                    <th>수익률</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.data.rows.map((r) => (
                    <tr key={r.ticker}>
                      <td>{r.name ?? r.ticker}</td>
                      <td className="num-cell">{qty(r.quantity)}</td>
                      <td className="num-cell">{price(r.last_close, r.currency)}</td>
                      <td className="num-cell">
                        {num(r.actual_weight_pct, 1)}% ({num(r.target_weight_pct, 1)}%)
                      </td>
                      <td className="num-cell">{r.return_pct === null ? '—' : signed(r.return_pct, 1, '%')}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>현금</td>
                    <td className="num-cell" colSpan={2}>
                      {amount(snapshot.data.cash.value_base, base)}
                    </td>
                    <td className="num-cell">
                      {num(snapshot.data.cash.actual_pct, 1)}% ({num(snapshot.data.cash.target_pct, 1)}%)
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="snapshot-foot">
              <span className="hint">
                {snapshot.review_date && `리뷰 마감 ${snapshot.review_date} 기준 · `}
                {pnl !== null && `평가손익 ${signedAmount(pnl, base)} · `}
                {CURRENCY_META[base].label} 환산
              </span>
              <button className="sm danger" onClick={() => setDeleting(snapshot)}>
                기록 삭제
              </button>
            </div>
          </details>
        )
      })}

      {deleting && (
        <ConfirmDialog
          title="리밸런싱 기록 삭제"
          confirmLabel="네, 지웁니다"
          busyLabel="지우는 중…"
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            {deleting.taken_at.slice(0, 10)}에 남긴 기록을 지웁니다. 되돌릴 수 없고, 그날의 모습은 다시
            만들 수 없습니다.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}

/* ---------- 화면 ---------- */

export function RebalancePanel() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cash, setCash] = useState<CashRow | null>(null)
  const [review, setReview] = useState<ReviewStatus | null>(null)
  const [totals, setTotals] = useState<{ total: number; pnl: number | null; cost: number | null }>({
    total: 0,
    pnl: null,
    cost: null,
  })
  const [snapshots, setSnapshots] = useState<RebalanceSnapshot[]>([])
  const [bandInput, setBandInput] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const [baseCurrency, setBaseCurrency] = useState<Currency>('KRW')
  const [fx, setFx] = useState<FxInfo | null>(null)
  /** 통화별로 직접 입력한 환율 (빈 문자열이면 자동 조회값을 쓴다) */
  const [fxInputs, setFxInputs] = useState<Partial<Record<Currency, string>>>({})
  const [fxBusy, setFxBusy] = useState(false)

  /** 이번에 새로 넣을 돈 (계산만 한다 — 저장하지 않는다) */
  const [newMoney, setNewMoney] = useState('')

  const reload = () => {
    setLoading(true)
    Promise.all([
      api.getRebalanceCurrent(),
      api.listRebalanceTargets(),
      api.getSettings(),
      api.listStocks(),
      api.listSnapshots(),
    ])
      .then(([current, targets, s, stocks, snaps]) => {
        const targetBy = new Map(targets.map((t) => [t.ticker, t]))
        const stockBy = new Map(stocks.map((st) => [st.ticker, st]))
        setRows(
          current.rows.map((c) => ({
            ticker: c.ticker,
            current: c,
            target: targetBy.get(c.ticker) ?? null,
            stock: stockBy.get(c.ticker) ?? null,
          })),
        )
        setBaseCurrency(current.base_currency)
        setFx(current.fx)
        setCash(current.cash)
        setReview(current.review)
        setTotals({
          total: current.total_value_base,
          pnl: current.unrealized_pnl_base,
          cost: current.cost_value_base,
        })
        setSettings(s)
        setSnapshots(snaps)
        setBandInput(String(s.default_rebalance_band_pct))
        setFxInputs(
          Object.fromEntries(
            Object.entries(s.fx_overrides ?? {}).map(([code, rate]) => [code, String(rate)]),
          ),
        )
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }

  useEffect(reload, [refreshKey])

  const handleSaved = () => {
    setError(null)
    notifyDataChanged()
  }

  const saveSettings = async () => {
    try {
      await api.updateSettings({ default_rebalance_band_pct: Number(bandInput) })
      handleSaved()
    } catch (e) {
      setError(e)
    }
  }

  const changeBaseCurrency = async (next: Currency) => {
    try {
      await api.updateSettings({ base_currency: next })
      handleSaved()
    } catch (e) {
      setError(e)
    }
  }

  const saveFxOverride = async (currency: Currency) => {
    setFxBusy(true)
    try {
      const trimmed = (fxInputs[currency] ?? '').trim()
      // 보낸 통화만 바뀐다 — 엔을 고치다 달러 설정이 날아가면 안 된다
      await api.updateSettings({
        fx_overrides: { [currency]: trimmed === '' ? null : Number(trimmed) },
      })
      handleSaved()
    } catch (e) {
      setError(e)
    } finally {
      setFxBusy(false)
    }
  }

  const refreshFx = async () => {
    setFxBusy(true)
    try {
      await api.refreshFx()
      handleSaved()
    } catch (e) {
      setError(e)
    } finally {
      setFxBusy(false)
    }
  }

  const plan = useMemo(
    () =>
      buildOrderPlan(
        rows.map((r) => r.current),
        baseCurrency,
        krwRatesOf(fx),
        { value_base: cash?.value_base ?? 0, target_pct: cash?.target_pct ?? 0 },
        newMoney,
      ),
    [rows, baseCurrency, fx, cash, newMoney],
  )

  /** 주문 계획은 티커만 들고 있으므로, 화면에 필요한 나머지 정보를 여기서 붙인다 */
  const rowByTicker = useMemo(() => new Map(rows.map((r) => [r.ticker, r])), [rows])

  const hasMixedCurrencies = useMemo(
    () => new Set(rows.map((r) => r.current.currency)).size > 1,
    [rows],
  )

  /** 환율이 실제로 필요한 통화만 보여준다 — 일본 종목이 없으면 엔 칸도 뜨지 않는다 */
  const fxCurrencies = useMemo(() => {
    const held = new Set(rows.map((r) => r.current.currency))
    return (['USD', 'JPY'] as Currency[]).filter((c) => c !== baseCurrency && held.has(c))
  }, [rows, baseCurrency])

  /** 현금 칸 — 원·달러는 늘, 엔은 일본 종목이나 엔 현금이 있을 때만 */
  const cashCurrencies = useMemo(() => {
    const held = new Set<Currency>(rows.map((r) => r.current.currency))
    const saved = new Set(Object.keys(settings?.cash ?? {}) as Currency[])
    return (['KRW', 'USD', 'JPY'] as Currency[]).filter(
      (c) => c !== 'JPY' || held.has(c) || saved.has(c),
    )
  }, [rows, settings])

  /** 지금 추정치를 쓰고 있는 통화 — 경고에 어느 환율이 문제인지 적는다 */
  const estimatedCurrencies = fxCurrencies.filter((c) => fx?.rates?.[c]?.is_estimate)

  const signalled = rows.filter((r) => r.current.rebalance_signal.active)
  const targetOk = Math.abs(plan.targetSum - 100) < 0.01

  if (loading) return <p className="hint">불러오는 중…</p>

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <h3>리밸런싱할 종목이 없습니다</h3>
        <p>종목 관리 화면에서 종목을 추가하고 목표 비중을 설정해주세요.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>리밸런싱 · 주문 가이드</h2>
          <p className="hint">
            목표 비중은 <b>현금을 포함한 전체 자금</b> 중의 비중입니다. 목표와 지금의 차이를 금액과 주수로
            환산합니다. 금액 열은 기준통화({CURRENCY_META[baseCurrency].label}) 환산 기준이고, 예상 주문 주수는
            해당 종목을 실제로 거래하는 통화로 계산합니다. 비중조절 신호는 참고 알림이며, 실제로 사고파는 것은
            리뷰 때 정합니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {fx?.is_estimate && hasMixedCurrencies && (
        <div className="callout amber">
          <span className="ico">⚠</span>
          <div>
            환율을 받아오지 못해 추정치로 계산하고 있습니다
            {estimatedCurrencies.length > 0 && ` (${estimatedCurrencies.join(', ')})`}. 통화가 섞인
            포트폴리오라 비중이 실제와 다를 수 있으니, 아래 "적용 환율"에서 직접 입력하거나 다시 조회해주세요.
          </div>
        </div>
      )}

      {review && settings && (
        <ReviewSection
          key={`${settings.review_period}-${settings.review_date_override ?? ''}`}
          review={review}
          settings={settings}
          onSaved={handleSaved}
          onError={setError}
        />
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">전체 자금</span>
            <span className="hint">{CURRENCY_META[baseCurrency].symbol} 기준 · 현금 포함</span>
          </div>
          <div className="kpi-figure">
            <span className="big">{amount(totals.total, baseCurrency)}</span>
          </div>
          <p className="kpi-foot">
            주식 {amount(plan.holdingsTotal, baseCurrency)} · 현금 {amount(cash?.value_base ?? 0, baseCurrency)}
            {totals.pnl !== null && (
              <>
                <br />
                평가손익{' '}
                <span className={totals.pnl > 0 ? 'up' : totals.pnl < 0 ? 'down' : ''}>
                  {signedAmount(totals.pnl, baseCurrency)}
                  {totals.cost ? ` (${signed((totals.pnl / totals.cost) * 100, 1, '%')})` : ''}
                </span>{' '}
                · 평단가를 넣은 종목만, 지금 환율로
              </>
            )}
          </p>
        </div>

        {settings && (
          <CashCard
            key={JSON.stringify([settings.cash, settings.cash_target_pct, cashCurrencies])}
            cash={cash}
            settings={settings}
            currencies={cashCurrencies}
            baseCurrency={baseCurrency}
            onSaved={handleSaved}
            onError={setError}
          />
        )}

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">기준통화 · 적용 환율</span>
          </div>
          <div className="btn-group" style={{ marginBottom: 8 }}>
            {(['KRW', 'USD', 'JPY'] as Currency[]).map((c) => (
              <button
                key={c}
                className={`sm${baseCurrency === c ? ' primary' : ' ghost'}`}
                onClick={() => void changeBaseCurrency(c)}
                disabled={baseCurrency === c}
              >
                {CURRENCY_META[c].symbol} {c}
              </button>
            ))}
          </div>
          {fxCurrencies.length === 0 ? (
            <p className="kpi-foot">
              환산할 외화 종목이 없습니다.
              <br />
              해외 종목을 담으면 그 통화의 환율 칸이 여기 생깁니다.
            </p>
          ) : (
            <>
              {fxCurrencies.map((c) => {
                const quote = fx?.rates?.[c]
                const meta = CURRENCY_META[c]
                return (
                  <div key={c}>
                    <div className="input-with-button">
                      <NumberInput
                        placeholder={quote ? num(quote.krw_rate, 2) : '자동'}
                        value={fxInputs[c] ?? ''}
                        onChange={(v) => setFxInputs((prev) => ({ ...prev, [c]: v }))}
                        aria-label={`원/${meta.label} 환율 직접 입력`}
                      />
                      <span className="unit">원/{meta.symbol}</span>
                      <button
                        className="primary sm"
                        onClick={() => void saveFxOverride(c)}
                        disabled={fxBusy}
                      >
                        적용
                      </button>
                    </div>
                    <p className="kpi-foot">
                      {quote
                        ? `1${meta.label} = ${num(quote.krw_rate, 2)}원 · ${
                            quote.source === 'override'
                              ? '직접 입력한 값'
                              : quote.source === 'fallback'
                                ? '조회 실패, 추정치'
                                : '자동 조회값'
                          }`
                        : '환율 정보 없음'}
                    </p>
                  </div>
                )
              })}
              {/* 환율은 전원이 같이 쓴다 — 다시 받는 건 관리자만. 직접 넣는 칸은 내 것이라 누구나 */}
              {isAdmin && (
                <div className="btn-group tight">
                  <button className="sm ghost" onClick={() => void refreshFx()} disabled={fxBusy}>
                    전체 조회
                  </button>
                </div>
              )}
              <p className="kpi-foot">비워두고 적용하면 자동 조회값으로 돌아갑니다.</p>
            </>
          )}
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">목표 비중 합계</span>
          </div>
          <div className="kpi-figure">
            <span className={`big ${targetOk ? 'up' : 'down'}`}>{num(plan.targetSum, 1)}%</span>
          </div>
          <p className="kpi-foot">
            {plan.cash.targetPct > 0 && `현금 ${num(plan.cash.targetPct, 1)}% 포함 · `}
            {targetOk
              ? '합계가 100%로 맞습니다.'
              : `100%에서 ${signed(plan.targetSum - 100, 1, '%p')} 벗어나 있어 목표 금액이 전체 자금과 어긋납니다.`}
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">비중조절 신호</span>
          </div>
          <div className="kpi-figure">
            <span className="big">{signalled.length}</span>
            <span className="hint">종목</span>
          </div>
          <p className="kpi-foot">
            {signalled.length === 0
              ? '모든 종목이 설정한 밴드 이내입니다.'
              : signalled.map((r) => `${rowLabel(r.current)}: ${r.current.rebalance_signal.reasons.join(', ')}`).join(' · ')}
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">전역 기본 밴드</span>
          </div>
          <div className="input-with-button">
            <NumberInput value={bandInput} onChange={setBandInput} aria-label="전역 기본 밴드" />
            <span className="unit">%p</span>
            <button className="primary sm" onClick={saveSettings}>
              저장
            </button>
          </div>
          <p className="kpi-foot">
            종목별 밴드를 비워두면 이 값이 적용됩니다. 현재 적용값 {settings?.default_rebalance_band_pct ?? '—'}%p
          </p>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>자동 산출된 주문 가이드</h3>
          <span className="hint">
            조정 필요금액이 전체 자금의 {NOISE_THRESHOLD_PCT}% 미만이면 "유지"로 표시합니다.
          </span>
        </div>
        <div className="new-money">
          <label htmlFor="new-money">이번에 새로 넣을 돈 (선택)</label>
          <div className="input-with-button">
            <span className="unit">{CURRENCY_META[baseCurrency].symbol}</span>
            <NumberInput
              id="new-money"
              value={newMoney}
              onChange={setNewMoney}
              placeholder="0"
              allowDecimal={baseCurrency === 'USD'}
            />
          </div>
          <span className="hint">
            적립하는 달에 넣어보세요. 이 돈까지 더해 목표에 모자란 종목부터 채우는 주문이 나옵니다. 저장되지
            않습니다.
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>구분 / 종목</th>
                <th style={{ minWidth: 132 }}>현재 평가금액</th>
                <th style={{ minWidth: 118 }}>목표 금액</th>
                <th style={{ minWidth: 140 }}>조정 필요금액</th>
                <th style={{ minWidth: 104 }}>
                  현재 비중
                  <br />
                  (목표 대비)
                </th>
                <th style={{ minWidth: 104 }}>주문 액션</th>
                <th style={{ minWidth: 104 }}>예상 주문 주수</th>
                <th style={{ minWidth: 140 }}>비중조절 신호</th>
              </tr>
            </thead>
            <tbody>
              {plan.orders.map(({ ticker, currency: native, targetValue, adjust, adjustNative, shares, action }) => {
                const row = rowByTicker.get(ticker)
                if (!row) return null
                const isForeign = native !== baseCurrency
                // 새로 넣을 돈이 있으면 비중도 그 돈까지 더한 전체 자금으로 다시 잰다
                const weightNow = plan.total > 0 ? (row.current.current_value_base / plan.total) * 100 : 0
                return (
                <tr key={row.ticker}>
                  <td>
                    <div className="ticker-cell">
                      {row.stock?.category && <span className="cat-tag">{row.stock.category}</span>}
                      <span className="ticker-name">{row.stock?.name ?? row.ticker}</span>
                      <span className="ticker-sub">
                        {row.ticker} · {qty(row.current.quantity)}주 · {price(row.current.last_close, native)}
                      </span>
                    </div>
                  </td>
                  <td className="num-cell">
                    <div className="metric">
                      <span className="metric-value">{amount(row.current.current_value_base, baseCurrency)}</span>
                      {isForeign && (
                        <span className="metric-note">
                          현지 {amount(row.current.current_value, native)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num-cell">{amount(targetValue, baseCurrency)}</td>
                  <td className={`num-cell ${adjust > 0 ? 'up' : adjust < 0 ? 'down' : ''}`}>
                    <div className="metric">
                      <span className="metric-value">{signedAmount(adjust, baseCurrency)}</span>
                      {isForeign && action !== 'hold' && (
                        <span className="metric-note">주문 {signedAmount(adjustNative, native)}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="metric">
                      <span className="metric-value">{num(weightNow, 1)}%</span>
                      <span className="metric-note">
                        목표 {num(row.current.target_weight_pct, 0)}% ·{' '}
                        {signed(weightNow - row.current.target_weight_pct, 1, '%p')}
                      </span>
                    </div>
                  </td>
                  <td>
                    {action === 'buy' ? (
                      <span className="badge badge-green">매수 (BUY)</span>
                    ) : action === 'sell' ? (
                      <span className="badge badge-red">매도 (SELL)</span>
                    ) : (
                      <span className="badge badge-grey">유지 (HOLD)</span>
                    )}
                  </td>
                  <td className="num-cell">
                    {shares === null || action === 'hold' ? '—' : `${signed(shares, 2)}주`}
                  </td>
                  <td>
                    <div className="badge-row">
                      {row.current.rebalance_signal.reasons.map((r) => (
                        <span key={r} className="badge badge-purple">
                          {r}
                        </span>
                      ))}
                      {row.current.shoulder_signal_fired_in_period && (
                        <span className="badge badge-amber">기간 내 매도 시그널</span>
                      )}
                      {!row.current.rebalance_signal.active &&
                        !row.current.shoulder_signal_fired_in_period && (
                          <span className="hint">밴드 이내</span>
                        )}
                    </div>
                  </td>
                </tr>
                )
              })}
              <tr className="cash-row">
                <td>
                  <div className="ticker-cell">
                    <span className="ticker-name">현금</span>
                    <span className="ticker-sub">
                      {plan.newMoney > 0
                        ? `지금 ${amount(cash?.value_base ?? 0, baseCurrency)} + 새로 넣을 돈`
                        : '예수금·예금'}
                    </span>
                  </div>
                </td>
                <td className="num-cell">{amount(plan.cash.current, baseCurrency)}</td>
                <td className="num-cell">{amount(plan.cash.targetValue, baseCurrency)}</td>
                <td className={`num-cell ${plan.cash.adjust > 0 ? 'up' : plan.cash.adjust < 0 ? 'down' : ''}`}>
                  {signedAmount(plan.cash.adjust, baseCurrency)}
                </td>
                <td>
                  <div className="metric">
                    <span className="metric-value">
                      {num(plan.total > 0 ? (plan.cash.current / plan.total) * 100 : 0, 1)}%
                    </span>
                    <span className="metric-note">목표 {num(plan.cash.targetPct, 0)}%</span>
                  </div>
                </td>
                <td colSpan={3}>
                  <span className="hint">
                    {plan.cash.adjust < 0
                      ? '목표보다 많은 현금 — 매수 재원입니다.'
                      : plan.cash.adjust > 0
                        ? '목표보다 적은 현금 — 매도 대금이 여기로 옵니다.'
                        : '목표와 같습니다.'}
                  </span>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>합계 ({CURRENCY_META[baseCurrency].symbol})</td>
                <td className="num-cell">{amount(plan.total, baseCurrency)}</td>
                <td className="num-cell">
                  {amount(plan.orders.reduce((s, o) => s + o.targetValue, 0) + plan.cash.targetValue, baseCurrency)}
                </td>
                <td className="num-cell">
                  {signedAmount(plan.orders.reduce((s, o) => s + o.adjust, 0) + plan.cash.adjust, baseCurrency)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>보유 · 목표 비중</h3>
          <span className="hint">
            샀거나 팔았으면 "거래 입력"으로 반영하세요. 평단가는 손익 표시에만 쓰이고 비중에는 영향이 없습니다.
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table fixed" style={{ minWidth: 1030 }}>
            <thead>
              <tr>
                <th style={{ width: 190 }}>종목</th>
                <th style={{ width: 120 }}>보유수량</th>
                <th style={{ width: 150 }}>평단가</th>
                <th style={{ width: 130 }}>평가손익</th>
                <th style={{ width: 120 }}>목표 비중</th>
                <th style={{ width: 140 }}>
                  밴드 임계값
                  <br />
                  (비워두면 기본값)
                </th>
                <th style={{ width: 180 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <HoldingRow
                  key={`${row.ticker}-${row.current.quantity}-${row.current.avg_cost}-${row.current.target_weight_pct}`}
                  row={row}
                  onSaved={handleSaved}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>리밸런싱 기록 {snapshots.length > 0 && `${snapshots.length}건`}</h3>
          <span className="hint">리뷰할 때 남긴 모습 그대로입니다. 종목을 지우거나 목표를 바꿔도 달라지지 않습니다.</span>
        </div>
        <SnapshotList snapshots={snapshots} onDeleted={handleSaved} onError={setError} />
      </div>
    </div>
  )
}
