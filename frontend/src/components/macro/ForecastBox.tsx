import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { macroValue } from '../../lib/macro'
import type { MacroSeriesInfo } from '../../types'
import { NumberInput } from '../NumberInput'
import { forecastSource, monthOf, surpriseWord } from './period'

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
  const monthRef = useRef<HTMLInputElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // 입력칸을 열면 첫 칸으로, 닫으면 "예상치 입력"으로 — 포커스가 body 로 떨어졌다(묶음 5 검토 조건 3)
  useEffect(() => {
    if (open) monthRef.current?.focus()
    else if (wasOpen.current) openRef.current?.focus()
    wasOpen.current = open
  }, [open])
  // 폼이 열린 채 Esc 는 폼만 닫는다 — 창째 닫혀 친 값이 사라졌다(검토 참고)
  const onFormKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    setOpen(false)
  }

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

  // 지우기는 나와 있는 예상마다 — 입력칸의 "지우기"는 칸이 다음 달로 잡혀 있어 지난달 예상이 안 지워졌다(묶음 5 사용자 확인)
  const remove = async (target: string) => {
    if (busy) return
    setBusy(true)
    await onClear(series.code, target)
    setBusy(false)
  }
  const removeButton = (asOf: string) =>
    editable && (
      <button type="button" className="link-btn forecast-remove" onClick={() => void remove(monthOf(asOf))} disabled={busy} aria-label={`${monthOf(asOf)} 예상 지우기`}>
        지우기
      </button>
    )

  return (
    <>
      {forecast && (
        <p className="macro-forecast">
          {/* "예상 2.50%, 실제 +0.15%p"는 실제 값이 +0.15% 처럼 읽혔다 — "예상보다 얼마 높음 · 낮음"으로 (묶음 5 사용자 확인).
              색은 안 쓴다 — 물가가 높은 게 좋은 일인지는 무엇을 들고 있느냐에 따라 다르고, 그 판단은 이 화면이 할 일이 아니다. */}
          <span className="hint">{monthOf(forecast.as_of)}</span> 예상 {macroValue(forecast.value, series.unit)}
          {forecast.surprise !== null && <span className="macro-surprise mono">{surpriseWord(forecast.surprise, series.unit)}</span>}
          <span className="hint"> ({forecastSource(forecast)})</span>
          {removeButton(forecast.as_of)}
        </p>
      )}
      {pending && (
        <p className="macro-forecast">
          <span className="hint">{monthOf(pending.as_of)}</span> 예상 {macroValue(pending.value, series.unit)}
          <span className="hint"> (아직 발표 전, {forecastSource(pending)})</span>
          {removeButton(pending.as_of)}
        </p>
      )}
      {!forecast && !pending && !editable && (
        // 지인 · 손님은 관리자가 넣기 전에는 아무것도 없어 "예상보다 높았나"를 찾다 헤맸다 (묶음 5 사용자 확인)
        <p className="hint macro-forecast">아직 넣은 예상치가 없습니다. 관리자가 넣으면 발표 뒤 예상보다 높았는지 낮았는지 붙습니다.</p>
      )}

      {open ? (
        <form className="forecast-form" onSubmit={(event) => void submit(event)} onKeyDown={onFormKey}>
          <label>
            <span className="hint">달</span>
            <input
              ref={monthRef}
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
              placeholder="예: 2.7"
              aria-label={`${series.name} 예상치`}
            />
          </label>
          <div className="forecast-actions">
            <button type="submit" className="primary" disabled={!canSave || busy}>
              저장
            </button>
            {/* 창의 ✕ "닫기"와 이름이 겹쳤다 — 무엇을 닫는지 (묶음 5 검토 참고) */}
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              입력 닫기
            </button>
          </div>
        </form>
      ) : editable ? (
        <button
          ref={openRef}
          className="link-btn forecast-open"
          onClick={() => {
            const target = defaultMonth(series)
            setMonth(target)
            // 그 달 예상이 이미 있으면 그 값으로 — 빈 칸에 회색 예시만 보여 저장값이 바뀐 것처럼 읽혔다 (묶음 5 사용자 확인)
            const same = [series.pending_forecast, series.forecast].find((f) => f && monthOf(f.as_of) === target)
            setValue(same ? String(same.value) : '')
            setOpen(true)
          }}
        >
          예상치 입력
        </button>
      ) : null}
    </>
  )
}
