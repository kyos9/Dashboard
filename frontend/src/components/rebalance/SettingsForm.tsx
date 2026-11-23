import { useState } from 'react'
import { CURRENCY_META, num, REVIEW_PERIOD_LABEL } from '../../lib/display'
import type { CashRow, Currency, FxInfo, ReviewPeriod, Settings, SettingsUpdate } from '../../types'
import { NumberInput } from '../NumberInput'

/** 숫자 칸의 처음 값 — 소수 끝자리 잡음은 떼고 */
function initial(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(Number(value.toFixed(4)))
}

const BASE_LABEL: Record<Currency, string> = { KRW: '₩ 원', USD: '$ 달러', JPY: '¥ 엔' }
const PERIODS = Object.keys(REVIEW_PERIOD_LABEL) as ReviewPeriod[]

/**
 * PC 리밸런싱 설정 창 (디자인 5차 목업 07 가) — 칸마다 있던 "저장" · "적용" 여섯 개 대신 아래 "저장" 하나로 한 번에.
 * 바뀐 값만 모아 한 번 보낸다. 폰은 예전 칸별 저장 그대로(④ 에서 맞춘다).
 */
export function SettingsForm({
  settings,
  cash,
  cashCurrencies,
  fxCurrencies,
  fx,
  showFxEffect,
  isAdmin,
  busy,
  onRefreshFx,
  onSave,
  onCancel,
}: {
  settings: Settings
  cash: CashRow | null
  cashCurrencies: Currency[]
  /** 환율 칸이 필요한 통화 (기준통화가 아닌, 들고 있는 외화) */
  fxCurrencies: Currency[]
  fx: FxInfo | null | undefined
  /** 외화 종목이 있을 때만 "수익률에 환율 효과 포함" */
  showFxEffect: boolean
  isAdmin: boolean
  busy: boolean
  onRefreshFx: () => void
  onSave: (payload: SettingsUpdate) => void
  onCancel: () => void
}) {
  const [period, setPeriod] = useState<ReviewPeriod>(settings.review_period)
  const [override, setOverride] = useState(settings.review_date_override ?? '')
  const [cashIn, setCashIn] = useState<Partial<Record<Currency, string>>>(() =>
    Object.fromEntries(cashCurrencies.map((c) => [c, initial(settings.cash[c])])),
  )
  const [cashTarget, setCashTarget] = useState(initial(settings.cash_target_pct))
  const [base, setBase] = useState<Currency>(settings.base_currency)
  const [fxIn, setFxIn] = useState<Partial<Record<Currency, string>>>(() =>
    Object.fromEntries(fxCurrencies.map((c) => [c, initial(settings.fx_overrides[c])])),
  )
  const [fxEffect, setFxEffect] = useState(!!settings.include_fx_effect)
  const [band, setBand] = useState(initial(settings.default_rebalance_band_pct))

  // 바뀐 것만 모은다 — 안 바뀐 칸을 보내 다른 값이 덮이지 않게
  const payload: SettingsUpdate = {}
  if (period !== settings.review_period) payload.review_period = period
  if (override !== (settings.review_date_override ?? '')) payload.review_date_override = override === '' ? null : override
  const cashPatch: Partial<Record<Currency, number | null>> = {}
  for (const c of cashCurrencies) {
    const v = cashIn[c] ?? ''
    if (v !== initial(settings.cash[c])) cashPatch[c] = v === '' ? null : Number(v)
  }
  if (Object.keys(cashPatch).length > 0) payload.cash = cashPatch
  if (cashTarget !== initial(settings.cash_target_pct)) payload.cash_target_pct = Number(cashTarget || 0)
  if (base !== settings.base_currency) payload.base_currency = base
  const fxPatch: Partial<Record<Currency, number | null>> = {}
  for (const c of fxCurrencies) {
    const v = (fxIn[c] ?? '').trim()
    if (v !== initial(settings.fx_overrides[c])) fxPatch[c] = v === '' ? null : Number(v)
  }
  if (Object.keys(fxPatch).length > 0) payload.fx_overrides = fxPatch
  const fxEffectOn = base === 'KRW' && fxEffect
  if (showFxEffect && fxEffectOn !== !!settings.include_fx_effect) payload.include_fx_effect = fxEffectOn
  if (band !== initial(settings.default_rebalance_band_pct) && band !== '') payload.default_rebalance_band_pct = Number(band)
  const dirty = Object.keys(payload).length > 0

  return (
    <>
      <div className="sheet-body settings-form">
        <section className="sf-sec">
          <h4>리뷰 주기</h4>
          <div className="seg sf-seg" role="group" aria-label="리뷰 주기">
            {PERIODS.map((p) => (
              <button key={p} type="button" className={period === p ? 'active' : undefined} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {REVIEW_PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="sf-row">
            <input type="date" value={override} onChange={(e) => setOverride(e.target.value)} aria-label="다음 리뷰일" />
            <span className="hint">다음 리뷰일을 직접 정할 때만</span>
          </div>
          <p className="hint">직접 정한 날 무렵 기록을 남기면 다시 주기로 돌아갑니다.</p>
        </section>

        <section className="sf-sec">
          <h4>
            현금
            {cash && (
              <small className="hint">
                현재 {num(cash.actual_pct, 1)}%, 목표 {num(cash.target_pct, 1)}%
              </small>
            )}
          </h4>
          {cashCurrencies.map((c) => (
            <div className="sf-row" key={c}>
              <span className="sf-k">{CURRENCY_META[c].symbol}</span>
              <NumberInput
                value={cashIn[c] ?? ''}
                onChange={(v) => setCashIn((prev) => ({ ...prev, [c]: v }))}
                placeholder="0"
                allowDecimal={c === 'USD'}
                aria-label={`${CURRENCY_META[c].label} 현금`}
              />
            </div>
          ))}
          <div className="sf-row">
            <span className="sf-k">목표</span>
            <NumberInput value={cashTarget} onChange={setCashTarget} placeholder="0" aria-label="현금 목표 비중" />
            <span className="unit">%</span>
          </div>
          <p className="hint">예수금처럼 투자 대기 중인 돈. 목표 비중은 현금을 포함한 전체 자금 기준입니다.</p>
        </section>

        <section className="sf-sec">
          <h4>기준통화와 환율</h4>
          <div className="seg sf-seg" role="group" aria-label="기준통화">
            {(['KRW', 'USD', 'JPY'] as Currency[]).map((c) => (
              <button key={c} type="button" className={base === c ? 'active' : undefined} aria-pressed={base === c} onClick={() => setBase(c)}>
                {BASE_LABEL[c]}
              </button>
            ))}
          </div>
          {fxCurrencies.length === 0 ? (
            <p className="hint">환산할 외화 종목이 없습니다. 해외 종목을 담으면 그 통화의 환율 칸이 생깁니다.</p>
          ) : (
            <>
              {fxCurrencies.map((c) => {
                const quote = fx?.rates?.[c]
                const meta = CURRENCY_META[c]
                const source =
                  quote?.source === 'override' ? '직접' : quote?.source === 'fallback' ? '추정치' : quote ? '자동' : '환율 없음'
                return (
                  <div className="sf-row" key={c}>
                    <span className="sf-k">{meta.symbol}1</span>
                    <NumberInput
                      placeholder={quote ? num(quote.krw_rate, 2) : '자동'}
                      value={fxIn[c] ?? ''}
                      onChange={(v) => setFxIn((prev) => ({ ...prev, [c]: v }))}
                      aria-label={`원/${meta.label} 환율 직접 입력`}
                    />
                    <span className="unit">원</span>
                    <span className="hint sf-tag">{source}</span>
                  </div>
                )
              })}
              <p className="hint">
                고치면 그 값을 씁니다. 비우면 다시 자동으로.
                {isAdmin && (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={onRefreshFx} disabled={busy}>
                      전체 조회
                    </button>
                  </>
                )}
              </p>
            </>
          )}
          {showFxEffect && (
            <label className={`toggle-line${base !== 'KRW' ? ' disabled' : ''}`}>
              <input type="checkbox" checked={fxEffectOn} disabled={base !== 'KRW'} onChange={(e) => setFxEffect(e.target.checked)} />
              수익률에 환율 효과 포함
            </label>
          )}
          {showFxEffect && (
            <p className="hint">
              {base !== 'KRW'
                ? '기준통화가 원일 때만 켤 수 있습니다.'
                : '산 환율을 적은 외화 종목의 수익률을 원화로 따집니다. 비중은 그대로입니다.'}
            </p>
          )}
        </section>

        <section className="sf-sec">
          <h4>기본 밴드</h4>
          <div className="sf-row">
            <NumberInput value={band} onChange={setBand} aria-label="기본 밴드" />
            <span className="unit">%p</span>
          </div>
          <p className="hint">종목마다 밴드를 비워 두면 이 값을 씁니다. 현재 비중이 목표에서 이만큼 벗어나면 차이 칸에 색이 듭니다.</p>
        </section>
      </div>
      <div className="sheet-foot">
        <button type="button" className="ghost" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="primary" disabled={!dirty || busy} onClick={() => onSave(payload)}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </>
  )
}
