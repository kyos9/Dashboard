import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAppState } from '../AppState'
import { macroChange, macroValue, zoneTone } from '../lib/macro'
import { RegimeBadges } from './RegimeBadges'
import type { MacroPinned, MacroSeriesInfo } from '../types'

/**
 * 홈 화면 맨 위의 매크로 한 줄.
 *
 * **종목 표를 밀어내지 않는 것이 우선이다.** 홈의 주인공은 여전히 종목이라, 카드가
 * 아니라 한 줄이고 폰에서는 가로로 밀어서 본다. 여기서 자세한 것을 다 보여주려 들면
 * 매크로 탭이 두 개가 된다.
 *
 * 무엇을 띄울지는 매크로 탭의 ☆ 로 고른다 (`portfolio_settings.pinned_macro`).
 */
function Chip({ series }: { series: MacroSeriesInfo }) {
  const change = macroChange(series.change, series.unit)
  return (
    <Link to="/macro" className="macro-chip" title={`${series.name} — 매크로 탭에서 보기`}>
      <span className="macro-chip-name">{series.name}</span>
      <span className="macro-chip-value mono">
        {macroValue(series.value, series.unit)}
        {change && <span className="macro-chip-change">{change}</span>}
      </span>
      {/* 구간 이름이 있는 지표(공포·탐욕)는 점수보다 구간이 먼저 읽힌다 */}
      {series.zone && (
        <span className={`macro-chip-zone ${zoneTone(series.zone)}`}>{series.zone.label}</span>
      )}
    </Link>
  )
}

export function MacroStrip() {
  const { refreshKey } = useAppState()
  const [data, setData] = useState<MacroPinned | null>(null)

  useEffect(() => {
    let alive = true
    api
      .getMacroPinned()
      .then((body) => alive && setData(body))
      // **홈에서는 매크로 실패를 띄우지 않는다.** 여기 한 줄이 안 나온다고 종목 표 위에
      // 빨간 띠가 생기면, 정작 중요한 것을 가린다. 왜 안 나오는지는 매크로 탭이 말한다.
      .catch(() => alive && setData(null))
    return () => {
      alive = false
    }
  }, [refreshKey])

  // 배지와 칩 중 하나라도 있으면 그린다. **배지는 칩과 따로 온다** — 지표를 다 내렸어도
  // 이상한 일이 생기면 알려야 한다 (`services/macro.py` 의 `badges` 주석 참고).
  if (!data || (data.series.length === 0 && data.badges.length === 0)) return null

  return (
    <div className="macro-home">
      <RegimeBadges badges={data.badges} />
      {data.series.length > 0 && (
        <div className="macro-strip" aria-label="매크로 지표 요약">
          {data.series.map((series) => (
            <Chip key={series.code} series={series} />
          ))}
        </div>
      )}
    </div>
  )
}
