/** 칸이 받지 않아 버린 것 중 사람이 알아야 하는 것 — 콤마·공백·"원" 은 붙여넣기 대비라 말없이 버린다 */
export type Dropped = 'minus' | 'minusMiddle' | 'decimal' | 'unit'

/**
 * 같은 입력에서 `parseNumeric` 이 **값이 달라지게** 버린 것 (0.45.1 A).
 * 말없이 버리면 "-3" 이 3, "7.5" 가 75, "100만" 이 100 으로 저장됐다 — 거절이 아니라 다른 숫자라 화면만 보고는 모른다.
 * - minus: 음수를 받지 않는 칸의 빼기
 * - minusMiddle: 음수 칸에서 맨 앞이 아닌 빼기("0.2-") — 그 칸은 맨 앞 빼기를 받으니 말이 다르다
 * - decimal: 소수를 받지 않는 칸의 소수점 (소수 칸의 두 번째 소수점은 오타라 말없이 — 지금 그대로)
 * - unit: 만·억·천 — 곱하지 않고 버린다
 */
export function droppedKinds(input: string, allowDecimal: boolean, allowNegative = false): Dropped[] {
  const out: Dropped[] = []
  const minus = input.replace(/\u2212/g, '-')
  if (!allowNegative && minus.includes('-')) out.push('minus')
  if (allowNegative && /-/.test(minus.trimStart().replace(/^-/, ''))) out.push('minusMiddle')
  if (!allowDecimal && input.includes('.')) out.push('decimal')
  if (/[만억천]/.test(input)) out.push('unit')
  return out
}

const DROPPED_TEXT: Record<Dropped, string> = {
  minus: '빼기(−)는 넣을 수 없습니다',
  minusMiddle: '빼기(−)는 맨 앞에만 쓸 수 있습니다',
  decimal: '소수점은 넣을 수 없어 숫자만 이어 붙였습니다',
  unit: '‘만·억·천’ 은 읽지 않습니다. 0 을 모두 쳐 주세요',
}

/** 줄의 글 — 칸 이름 · 버린 것 · 지금 값(`shown` — 칸에 보이는 꼴, 콤마 포함). "소수점을 뺐습니다"만으로는 7 로 읽혔다(75 인데, 계획 사용자 검토) */
export function droppedText(label: string | undefined, kinds: Dropped[], shown: string, minusHint?: string): string {
  const what = kinds.map((k) => DROPPED_TEXT[k]).join(' · ')
  const now = shown === '' || shown === '-' ? '지금 값 없음' : `지금 값 ${shown}`
  // 빼기를 버렸을 때만 칸마다의 한 마디 — "-3" 을 "3주 팔았다"로 친 사람에게 3주가 남는다는 말이 없었다(0.45.2 A2)
  const hint = minusHint && kinds.includes('minus') ? ` · ${minusHint}` : ''
  return `${label ? `${label} — ` : ''}${what} · ${now}${hint}`
}

/** 보유 수량 칸들의 한 마디 — 합계를 넣는 칸이다 (0.45.2 A2) */
export const HOLDING_MINUS_HINT = '보유 수량은 가진 전체 수량입니다(판 수량이 아닙니다)'
/** 리밸런싱 거래 입력의 수량 — "샀다"인 채 -3 을 치면 3주 산 것으로 저장된다 (0.45.2 A2, 계획 개발자 검토) */
export const TRADE_MINUS_HINT = '팔았으면 ‘팔았다’를 고르세요'

