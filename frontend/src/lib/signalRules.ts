import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import type { DashboardCard, SignalRule, SignalRuleCondition, SignalRules } from '../types'
import legacy from './signalRulesLegacy.json'

/* ---------- 시그널 규칙 — 서버가 정의를 갖고, 화면은 받아서 쓴다 (0.41.0) ----------
   조건 이름표·열 머리·설명 줄·기준값을 화면에 다시 적지 않는다. 서버(`services/signal_rules.py`)가
   `GET /api/signal-rules` 로 내려주고, 여기는 그것을 한 번 받아 둔다.

   - **옛 서버**(그 API 가 없다)면 0.40.0 서버의 규칙(`signalRulesLegacy.json` — 기준값은 0.40.0, 이름은 지금 화면과 같게)을
     쓴다. 지금 서버의 기본 응답과 글자까지 같아서(서버 테스트가 본다) 받기 전후로 화면이 깜빡이지 않는다.
   - 폰에 설치한 앱은 며칠씩 떠 있다. 대시보드 카드가 다른 판(`signal_rules_version`)을 말하면 다시 받는다. */

export const LEGACY_SIGNAL_RULES: SignalRules = legacy as SignalRules

let current: SignalRules = LEGACY_SIGNAL_RULES
/** 한 번이라도 물어봤나. 옛 서버(없음)였으면 'legacy' — 카드가 판을 말하면(새 서버) 다시 묻는다 */
let loaded: string | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 규칙을 받아 둔다. `wanted` 판을 이미 들고 있으면 다시 받지 않는다. 실패하면 들고 있던 것을 그대로 쓴다. */
export function ensureSignalRules(wanted?: string | null): Promise<void> {
  if (inflight) return inflight
  if (loaded !== null && (!wanted || wanted === current.version)) return Promise.resolve()
  inflight = api
    .getSignalRules()
    .then((rules) => {
      current = rules
      loaded = rules.version
      emit()
    })
    .catch(() => {
      // 옛 서버(404)거나 잠깐 안 닿았다 — 지금 들고 있는 규칙(처음엔 0.40.0 의 것)으로 계속 그린다
      if (loaded === null) loaded = 'legacy'
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** 지금 쓰는 규칙. 카드가 말하는 판(`version`)이 다르면 뒤에서 다시 받는다. */
export function useSignalRules(version?: string | null): SignalRules {
  const rules = useSyncExternalStore(subscribe, () => current, () => current)
  useEffect(() => {
    void ensureSignalRules(version)
  }, [version])
  return rules
}

/** 서버가 돌려준 새 규칙으로 바로 바꾼다 — 기준을 저장한 뒤(0.42.0). 종목이 0개라 카드로 판을 못 받는 사람도 */
export function setSignalRules(rules: SignalRules) {
  current = rules
  loaded = rules.version
  emit()
}

/** 기준을 바꿀 수 있는 서버인가 — 0.40.0(규칙 API 없음)·0.41.0(`custom` 없음)이면 아니다 */
export function canCustomize(rules: SignalRules): boolean {
  return typeof rules.custom === 'boolean' && !!rules.defaults && !!rules.limits
}

/** 시험용 — 받아 둔 규칙을 처음 상태로 */
export function resetSignalRules() {
  current = LEGACY_SIGNAL_RULES
  loaded = null
  inflight = null
  emit()
}

export function buyRule(rules: SignalRules): SignalRule {
  return rules.rules.find((r) => r.key === 'buy') ?? LEGACY_SIGNAL_RULES.rules[0]
}

export function sellRule(rules: SignalRules): SignalRule {
  return rules.rules.find((r) => r.key === 'sell') ?? LEGACY_SIGNAL_RULES.rules[1]
}

/** 지표 칸 → 그 칸에 붙는 매수 조건 */
export function conditionByMetric(rules: SignalRules): Record<string, SignalRuleCondition> {
  return Object.fromEntries(buyRule(rules).conditions.map((c) => [c.metric, c]))
}

/** 카드의 조건별 판정 — 새 서버는 `buy_conditions`, 옛 서버는 `knee_conditions`(키가 같다) */
export function cardConditions(card: DashboardCard): Record<string, boolean | null> {
  const fresh = card.buy_conditions
  if (fresh && Object.keys(fresh).length > 0) return fresh
  return { ...card.knee_conditions }
}

const COUNT_WORD: Record<number, string> = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯', 6: '여섯', 7: '일곱', 8: '여덟' }

/** 조건 수를 글로 — 4 → "네" ("네 조건") */
export function countWord(n: number): string {
  return COUNT_WORD[n] ?? String(n)
}

/** 표·카드의 지표 칸 순서 — 설명 줄도 이 순서로 읽는다 (0.42.0 B1). 칸이 없는 조건은 뒤에, 받은 순서대로 */
export const METRIC_ORDER = ['disparity', 'adx', 'di', 'volume']

/** 시그널 보기 아래 설명 줄의 앞부분 — "매수 시그널 = A · B · C · D — 네 조건을 모두 만족할 때." */
export function buyRuleSentence(rules: SignalRules): string {
  const rule = buyRule(rules)
  const n = rule.conditions.length
  const rank = (metric: string) => {
    const i = METRIC_ORDER.indexOf(metric)
    return i === -1 ? METRIC_ORDER.length : i
  }
  // 정의(서버)의 조건 순서는 AI 지시문과 지문이 쓴다 — 바꾸지 않고 화면에서만 칸 순서로 늘어놓는다
  const ordered = [...rule.conditions].sort((a, b) => rank(a.metric) - rank(b.metric))
  return `${rule.name} = ${ordered.map((c) => c.formula).join(' · ')} — ${countWord(n)} 조건을 모두 만족할 때.`
}
