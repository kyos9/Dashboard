import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatNumeric, NumberInput, parseNumeric } from './NumberInput'
import { droppedKinds, droppedText } from '../lib/numberDropped'

describe('천 단위 표기', () => {
  it('세 자리마다 콤마를 넣는다', () => {
    expect(formatNumeric('1000000')).toBe('1,000,000')
    expect(formatNumeric('100')).toBe('100')
    expect(formatNumeric('1234')).toBe('1,234')
  })

  it('소수부에는 콤마를 넣지 않는다', () => {
    expect(formatNumeric('1234.5678')).toBe('1,234.5678')
  })

  it('소수점만 찍은 중간 상태도 그대로 둔다', () => {
    // "1000."에서 점이 사라지면 그 뒤를 이어서 칠 수 없다
    expect(formatNumeric('1000.')).toBe('1,000.')
  })

  it('빈 값은 빈 값으로', () => {
    expect(formatNumeric('')).toBe('')
  })
})

describe('입력값 해석', () => {
  it('콤마와 단위를 걷어낸다 (붙여넣기 대비)', () => {
    expect(parseNumeric('1,234,567원', true)).toBe('1234567')
    expect(parseNumeric('  5.5 %', true)).toBe('5.5')
  })

  it('소수점은 하나만 남긴다', () => {
    expect(parseNumeric('1.2.3', true)).toBe('1.23')
  })

  it('소수를 허용하지 않으면 점을 버린다', () => {
    expect(parseNumeric('1.234', false)).toBe('1234')
  })

  it('음수는 받지 않는다', () => {
    // 금액·수량·비중 어디에도 음수가 들어갈 일이 없다
    expect(parseNumeric('-500', true)).toBe('500')
  })
})

describe('숫자 입력칸', () => {
  function Harness({ allowDecimal = true }: { allowDecimal?: boolean }) {
    return <NumberInput value="" onChange={() => {}} allowDecimal={allowDecimal} aria-label="금액" />
  }

  it('위아래 화살표가 붙는 number 타입을 쓰지 않는다', () => {
    render(<Harness />)
    const input = screen.getByLabelText('금액')
    expect(input).toHaveAttribute('type', 'text')
    // 모바일에서는 숫자 키패드가 떠야 한다
    expect(input).toHaveAttribute('inputmode', 'decimal')
  })

  it('정수만 받는 칸은 숫자 키패드를 쓴다', () => {
    render(<Harness allowDecimal={false} />)
    expect(screen.getByLabelText('금액')).toHaveAttribute('inputmode', 'numeric')
  })

  it('치는 대로 콤마가 붙고, 바깥에는 숫자만 넘어간다', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    function Controlled() {
      const [value, setValue] = useState('')
      return (
        <NumberInput
          value={value}
          onChange={(v) => {
            setValue(v)
            onChange(v)
          }}
          aria-label="금액"
        />
      )
    }

    render(<Controlled />)
    const input = screen.getByLabelText('금액')
    await user.type(input, '1000000')

    expect(input).toHaveValue('1,000,000')
    // 부모가 Number()로 바로 쓸 수 있어야 한다 — 콤마가 섞이면 1이 된다
    expect(onChange).toHaveBeenLastCalledWith('1000000')
    expect(Number(onChange.mock.lastCall![0])).toBe(1_000_000)
  })

  it('붙여넣은 값에서도 숫자만 남긴다', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<NumberInput value="" onChange={onChange} aria-label="금액" />)

    await user.click(screen.getByLabelText('금액'))
    await user.paste('1,234,567원')

    expect(onChange).toHaveBeenLastCalledWith('1234567')
  })
})

describe('음수', () => {
  it('기본으로는 빼기표를 버린다 — 금액·수량·비중에 음수가 들어갈 일이 없다', () => {
    expect(parseNumeric('-1234', true)).toBe('1234')
  })

  it('허락하면 앞의 빼기표 하나를 남긴다', () => {
    expect(parseNumeric('-0.2', true, true)).toBe('-0.2')
    // 빼기표만 친 중간 상태도 살려야 계속 칠 수 있다
    expect(parseNumeric('-', true, true)).toBe('-')
    // 가운데 낀 것은 빼기표가 아니다
    expect(parseNumeric('1-2', true, true)).toBe('12')
  })

  it('빼기표가 콤마 자리를 어지럽히지 않는다', () => {
    expect(formatNumeric('-1234')).toBe('-1,234')
    expect(formatNumeric('-')).toBe('-')
  })

  it('허락한 칸에서는 마이너스를 칠 수 있다', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    function Controlled() {
      const [value, setValue] = useState('')
      return (
        <NumberInput
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
          allowNegative
          aria-label="예상치"
        />
      )
    }

    render(<Controlled />)
    await user.type(screen.getByLabelText('예상치'), '-0.2')

    // 조용히 버리면 −0.2 를 넣었는데 0.2 가 저장된다 — 거절이 아니라 다른 숫자가 된다
    expect(onChange).toHaveBeenLastCalledWith('-0.2')
    expect(Number(onChange.mock.lastCall![0])).toBe(-0.2)
  })

  it('빼기표를 친 뒤 커서가 그 앞으로 밀리지 않는다', async () => {
    const user = userEvent.setup()

    function Controlled() {
      const [value, setValue] = useState('')
      return <NumberInput value={value} onChange={setValue} allowNegative aria-label="예상치" />
    }

    render(<Controlled />)
    const input = screen.getByLabelText('예상치') as HTMLInputElement

    await user.type(input, '-')
    // 커서 복원은 다음 그림 때 돈다. 사람이 치는 속도에서는 글자 사이에 항상 한 번 들어간다.
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    // 0이면 커서가 빼기표 **앞**이라는 뜻이고, 그러면 다음 글자가 "0-" 을 만든다.
    // 그건 음수로 안 읽혀 빼기표가 조용히 사라진다 (브라우저에서 −0.2 -> 0.2).
    expect(input.selectionStart).toBe(1)
  })
})

