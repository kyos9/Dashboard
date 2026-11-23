import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { macroChange, macroValue, statusOf } from '../../lib/macro'
import type { MacroHistory, MacroSeriesInfo } from '../../types'
import { ErrorNotice } from '../ErrorNotice'
import { MacroChart } from '../MacroChart'
import { MACRO_RANGES } from '../MacroChartModal'
import { ForecastBox } from './ForecastBox'

const RANGE_WORD: Record<string, string> = { '1y': '1년', '5y': '5년', '10y': '10년', max: '전체' }

/** 마지막 날에서 1년쯤 전 값 — 그 날이 없으면 그 앞의 가장 가까운 날 */
function yearAgo(points: { as_of: string; value: number }[]): number | null {
  const last = points[points.length - 1]
  if (!last) return null
  const d = new Date(`${last.as_of}T00:00:00`)
  d.setFullYear(d.getFullYear() - 1)
  const target = d.toISOString().slice(0, 10)
  let found: number | null = null
  for (const p of points) {
    if (p.as_of > target) break
    found = p.value
  }
  return found
}

/** "2026-11-22" → "11월 22일" */
function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-').map(Number)
  return `${m}월 ${d}일`
}

/**
 * PC 매크로 오른쪽 — 고른 지표의 차트, 숫자 넷(기간 평균 · 범위 · 1년 전 · 기준), 예상치 (디자인 5차 목업 06 나).
 * 차트는 창을 띄우지 않고 화면에. 차트 코드는 이 부품과 함께 늦게 받는다(MacroPanel 의 lazyChunk).
 */
export function MacroDetail({
  series,
  canEditForecast,
  onSaveForecast,
  onClearForecast,
  forecastError,
  onForecastErrorDismiss,
}: {
  series: MacroSeriesInfo
  canEditForecast: boolean
  onSaveForecast: (code: string, month: string, value: number) => Promise<boolean>
  onClearForecast: (code: string, month: string) => Promise<boolean>
  forecastError: unknown
  onForecastErrorDismiss: () => void
}) {
  // 기본 5년 — 금리 4% 가 높은지 낮은지는 2020년이 화면에 있어야 보인다 (MacroChartModal 과 같은 까닭)
  const [range, setRange] = useState('5y')
  // 받은 것은 어느 지표 · 기간 것인지 같이 쥔다 — 받는 중인지는 그 열쇠로 안다(효과 안에서 상태를 바로 바꾸지 않게)
  const [got, setGot] = useState<{ key: string; history: MacroHistory | null; error: unknown } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const code = series.code
  const key = `${code}:${range}`

  useEffect(() => {
    let live = true
    api
      .getMacroHistory(code, range)
      .then((h) => live && setGot({ key: `${code}:${range}`, history: h, error: null }))
      .catch((e) => live && setGot({ key: `${code}:${range}`, history: null, error: e }))
    return () => {
      live = false
    }
  }, [code, range])

  const loading = got?.key !== key
  const history = got?.history ?? null
  const error = !loading && !dismissed ? (got?.error ?? null) : null
  const setError = () => setDismissed(true)

  const points = history?.code === code ? history.points : []
  const values = points.map((p) => p.value)
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  const ago = range === '1y' || range === '5y' || range === '10y' || range === 'max' ? yearAgo(points) : null
  const word = RANGE_WORD[range]
  const change = macroChange(series.change, series.unit)
  const status = statusOf(series)
  const sub = [series.note, series.transform_label].filter(Boolean).join(', ')

  return (
    <article className="sig-detail macro-detail" aria-label={`${series.name} 차트`}>
      <header className="macro-detail-head">
        <div>
          <h3>
            {series.name} {sub && <small className="hint" title={code}>{sub}</small>}
          </h3>
          <div className="macro-detail-value">
            <b className="mono">{macroValue(series.value, series.unit)}</b>
            {change && <span className="mono">{change}</span>}
          </div>
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
      </header>

      <ErrorNotice error={error} onDismiss={setError} />
      <MacroChart history={history?.code === code ? history : null} height={320} />
      {!loading && points.length === 0 && <p className="hint">이 기간에 저장된 값이 없습니다.</p>}

      <dl className="macro-facts">
        <div>
          <dt>{word} 평균</dt>
          <dd className="mono">{mean == null ? '—' : macroValue(mean, series.unit)}</dd>
        </div>
        <div>
          <dt>{word} 범위</dt>
          <dd className="mono">{min == null || max == null ? '—' : `${macroValue(min, series.unit)} ~ ${macroValue(max, series.unit)}`}</dd>
        </div>
        <div>
          <dt>1년 전</dt>
          <dd className="mono">{ago == null ? '—' : macroValue(ago, series.unit)}</dd>
        </div>
        <div>
          <dt>기준</dt>
          <dd>{series.frequency === 'monthly' && series.as_of ? `${Number(series.as_of.slice(5, 7))}월분` : dayLabel(series.as_of)}</dd>
        </div>
      </dl>

      {(status || series.last_error) && (
        <div className="macro-detail-status">
          {status && <span className={`badge ${status.tone}`}>{status.text}</span>}
          {series.last_error && (
            <details className="error-detail">
              <summary>왜 못 받았는지 보기</summary>
              <p>{series.last_error}</p>
            </details>
          )}
        </div>
      )}

      {series.forecastable && (
        <div className="macro-forecast-box">
          <ErrorNotice error={forecastError} onDismiss={onForecastErrorDismiss} />
          <ForecastBox series={series} editable={canEditForecast} onSave={onSaveForecast} onClear={onClearForecast} />
        </div>
      )}
    </article>
  )
}
