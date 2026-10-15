import { conditionMark } from '../lib/display'
import { buyRule, cardConditions, METRIC_ORDER, useSignalRules } from '../lib/signalRules'
import type { DashboardCard, SignalRuleCondition } from '../types'

/**
 * 매수 조건 한 줄 — "매수 조건 1/4  · 이격도 < 0  ✓ ADX > 20 …" (디자인 2차).
 *
 * 예전 카드는 조건 칩을 지표 칸마다 붙였다. 그러면 "거래량 한산" 바로 밑에 ✓ "변동성·거래량"이 와서
 * 숫자와 판정이 어긋나 보였고(변동성 쪽이 참이라서), 칸이 없는 조건은 아예 그려지지 않았다.
 * 이제 규칙의 조건을 **전부** 한 줄에 흐르는 칩으로 — 셋이든 다섯이든 줄이 꺾일 뿐이다.
 * 순서는 표의 칸 순서와 설명 줄과 같게(`METRIC_ORDER`, 칸이 없는 조건은 뒤에 받은 순서대로).
 * 이름·풀이는 규칙에서 온다 — 기준 숫자를 여기 적지 않는다.
 *
 * 카드(대시보드)와 차트 팝업이 같이 쓴다. 바깥 `.signal-rows` 격자 안에 한 줄로 들어간다.
 */
function orderedBuyConditions(conditions: SignalRuleCondition[]): SignalRuleCondition[] {
  const rank = (metric: string) => {
    const i = METRIC_ORDER.indexOf(metric)
    return i === -1 ? METRIC_ORDER.length : i
  }
  return [...conditions].sort((a, b) => rank(a.metric) - rank(b.metric))
}

export function BuyConditions({ card }: { card: DashboardCard }) {
  const rule = buyRule(useSignalRules())
  const conditions = orderedBuyConditions(rule.conditions)
  const states = cardConditions(card)
  const met = conditions.filter((c) => states[c.key] === true).length
  return (
    <div className="signal-row">
      <span className="signal-row-label">
        매수 조건{' '}
        <span className="nowrap mono">
          {met}/{conditions.length}
        </span>
      </span>
      <div className="signal-row-items">
        {conditions.map((condition) => {
          const state = states[condition.key]
          const mark = conditionMark(state)
          return (
            <span
              key={condition.key}
              className={`cond${state === true ? ' met' : ''}`}
              title={`${condition.detail} — ${mark.word}`}
              aria-label={`${condition.label} ${mark.word}`}
            >
              {mark.sign} {condition.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
