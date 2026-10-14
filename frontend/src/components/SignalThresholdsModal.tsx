import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import { setSignalRules } from '../lib/signalRules'
import type { SignalRules, SignalThresholdKey, SignalThresholds } from '../types'
import { NumberInput } from './NumberInput'

/**
 * 시그널 기준 — 내 기준 (0.42.0, 명세 12장).
 *
 * 무릎매수·어깨매도의 **조건은 그대로**, 기준값 넷만 내 것으로 바꾼다. 공용 판정은 그대로이고, 바꾼 사람의 화면·차트·
 * 알림·리밸런싱·AI 가 모두 그 기준을 따른다. "기본값으로" 한 번이면 넷 다 처음으로 돌아간다.
 *
 * 바꾼 순간 이미 켜져 있는 매수는 알림을 보내지 않는다(서버가 상태만 적는다) — 그 뒤 새로 켜지는 것부터 알린다.
 */

const FIELDS: { key: SignalThresholdKey; label: string; unit: string; help: string; negative?: boolean; decimal: boolean }[] = [
  {
    key: 'adx_trend',
    label: 'ADX 기준',
    unit: '',
    decimal: true,
    help: "ADX(추세의 세기)가 이 값보다 크면 '추세가 있다'로 봅니다. 매수 조건 'ADX'에 쓰입니다. 올리면 매수 시그널이 드물어집니다.",
  },
  {
    key: 'vol_ratio_expand',
    label: '거래량비 기준',
    unit: '배',
    decimal: true,
    help: "거래량비 = 최근 5일 평균 거래량 ÷ 20일 평균. 이 값보다 크면 '거래가 붙는다'로 봅니다. 매수 조건 '변동성·거래량'에 쓰입니다 — 변동성이 줄었으면 거래량비와 상관없이 ✓ 입니다.",
  },
  {
    key: 'disparity_below',
    label: '이격도 기준',
    unit: '%',
    decimal: true,
    negative: true,
    help: '종가가 20일 평균(MA20)보다 몇 % 아래인지입니다. 0 이면 평균 아래이기만 하면 충족, −2 면 2% 넘게 아래일 때만 충족합니다. 매수 조건 \'이격도\'에 쓰입니다.',
  },
  {
    key: 'lookback_days',
    label: '비교 기간',
    unit: '거래일',
    decimal: false,
    help: "며칠(거래일) 전과 비교할지입니다. 매수 '변동성 축소'와 매도 'ADX 상승' 두 조건에 같이 쓰입니다.",
  },
]

function show(n: number): string {
  return String(n).replace('-', '−')
}

function toDraft(t: SignalThresholds): Record<SignalThresholdKey, string> {
  return Object.fromEntries(FIELDS.map((f) => [f.key, String(t[f.key])])) as Record<SignalThresholdKey, string>
}

export function SignalThresholdsModal({
  rules,
  onClose,
  onSaved,
}: {
  rules: SignalRules
  onClose: () => void
  /** 저장·되돌리기 뒤 — 카드·차트를 다시 받는다 */
  onSaved: () => void
}) {
  const defaults = rules.defaults ?? rules.thresholds
  const limits = rules.limits
  const [draft, setDraft] = useState(() => toDraft(rules.thresholds))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBackToClose(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  /** 칸마다 틀린 까닭 (없으면 null) — 서버도 같은 범위로 거른다 */
  const problems = useMemo(() => {
    const out: Partial<Record<SignalThresholdKey, string>> = {}
    for (const f of FIELDS) {
      const raw = draft[f.key]
      const value = Number(raw)
      const limit = limits?.[f.key]
      if (raw === '' || raw === '-' || !Number.isFinite(value)) {
        out[f.key] = '숫자를 넣어 주세요'
      } else if (limit && (value < limit.min || value > limit.max)) {
        out[f.key] = `${show(limit.min)} ~ ${show(limit.max)} 사이로 넣어 주세요`
      } else if (limit && Math.abs((value - limit.min) / limit.step - Math.round((value - limit.min) / limit.step)) > 1e-6) {
        out[f.key] = `${show(limit.step)} 단위로 넣어 주세요`
      }
    }
    return out
  }, [draft, limits])

  const valid = Object.keys(problems).length === 0
  const atDefaults = FIELDS.every((f) => Number(draft[f.key]) === defaults[f.key])

  const finish = (next: SignalRules) => {
    setSignalRules(next)
    onSaved()
    onClose()
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) as SignalThresholds
      finish(await api.putSignalThresholds(body))
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다')
      setBusy(false)
    }
  }

  const reset = async () => {
    // 아직 기본을 쓰는 중이면 고치던 칸만 되돌린다 — 저장할 것이 없다
    if (!rules.custom) {
      setDraft(toDraft(defaults))
      return
    }
    setBusy(true)
    setError(null)
    try {
      finish(await api.resetSignalThresholds())
    } catch (e) {
      setError(e instanceof Error ? e.message : '되돌리지 못했습니다')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal thresholds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresholds-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3 id="thresholds-title">시그널 기준</h3>
            <span className="hint">{rules.custom ? '내 기준을 쓰는 중' : '기본 기준을 쓰는 중'}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <p className="hint">
          매수·매도 시그널의 조건은 그대로 두고 기준 숫자만 바꿉니다. 내 화면·차트·알림·리밸런싱·AI 가 모두 이 기준을
          따르고, 다른 사람에게는 영향이 없습니다. 바꾼 순간 이미 켜진 매수는 알림을 보내지 않습니다.
        </p>

        {FIELDS.map((f) => {
          const id = `threshold-${f.key}`
          const changed = Number(draft[f.key]) !== defaults[f.key]
          return (
            <section key={f.key} className="threshold-row">
              <label htmlFor={id}>{f.label}</label>
              <div className="threshold-input">
                <NumberInput
                  id={id}
                  inputMode="decimal"
                  value={draft[f.key]}
                  allowDecimal={f.decimal}
                  allowNegative={f.negative}
                  aria-describedby={`${id}-help`}
                  aria-invalid={problems[f.key] ? true : undefined}
                  onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                />
                {f.unit && <span className="unit">{f.unit}</span>}
                <span className={`hint${changed ? ' changed' : ''}`}>
                  기본 {show(defaults[f.key])}
                  {f.unit}
                  {changed && ' · 바꿈'}
                </span>
              </div>
              {problems[f.key] && (
                <p className="field-error" role="alert">
                  {problems[f.key]}
                </p>
              )}
              <p className="hint" id={`${id}-help`}>
                {f.help}
              </p>
            </section>
          )
        })}

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <div className="btn-group thresholds-actions">
          <button className="primary" onClick={() => void save()} disabled={busy || !valid}>
            저장
          </button>
          <button
            className="ghost"
            onClick={() => void reset()}
            disabled={busy || (!rules.custom && atDefaults)}
          >
            기본값으로
          </button>
          <button className="ghost" onClick={onClose} disabled={busy}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
