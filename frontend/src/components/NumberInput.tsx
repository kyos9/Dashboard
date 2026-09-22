import { useRef, type InputHTMLAttributes } from 'react'

/**
 * 숫자 입력칸.
 *
 * `<input type="number">`를 쓰지 않는다. 브라우저가 붙이는 위아래 화살표는 이 앱에서
 * 쓸 일이 없는 데다 칸 폭을 잡아먹고, 무엇보다 천 단위 구분 기호를 넣을 수 없다.
 * 100만원과 1000만원을 자릿수만 보고 구별하는 건 사람이 잘 못하는 일이라, 금액을
 * 직접 치는 화면에서는 콤마가 있어야 한다.
 *
 * 화면에는 `1,000,000`을 보여주고 바깥으로는 `1000000`을 돌려준다. 부모는 지금까지처럼
 * `Number(value)`로 쓰면 된다.
 */

/** 표시용으로 세 자리마다 콤마를 넣는다. 소수부는 건드리지 않는다 (타이핑 중일 수 있다) */
export function formatNumeric(raw: string): string {
  if (raw === '') return ''
  // 앞의 빼기표는 떼어놓고 숫자만 묶는다. 같이 넣으면 "-1,234" 가 "-,1234" 가 된다
  if (raw.startsWith('-')) return `-${formatNumeric(raw.slice(1))}`
  const [whole, ...rest] = raw.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // "1000." 처럼 소수점만 찍은 중간 상태도 그대로 살려야 계속 칠 수 있다
  return rest.length > 0 ? `${grouped}.${rest.join('')}` : grouped
}

/**
 * 사람이 친 것에서 숫자만 남긴다.
 * - 콤마·공백·문자는 버린다 (붙여넣기한 "1,234원"도 받아들인다)
 * - 소수점은 하나만 남긴다
 * - 음수는 **부르는 쪽이 허락할 때만** 받는다
 *
 * 기본이 "안 받는다"인 이유는 금액·수량·비중에 음수가 들어갈 일이 없어서다. 물가
 * 예상치는 그 셋 중 어느 것도 아니다 — 전년비는 실제로 마이너스가 된 적이 있고
 * (2009년·2015년 CPI), 그때 빼기표를 조용히 버리면 −0.2 를 넣었는데 0.2 가 저장된다.
 * 거절이 아니라 **다른 숫자**가 되는 것이라 화면만 보고는 알아채기 어렵다.
 */
export function parseNumeric(input: string, allowDecimal: boolean, allowNegative = false): string {
  const negative = allowNegative && input.trimStart().startsWith('-')
  const body = negative ? parseNumeric(input.replace('-', ''), allowDecimal) : null
  if (body !== null) return `-${body}`

  const cleaned = input.replace(/[^\d.]/g, '')
  if (!allowDecimal) return cleaned.replace(/\./g, '')

  const first = cleaned.indexOf('.')
  if (first === -1) return cleaned
  return cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/\./g, '')
}

/** 커서 앞에 숫자가 몇 개 있는지 — 콤마가 끼어들어도 커서 자리를 지키기 위한 기준 */
function digitsBefore(text: string, caret: number): number {
  return (text.slice(0, caret).match(/[\d.]/g) ?? []).length
}

/** 숫자 n개를 지난 지점의 인덱스 */
function caretAfterDigits(text: string, n: number): number {
  if (n === 0) return 0
  let seen = 0
  for (let i = 0; i < text.length; i++) {
    if (/[\d.]/.test(text[i])) {
      seen += 1
      if (seen === n) return i + 1
    }
  }
  return text.length
}

interface Props
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** 숫자만 담긴 문자열. 빈 문자열은 "입력 없음" */
  value: string
  onChange: (value: string) => void
  /** 소수 허용 여부. 비중·밴드·환율은 true, 원화 금액은 false */
  allowDecimal?: boolean
  /** 음수 허용 여부. 기본은 false — 물가 예상치처럼 마이너스가 되는 값에만 켠다 */
  allowNegative?: boolean
}

export function NumberInput({
  value,
  onChange,
  allowDecimal = true,
  allowNegative = false,
  className,
  ...rest
}: Props) {
  const ref = useRef<HTMLInputElement>(null)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const caret = input.selectionStart ?? input.value.length
    const digits = digitsBefore(input.value, caret)

    const parsed = parseNumeric(input.value, allowDecimal, allowNegative)
    onChange(parsed)

    // 콤마가 새로 끼거나 빠지면 커서가 밀린다. 같은 숫자 뒤로 되돌려놓는다.
    const formatted = formatNumeric(parsed)
    requestAnimationFrame(() => {
      const node = ref.current
      if (!node || document.activeElement !== node) return
      const position = caretAfterDigits(formatted, digits)
      node.setSelectionRange(position, position)
    })
  }

  return (
    <input
      {...rest}
      ref={ref}
      className={className ? `num-input ${className}` : 'num-input'}
      type="text"
      // 모바일에서 숫자 키패드가 뜨게 한다 (type=number 없이도)
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={formatNumeric(value)}
      onChange={handleChange}
    />
  )
}
