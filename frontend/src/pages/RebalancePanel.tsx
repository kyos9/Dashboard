import { useEffect, useMemo, useState } from 'react'
import { useAppState } from '../AppState'
import { api } from '../api/client'
import { ErrorNotice } from '../components/ErrorNotice'
import { amount, CURRENCY_META, num, price, qty, signed, signedAmount } from '../lib/display'
import type {
  Currency,
  FxInfo,
  Holding,
  RebalanceRow,
  RebalanceTarget,
  Settings,
  Stock,
} from '../types'

/** 조정 필요금액이 총자산의 이 비율 미만이면 주문하지 않고 "유지"로 본다 (거래비용 대비 실익 없음) */
const NOISE_THRESHOLD_PCT = 0.5

/**
 * 기준통화 금액을 그 종목을 실제로 거래하는 통화로 되돌린다.
 *
 * 비중과 목표 금액은 기준통화로 계산해야 맞지만, 주문은 현지 통화로 넣는다.
 * 주수를 구할 때도 현지 종가로 나눠야 하므로 이 환산이 필요하다.
 */
function toNative(valueBase: number, currency: Currency, base: Currency, usdKrw: number): number {
  if (currency === base || !usdKrw) return valueBase
  if (base === 'KRW' && currency === 'USD') return valueBase / usdKrw
  if (base === 'USD' && currency === 'KRW') return valueBase * usdKrw
  return valueBase
}

interface Row {
  ticker: string
  current: RebalanceRow
  target: RebalanceTarget | null
  holding: Holding | null
  stock: Stock | null
}

function SettingsRow({ row, onSaved, onError }: { row: Row; onSaved: () => void; onError: (e: unknown) => void }) {
  const [targetWeight, setTargetWeight] = useState(String(row.current.target_weight_pct))
  const [bandPct, setBandPct] = useState(
    row.target?.rebalance_band_pct === null || row.target?.rebalance_band_pct === undefined
      ? ''
      : String(row.target.rebalance_band_pct),
  )
  const [quantity, setQuantity] = useState(String(Number(row.current.quantity.toFixed(4))))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api.updateHolding(row.ticker, Number(quantity))
      await api.updateRebalanceTarget(row.ticker, {
        target_weight_pct: Number(targetWeight),
        rebalance_band_pct: bandPct === '' ? null : Number(bandPct),
      })
      onSaved()
    } catch (e) {
      onError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>
        <div className="ticker-cell">
          <span className="ticker-name">{row.stock?.name ?? row.ticker}</span>
          <span className="ticker-sub">
            {row.ticker} · {price(row.current.last_close, row.current.currency)}
          </span>
        </div>
      </td>
      <td>
        <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </td>
      <td>
        <div className="input-with-button">
          <input type="number" step="any" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
          <span className="unit">%</span>
        </div>
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
      <td className="num-cell">{row.current.next_review_date}</td>
      <td>
        <button className="primary sm" onClick={save} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </td>
    </tr>
  )
}

