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

  it('표를 알아본다 — 머리·구분 줄·모자란 칸 (종목 분석의 지표 표, 9-8)', () => {
    const text = '## 2. 핵심 정량 지표\n| 지표 | 값 | 비교 |\n|---|:---:|---|\n| PER | **10.0배** | 5년 중앙값 수준 |\n| PBR | 확인 필요 |\n다음 문장'
    const blocks = parseAiText(text)
    expect(blocks[1]).toEqual({
      kind: 'table',
      head: ['지표', '값', '비교'],
      rows: [
        ['PER', '**10.0배**', '5년 중앙값 수준'],
        ['PBR', '확인 필요', ''],
      ],
    })
    expect(blocks[2]).toEqual({ kind: 'p', text: '다음 문장' })
    render(<AiText text={text} />)
    expect(screen.getByRole('columnheader', { name: '지표' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('10.0배').tagName).toBe('STRONG')
  })

  it('구분 줄이 없으면 표가 아니다 — 막대가 든 문장은 글자로 둔다', () => {
    expect(parseAiText('| 그냥 | 문장 |\n다음')).toEqual([
      { kind: 'p', text: '| 그냥 | 문장 |' },
      { kind: 'p', text: '다음' },
    ])
  })

  it('표 안의 HTML 도 글자로만 보인다', () => {
    const { container } = render(<AiText text={'| a | b |\n|--|--|\n| <img src=x onerror=1> | c |'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('td')?.textContent).toBe('<img src=x onerror=1>')
  })
})