describe('버린 것을 말하기 (0.45.1 A)', () => {
  it('값이 달라지게 버린 것만 고른다', () => {
    expect(droppedKinds('', true)).toEqual([])
    expect(droppedKinds('-3', true)).toEqual(['minus'])
    expect(droppedKinds('−3', true)).toEqual(['minus'])
    expect(droppedKinds('7.5', false)).toEqual(['decimal'])
    expect(droppedKinds('7.5', true)).toEqual([])
    // 소수 칸의 두 번째 소수점은 오타 — 지금처럼 말없이
    expect(droppedKinds('1.2.3', true)).toEqual([])
    // 붙여넣기 대비로 버리는 글자는 말하지 않는다
    expect(droppedKinds('1,234원', false)).toEqual([])
    expect(droppedKinds(' 5.5 %', true)).toEqual([])
    expect(droppedKinds('100만', false)).toEqual(['unit'])
    expect(droppedKinds('1.5억', false)).toEqual(['decimal', 'unit'])
    expect(droppedKinds('-1,234.5', false)).toEqual(['minus', 'decimal'])
  })

  it('음수 칸은 맨 앞이 아닌 빼기만 말한다', () => {
    expect(droppedKinds('-0.2', true, true)).toEqual([])
    expect(droppedKinds('−0.2', true, true)).toEqual([])
    expect(droppedKinds('-', true, true)).toEqual([])
    expect(droppedKinds('0.2-', true, true)).toEqual(['minus'])
    expect(droppedKinds('1-2', true, true)).toEqual(['minus'])
  })

  it('음수 칸에서 붙여넣은 −(U+2212)를 빼기로 읽는다 — 버리면 −0.2 가 0.2 로 저장됐다', () => {
    expect(parseNumeric('−0.2', true, true)).toBe('-0.2')
    // 음수를 받지 않는 칸은 지금처럼 버린다(그리고 말한다)
    expect(parseNumeric('−3', true)).toBe('3')
  })

  it('줄에는 칸 이름·버린 것·지금 값이 있다', () => {
    expect(droppedText('VOO 밴드 임계값', ['minus'], '3')).toBe('VOO 밴드 임계값 — 빼기(−)는 넣을 수 없습니다 · 지금 값 3')
    expect(droppedText(undefined, ['decimal'], '75')).toBe('소수점은 넣을 수 없어 숫자만 이어 붙였습니다 · 지금 값 75')
    expect(droppedText('금액', ['unit'], '1,000,000')).toContain('지금 값 1,000,000')
    expect(droppedText('금액', ['minus'], '')).toContain('지금 값 없음')
  })

  function Controlled(props: { allowDecimal?: boolean; allowNegative?: boolean; label?: string; onChange?: (v: string) => void }) {
    const [value, setValue] = useState('')
    return (
      <>
        <NumberInput
          value={value}
          onChange={(v) => {
            setValue(v)
            props.onChange?.(v)
          }}
          allowDecimal={props.allowDecimal}
          allowNegative={props.allowNegative}
          aria-label={props.label ?? '기간'}
        />
        <button>다른 곳</button>
      </>
    )
  }

  it('한 글자씩 "7.5" 를 치면 마지막 글자 뒤에도 줄이 남아 지금 값 75 를 말한다', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Controlled allowDecimal={false} onChange={onChange} />)

    await user.type(screen.getByLabelText('기간'), '7.5')

    // 값은 지금과 같다 — 막지 않고 알린다
    expect(onChange).toHaveBeenLastCalledWith('75')
    expect(screen.getByRole('status')).toHaveTextContent('기간 — 소수점은 넣을 수 없어 숫자만 이어 붙였습니다 · 지금 값 75')
  })

  it('칸을 떠나면 줄이 사라진다', async () => {
    const user = userEvent.setup()
    render(<Controlled label="밴드" />)

    await user.type(screen.getByLabelText('밴드'), '-3')
    expect(screen.getByRole('status')).toHaveTextContent('밴드 — 빼기(−)는 넣을 수 없습니다 · 지금 값 3')

    await user.click(screen.getByRole('button', { name: '다른 곳' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('받는 글자만 치면 줄이 없다', async () => {
    const user = userEvent.setup()
    render(<Controlled allowNegative label="예상치" />)

    await user.type(screen.getByLabelText('예상치'), '-0.2')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('label 로 이름을 단 칸은 그 이름을 쓴다', async () => {
    const user = userEvent.setup()
    render(
      <>
        <label htmlFor="n">N거래일</label>
        <NumberInput id="n" value="" onChange={() => {}} allowDecimal={false} />
      </>,
    )
    await user.type(screen.getByLabelText('N거래일'), '.')
    expect(screen.getByRole('status')).toHaveTextContent(/^N거래일 — 소수점/)
  })

  it('부모가 준 onBlur 도 그대로 불린다', async () => {
    const onBlur = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <NumberInput value="" onChange={() => {}} onBlur={onBlur} aria-label="금액" />
        <button>다른 곳</button>
      </>,
    )
    await user.click(screen.getByLabelText('금액'))
    await user.click(screen.getByRole('button'))
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})
