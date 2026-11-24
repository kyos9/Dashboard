import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import { macroValue } from '../lib/macro'
import type { MacroHistory, MacroSeriesInfo } from '../types'
import { ForecastBox } from './macro/ForecastBox'
import { ErrorNotice } from './ErrorNotice'
import { MacroChart } from './MacroChart'
import { lockBodyScroll } from '../lib/scrollLock'
import { useFocusTrap } from '../lib/focusTrap'

export const MACRO_RANGES = [
  { value: '1y', label: '1년' },
  { value: '5y', label: '5년' },
  { value: '10y', label: '10년' },
  { value: 'max', label: '전체' },
] as const

interface Props {
  code: string
  name: string
  /** 매크로 탭에서 열면 지표 정보 — 제목 옆 풀이와 예상치(목업 14 ②: 입력칸은 줄 아래가 아니라 여기) */
  series?: MacroSeriesInfo
  /** 예상치는 전원이 같이 보는 값이라 관리자만 넣는다 */
  canEditForecast?: boolean
  onSaveForecast?: (code: string, month: string, value: number) => Promise<boolean>
  onClearForecast?: (code: string, month: string) => Promise<boolean>
  /** 예상치 저장이 실패한 까닭 — 창 뒤 화면에 띄우면 가려서 못 본다 */
  forecastError?: unknown
  onForecastErrorDismiss?: () => void
  onClose: () => void
}

/**
 * 지표 하나의 흐름을 화면 위에 띄운다.
 *
 * **기본이 5년이다.** 시세 차트는 1년으로 여는데 여기는 다르다 — 매크로는 "지금이
 * 어느 정도인지"를 보는 것이고, 금리 4%가 높은지 낮은지는 2020년이 화면에 있어야
 * 보인다. 1년만 띄우면 모든 지표가 "요즘 좀 오르네/내리네"로만 읽힌다.
 */
export function MacroChartModal({
  code,
  name,
  series,
  canEditForecast = false,
  onSaveForecast,
  onClearForecast,
  forecastError = null,
  onForecastErrorDismiss,
  onClose,
}: Props) {
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

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  // Tab 은 창 안에서만 돈다 · 열면 포커스를 창으로, 닫으면 연 줄로 — 예상치 폼을 넣으며 키보드가 창 밖으로 샜다(묶음 5 검토 조건 3)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  // ESC로 닫기 + 뒤 화면이 같이 스크롤되지 않게
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  const points = history?.points ?? []
  const last = points[points.length - 1]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal chart-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} 차트`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>{name}</h3>
            {/* 출처의 코드(CPIAUCSL) 대신 풀이 — 코드는 마우스를 올리면 (목업 14 ③ 가) */}
            <span className="hint" title={code}>
              {[series?.note, history?.transform_label ?? series?.transform_label].filter(Boolean).join(', ') || code}
            </span>
          </div>
          <div className="seg" role="group" aria-label="기간">
            {MACRO_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={range === option.value ? 'active' : undefined}
                aria-pressed={range === option.value}
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
                : `${points.length.toLocaleString('ko-KR')}개, ${points[0].as_of} ~ ${last.as_of}`}
          </span>
          {!loading && last && history && (
            <span className="mono">최근 {macroValue(last.value, history.unit)}</span>
          )}
        </div>
        {series?.forecastable && onSaveForecast && onClearForecast && (
          <div className="macro-forecast-box">
            <ErrorNotice error={forecastError} onDismiss={() => onForecastErrorDismiss?.()} />
            <ForecastBox series={series} editable={canEditForecast} onSave={onSaveForecast} onClear={onClearForecast} />
          </div>
        )}
      </div>
    </div>
  )
}
