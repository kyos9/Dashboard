import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseAiText } from '../lib/aiText'
import { AiText } from './AiText'

describe('AI 글 표시', () => {
  it('제목·글머리·번호·굵게를 알아본다', () => {
    const { container } = render(
      <AiText text={'## 한눈에 보기\n- **PER** 은 10배\n- 둘째\n\n1. 확인 하나\n2. 확인 둘\n그냥 문장'} />,
    )
    expect(screen.getByRole('heading', { name: '한눈에 보기' })).toBeInTheDocument()
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(screen.getByText('PER').tagName).toBe('STRONG')
    expect(screen.getByText('그냥 문장').closest('p')).not.toBeNull()
  })

  it('HTML 은 글자로만 보인다', () => {
    const { container } = render(<AiText text={'<img src=x onerror="alert(1)"> <b>굵게?</b>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<img src=x')
  })

  it('짝이 안 맞는 별표는 그대로 둔다', () => {
    expect(parseAiText('**반쪽')).toEqual([{ kind: 'p', text: '**반쪽' }])
    const { container } = render(<AiText text={'**반쪽'} />)
    expect(container.querySelector('strong')).toBeNull()
  })
})
