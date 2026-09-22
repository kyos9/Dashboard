import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { macroValue } from '../lib/macro'
import type { MacroHistory } from '../types'
import { ErrorNotice } from './ErrorNotice'
import { MacroChart } from './MacroChart'

export const MACRO_RANGES = [
  { value: '1y', label: '1년' },
  { value: '5y', label: '5년' },
  { value: '10y', label: '10년' },
  { value: 'max', label: '전체' },
] as const

interface Props {
  code: string
  name: string
  onClose: () => void
}

/**
 * 지표 하나의 흐름을 화면 위에 띄운다.
 *
 * **기본이 5년이다.** 시세 차트는 1년으로 여는데 여기는 다르다 — 매크로는 "지금이
 * 어느 정도인지"를 보는 것이고, 금리 4%가 높은지 낮은지는 2020년이 화면에 있어야
 * 보인다. 1년만 띄우면 모든 지표가 "요즘 좀 오르네/내리네"로만 읽힌다.
 */
export function MacroChartModal({ code, name, onClose }: Props) {
  const [range, setRange] = useState<string>('5y')
  const [history, setHistory] = useState<MacroHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getMacroHistory(code, range)
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [code, range])

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게
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

  const points = history?.points ?? []
  const last = points[points.length - 1]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} 차트`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{name}</h3>
            <span className="hint">
              {code}
              {history?.transform_label ? ` · ${history.transform_label}` : ''}
            </span>
          </div>
          <div className="chip-row">
            {MACRO_RANGES.map((option) => (
              <button
                key={option.value}
                className={`chip${range === option.value ? ' active' : ''}`}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />
        <MacroChart history={history} height={360} />
        <div className="legend-row">
          <span className="hint">
            {loading
              ? '불러오는 중…'
              : points.length === 0
                ? '이 기간에 저장된 값이 없습니다'
                : `${points.length.toLocaleString('ko-KR')}개 · ${points[0].as_of} ~ ${last.as_of}`}
          </span>
          {!loading && last && history && (
            <span className="mono">최근 {macroValue(last.value, history.unit)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
