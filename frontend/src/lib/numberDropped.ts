/** 칸이 받지 않아 버린 것 중 사람이 알아야 하는 것 — 콤마·공백·"원" 은 붙여넣기 대비라 말없이 버린다 */
export type Dropped = 'minus' | 'decimal' | 'unit'

/**
 * 같은 입력에서 `parseNumeric` 이 **값이 달라지게** 버린 것 (0.45.1 A).
 * 말없이 버리면 "-3" 이 3, "7.5" 가 75, "100만" 이 100 으로 저장됐다 — 거절이 아니라 다른 숫자라 화면만 보고는 모른다.
 * - minus: 음수를 받지 않는 칸의 빼기, 음수 칸이면 맨 앞이 아닌 빼기("0.2-")
 * - decimal: 소수를 받지 않는 칸의 소수점 (소수 칸의 두 번째 소수점은 오타라 말없이 — 지금 그대로)
 * - unit: 만·억·천 — 곱하지 않고 버린다
 */
export function droppedKinds(input: string, allowDecimal: boolean, allowNegative = false): Dropped[] {
  const out: Dropped[] = []
  const minus = input.replace(/\u2212/g, '-')
  if (allowNegative ? /-/.test(minus.trimStart().replace(/^-/, '')) : minus.includes('-')) out.push('minus')
  if (!allowDecimal && input.includes('.')) out.push('decimal')
  if (/[만억천]/.test(input)) out.push('unit')
  return out
}

const DROPPED_TEXT: Record<Dropped, string> = {
  minus: '빼기(−)는 넣을 수 없습니다',
  decimal: '소수점은 넣을 수 없어 숫자만 이어 붙였습니다',
  unit: '‘만·억’ 은 읽지 않습니다. 0 을 모두 쳐 주세요',
}

/** 줄의 글 — 칸 이름 · 버린 것 · 지금 값(`shown` — 칸에 보이는 꼴, 콤마 포함). "소수점을 뺐습니다"만으로는 7 로 읽혔다(75 인데, 계획 사용자 검토) */
export function droppedText(label: string | undefined, kinds: Dropped[], shown: string): string {
  const what = kinds.map((k) => DROPPED_TEXT[k]).join(' · ')
  const now = shown === '' || shown === '-' ? '지금 값 없음' : `지금 값 ${shown}`
  return `${label ? `${label} — ` : ''}${what} · ${now}`
}