export function RebalancePanel() {
  const { refreshKey, notifyDataChanged } = useAppState()
  const [rows, setRows] = useState<Row[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [bandInput, setBandInput] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  const [baseCurrency, setBaseCurrency] = useState<Currency>('KRW')
  const [fx, setFx] = useState<FxInfo | null>(null)
  const [fxInput, setFxInput] = useState('')
  const [fxBusy, setFxBusy] = useState(false)

  /** 사용자가 직접 넣은 총 운용자산. 비워두면 보유 평가금액 합계를 쓴다 (현금 비중까지 반영하고 싶을 때 입력). */
  const [totalOverride, setTotalOverride] = useState('')

  const reload = () => {
    setLoading(true)
    Promise.all([
      api.getRebalanceCurrent(),
      api.listRebalanceTargets(),
      api.listHoldings(),
      api.getSettings(),
      api.listStocks(),
    ])
      .then(([current, targets, holdings, s, stocks]) => {
        const targetBy = new Map(targets.map((t) => [t.ticker, t]))
        const holdingBy = new Map(holdings.map((h) => [h.ticker, h]))
        const stockBy = new Map(stocks.map((st) => [st.ticker, st]))
        setRows(
          current.rows.map((c) => ({
            ticker: c.ticker,
            current: c,
            target: targetBy.get(c.ticker) ?? null,
            holding: holdingBy.get(c.ticker) ?? null,
            stock: stockBy.get(c.ticker) ?? null,
          })),
        )
        setBaseCurrency(current.base_currency)
        setFx(current.fx)
        setSettings(s)
        setBandInput(String(s.default_rebalance_band_pct))
        setFxInput(s.usd_krw_override === null ? '' : String(s.usd_krw_override))
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

  const saveFxOverride = async () => {
    setFxBusy(true)
    try {
      const trimmed = fxInput.trim()
      await api.updateSettings({ usd_krw_override: trimmed === '' ? null : Number(trimmed) })
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

  const plan = useMemo(() => {
    // 평가금액 합계·목표 금액·비중은 전부 기준통화로 계산한다.
    // 통화가 섞인 상태에서 현지 금액끼리 더하면 (원화 80만 + 달러 1000) 숫자가 무의미해진다.
    const usdKrw = fx?.usd_krw ?? 0
    const holdingsTotal = rows.reduce((s, r) => s + r.current.current_value_base, 0)
    const parsed = Number(totalOverride.replace(/,/g, ''))
    const total = totalOverride.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : holdingsTotal
    const targetSum = rows.reduce((s, r) => s + r.current.target_weight_pct, 0)

    const orders = rows.map((r) => {
      const targetValue = (total * r.current.target_weight_pct) / 100
      const adjust = targetValue - r.current.current_value_base
      // 주문은 현지 통화로 넣고, 주수도 현지 종가로 나눠야 맞는다
      const adjustNative = toNative(adjust, r.current.currency, baseCurrency, usdKrw)
      const close = r.current.last_close
      const shares = close && close > 0 ? adjustNative / close : null
      const material = total > 0 && Math.abs(adjust) / total > NOISE_THRESHOLD_PCT / 100
      return {
        row: r,
        targetValue,
        adjust,
        adjustNative,
        shares,
        action: !material ? ('hold' as const) : adjust > 0 ? ('buy' as const) : ('sell' as const),
      }
    })

    return { holdingsTotal, total, targetSum, orders, cash: total - holdingsTotal }
  }, [rows, totalOverride, baseCurrency, fx])

  const hasMixedCurrencies = useMemo(
    () => new Set(rows.map((r) => r.current.currency)).size > 1,
    [rows],
  )

  const signalled = rows.filter((r) => r.current.rebalance_signal.active)

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
            목표 비중과 현재 비중의 차이를 금액과 주수로 환산합니다. 금액 열은 기준통화(
            {CURRENCY_META[baseCurrency].label}) 환산 기준이고, 예상 주문 주수는 해당 종목을 실제로 거래하는
            통화로 계산합니다. 실제 매도 실행일은 종목별 리뷰 마감일이며, 비중조절 신호는 조기 참고 알림입니다.
          </p>
        </div>
      </div>

      <ErrorNotice error={error} onDismiss={() => setError(null)} />

      {fx?.is_estimate && hasMixedCurrencies && (
        <div className="callout amber">
          <span className="ico">⚠</span>
          <div>
            환율을 받아오지 못해 추정치({num(fx.usd_krw, 0)}원)로 계산하고 있습니다. 통화가 섞인
            포트폴리오라 비중이 실제와 다를 수 있으니, 아래 "적용 환율"에서 직접 입력하거나 다시 조회해주세요.
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">총 운용자산</span>
            <span className="hint">{CURRENCY_META[baseCurrency].symbol} 기준</span>
          </div>
          <div className="field">
            <input
              type="text"
              inputMode="numeric"
              placeholder={amount(plan.holdingsTotal, baseCurrency)}
              value={totalOverride}
              onChange={(e) => setTotalOverride(e.target.value)}
            />
          </div>
          <p className="kpi-foot">
            보유 평가금액 합계 {amount(plan.holdingsTotal, baseCurrency)}
            {plan.cash > 0.5 && ` · 미투자 현금 ${amount(plan.cash, baseCurrency)}`}
            <br />
            현금까지 포함해 비중을 맞추려면 총액을 직접 입력하세요.
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">기준통화 · 적용 환율</span>
          </div>
          <div className="btn-group" style={{ marginBottom: 8 }}>
            {(['KRW', 'USD'] as Currency[]).map((c) => (
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
          <div className="input-with-button">
            <input
              type="number"
              step="any"
              placeholder={fx ? num(fx.usd_krw, 2) : '자동'}
              value={fxInput}
              onChange={(e) => setFxInput(e.target.value)}
            />
            <span className="unit">원/$</span>
            <button className="primary sm" onClick={() => void saveFxOverride()} disabled={fxBusy}>
              적용
            </button>
            <button className="sm ghost" onClick={() => void refreshFx()} disabled={fxBusy}>
              조회
            </button>
          </div>
          <p className="kpi-foot">
            {fx
              ? `1달러 = ${num(fx.usd_krw, 2)}원 · ${
                  fx.source === 'override'
                    ? '직접 입력한 값'
                    : fx.source === 'fallback'
                      ? '조회 실패, 추정치'
                      : '자동 조회값'
                }`
              : '환율 정보 없음'}
            <br />
            비워두고 적용하면 자동 조회값으로 돌아갑니다.
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">목표 비중 합계</span>
          </div>
          <div className="kpi-figure">
            <span className={`big ${Math.abs(plan.targetSum - 100) < 0.01 ? 'up' : 'down'}`}>
              {num(plan.targetSum, 1)}%
            </span>
          </div>
          <p className="kpi-foot">
            {Math.abs(plan.targetSum - 100) < 0.01
              ? '합계가 100%로 맞습니다.'
              : `100%에서 ${signed(plan.targetSum - 100, 1, '%p')} 벗어나 있어 목표 금액이 총자산과 어긋납니다.`}
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
              : signalled.map((r) => `${r.ticker}: ${r.current.rebalance_signal.reasons.join(', ')}`).join(' · ')}
          </p>
        </div>

        <div className="kpi">
          <div className="kpi-head">
            <span className="kpi-title">전역 기본 밴드</span>
          </div>
          <div className="input-with-button">
            <input type="number" step="any" value={bandInput} onChange={(e) => setBandInput(e.target.value)} />
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
            조정 필요금액이 총자산의 {NOISE_THRESHOLD_PCT}% 미만이면 "유지"로 표시합니다.
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
              {plan.orders.map(({ row, targetValue, adjust, adjustNative, shares, action }) => {
                const native = row.current.currency
                const isForeign = native !== baseCurrency
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
                      <span className="metric-value">{num(row.current.actual_weight_pct, 1)}%</span>
                      <span className="metric-note">
                        목표 {num(row.current.target_weight_pct, 0)}% ·{' '}
                        {signed(row.current.excess_pct, 1, '%p')}
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
                        <span className="badge badge-amber">기간 내 어깨매도 발동</span>
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
            </tbody>
            <tfoot>
              <tr>
                <td>합계 ({CURRENCY_META[baseCurrency].symbol})</td>
                <td className="num-cell">{amount(plan.holdingsTotal, baseCurrency)}</td>
                <td className="num-cell">
                  {amount(plan.orders.reduce((s, o) => s + o.targetValue, 0), baseCurrency)}
                </td>
                <td className="num-cell">
                  {signedAmount(plan.orders.reduce((s, o) => s + o.adjust, 0), baseCurrency)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>보유수량 · 목표 비중 설정</h3>
          <span className="hint">수량과 목표 비중을 바꾸면 위 주문 가이드가 즉시 다시 계산됩니다.</span>
        </div>
        <div className="table-scroll">
          <table className="data-table" style={{ minWidth: 840 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>종목</th>
                <th style={{ minWidth: 120 }}>보유수량</th>
                <th style={{ minWidth: 155 }}>목표 비중</th>
                <th style={{ minWidth: 155 }}>
                  밴드 임계값
                  <br />
                  (비워두면 기본값)
                </th>
                <th style={{ minWidth: 118 }}>다음 리뷰 마감일</th>
                <th style={{ minWidth: 80 }}>저장</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <SettingsRow key={row.ticker} row={row} onSaved={handleSaved} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          리뷰 마감일은 리밸런싱 주기(분기/반기)의 마지막 거래일로 자동 계산되며, 종목 관리 화면에서 개인 일정에
          맞춰 직접 지정할 수도 있습니다.
        </p>
      </div>
    </div>
  )
}
