import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatNumeric, NumberInput, parseNumeric } from './NumberInput'

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
})
