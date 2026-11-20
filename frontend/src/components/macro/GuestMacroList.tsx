import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useAppState } from '../../AppState'
import { useCachedLoad } from '../../lib/cache'
import { macroChange, macroValue, zoneTone } from '../../lib/macro'
import { Icon } from '../icons/Icon'
import { RegimeBadges } from '../RegimeBadges'
import { periodOf } from './period'
import type { MacroPinned, MacroSeriesInfo } from '../../types'

/**
 * 손님(로그인 전) 첫 화면 맨 위의 매크로 목록 — 디자인 4차 목업 15 ③ 나 "매크로 목록 먼저".
 *
 * 첫인상 정답이 "매크로는 볼 수 있고, 내 종목은 구글 로그인"이다. 전에는 가로로 미는 칩 셋이라
 * 폰 390 에서 셋째 칩이 잘려 보였다. 매크로 탭과 같은 줄 모양으로 세우고, 아래에 "모두 보기"를 둔다.
 *
 * 무엇을 띄울지는 `pinned_macro` — 손님은 서버의 기본값(관리자가 정함).
 * 승인 대기인 사람도 손님 화면을 본다(AuthGate).
 */

/** 금리차는 두 금리의 차이라 "%p" 로 읽는다 — 값 줄만 바꾸고 계산은 그대로 (`lib/macro` 는 단위만 본다) */
function valueText(series: MacroSeriesInfo): string {
  const value = macroValue(series.value, series.unit)
  return series.code === 'TERM_SPREAD' && value.endsWith('%') ? `${value}p` : value
}

/** 가장 늦은 기준일 "11/19 기준". 지표마다 날이 달라도 목록 머리에는 하나만 */
function latestDay(series: MacroSeriesInfo[]): string {
  const days = series.map((s) => s.as_of).filter((d): d is string => Boolean(d)).sort()
  const last = days[days.length - 1]
  if (!last) return ''
  const [, m, d] = last.split('-')
  return `${Number(m)}/${Number(d)} 기준`
}

function Row({ series }: { series: MacroSeriesInfo }) {
  const change = macroChange(series.change, series.unit)
  const value = valueText(series)
  const sub = [series.note, series.transform_label, periodOf(series)].filter(Boolean).join(', ')
  const zone = series.zone ? `${series.zone.label} 구간` : ''
  return (
    <li className="macro-row">
      <Link
        to="/macro"
        className="macro-row-open"
        aria-label={[series.name, zone && `${zone} ${series.zone?.range}`, sub, `${value}${change ? ` ${change}` : ''} — 매크로 탭에서 보기`]
          .filter(Boolean)
          .join(', ')}
      >
        <span className="macro-row-name">
          <b>
            {series.name}
            {/* 구간 이름이 있는 지표(공포·탐욕)는 점수보다 구간이 먼저 읽힌다 */}
            {series.zone && (
              <span className={`macro-zone-tag ${zoneTone(series.zone)}`}>
                {zone} <span className="macro-zone-range">{series.zone.range}</span>
              </span>
            )}
          </b>
          {sub && <small>{sub}</small>}
        </span>
        <span className="macro-row-value">
          <b className="mono">{value}</b>
          {change && <small className="mono">{change}</small>}
        </span>
        <Icon name="forward" size={18} className="macro-row-go" />
      </Link>
    </li>
  )
}

export function GuestMacroList() {
  const { refreshKey } = useAppState()
  const [data, setData] = useState<MacroPinned | null>(null)

  // **첫 화면에서는 매크로 실패를 띄우지 않는다.** 여기가 안 나온다고 로그인 안내 위에
  // 빨간 띠가 생기면 정작 할 일을 가린다. 왜 안 나오는지는 매크로 탭이 말한다.
  // 탭을 옮겨 와도 들고 있던 값을 먼저 그린다 (ROADMAP 8-1)
  useCachedLoad('strip:macro-pinned', api.getMacroPinned, setData, () => setData(null), [refreshKey])

  // 배지와 줄 중 하나라도 있으면 그린다. **배지는 지표와 따로 온다** — 지표를 다 내렸어도
  // 이상한 일이 생기면 알려야 한다 (`services/macro.py` 의 `badges` 주석 참고).
  if (!data || (data.series.length === 0 && data.badges.length === 0)) return null

  return (
    <section className="guest-macro">
      <RegimeBadges badges={data.badges} />
      {data.series.length > 0 && (
        <>
          <div className="macro-list-head">
            <h3 id="guest-macro-title">오늘 매크로</h3>
            <span className="hint">{latestDay(data.series)}</span>
          </div>
          {/* role="list" — list-style 을 끄면 iOS VoiceOver 가 목록으로 읽지 않는다 (검토 6 참고) */}
          <ul className="macro-list" role="list" aria-labelledby="guest-macro-title">
            {data.series.map((series) => (
              <Row key={series.code} series={series} />
            ))}
          </ul>
          <Link to="/macro" className="guest-macro-all">
            매크로 지표 모두 보기
          </Link>
        </>
      )}
    </section>
  )
}
