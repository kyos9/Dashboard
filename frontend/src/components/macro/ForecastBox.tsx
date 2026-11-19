import { useState, type FormEvent } from 'react'
import { macroChange, macroValue } from '../../lib/macro'
import type { MacroSeriesInfo } from '../../types'
import { NumberInput } from '../NumberInput'
import { monthOf } from './period'

/**
 * 입력칸에 처음 들어가 있을 달.
 *
 * **마지막 발표의 다음 달이다.** 예상치를 적는 때는 보통 발표 **전**이고, 그때 궁금한
 * 것은 아직 안 나온 달이다. 마지막 발표 달을 기본으로 두면 매번 한 칸씩 올려야 한다.
 */
function defaultMonth(series: MacroSeriesInfo): string {
  if (!series.as_of) return monthOf(null)
  const [year, month] = series.as_of.slice(0, 7).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 예상치 한 줄과 그 입력칸.
 *
 * 지표 차트 창 안에 둔다(디자인 4차 목업 14 ② — 줄 아래 따로 붙어 목록이 길었다). 설정 화면으로 보내면
 * 어떤 값이 나왔는지 보면서 적을 수가 없고, 예상치는 그 값 바로 옆에서만 뜻이 있다.
 */
export function ForecastBox({
  series,
  editable,
  onSave,
  onClear,
}: {
  series: MacroSeriesInfo
  /** 예상치는 전원이 같이 보는 값이라 관리자만 넣는다. 나머지는 읽기만 */
  editable: boolean
  onSave: (code: string, month: string, value: number) => Promise<boolean>
  onClear: (code: string, month: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => defaultMonth(series))
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const { forecast, pending_forecast: pending } = series
  const number = Number(value)
  const canSave = value !== '' && value !== '-' && Number.isFinite(number)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave || busy) return
    setBusy(true)
    const ok = await onSave(series.code, month, number)
    setBusy(false)
    if (ok) {
      setOpen(false)
      setValue('')
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    const ok = await onClear(series.code, month)
    setBusy(false)
    if (ok) {
      setOpen(false)
      setValue('')
    }
  }

  return (
    <>
      {forecast && (
        <p className="macro-forecast">
          예상 {macroValue(forecast.value, series.unit)}
          {forecast.surprise !== null && (
            /* 실제 − 예상. 색은 안 쓴다 — 물가가 높은 게 좋은 일인지는 무엇을 들고
               있느냐에 따라 다르고, 그 판단은 이 화면이 할 일이 아니다. */
            <span className="macro-surprise mono">
              실제 {macroChange(forecast.surprise, series.unit)}
            </span>
          )}
          <span className="hint"> {forecast.source_label}</span>
        </p>
      )}
      {pending && (
        <p className="macro-forecast">
          <span className="hint">{monthOf(pending.as_of)} 예상</span>{' '}
          {macroValue(pending.value, series.unit)}
          <span className="hint"> {pending.source_label} · 아직 발표 전</span>
        </p>
      )}

      {open ? (
        <form className="forecast-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span className="hint">달</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              aria-label={`${series.name} 예상치가 가리키는 달`}
            />
          </label>
          <label>
            <span className="hint">예상(%)</span>
            {/* 전년비는 마이너스가 될 수 있다 (2009·2015년 CPI) — 빼기표를 받는다 */}
            <NumberInput
              value={value}
              onChange={setValue}
              allowNegative
              placeholder="2.7"
              aria-label={`${series.name} 예상치`}
            />
          </label>
          <div className="forecast-actions">
            <button type="submit" className="primary" disabled={!canSave || busy}>
              저장
            </button>
            <button type="button" onClick={() => void remove()} disabled={busy}>
              지우기
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              닫기
            </button>
          </div>
        </form>
      ) : editable ? (
        <button
          className="link-btn forecast-open"
          onClick={() => {
            setMonth(defaultMonth(series))
            setValue('')
            setOpen(true)
          }}
        >
          예상치 입력
        </button>
      ) : null}
    </>
  )
}
