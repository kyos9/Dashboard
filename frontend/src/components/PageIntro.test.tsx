import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PageIntro } from './PageIntro'

const details = () => document.querySelector('details.page-intro') as HTMLDetailsElement

describe('화면 안내 — 한 줄 + 자세히', () => {
  it('매일 여는 사람에게는 한 줄만, 누르면 나머지가 펼쳐진다', async () => {
    render(
      <PageIntro line="한 줄 요약" firstVisit={false}>
        나머지 설명
      </PageIntro>,
    )
    expect(screen.getByText('한 줄 요약')).toBeVisible()
    expect(details().open).toBe(false)
    await userEvent.click(screen.getByText('자세히'))
    expect(details().open).toBe(true)
    expect(screen.getByText('접기')).toBeInTheDocument()
  })

  it('처음 온 사람(종목 0개)에게는 펼쳐서 보여준다 — 데이터를 받은 뒤에 정한다', () => {
    const { rerender } = render(
      <PageIntro line="한 줄 요약" firstVisit={null}>
        나머지 설명
      </PageIntro>,
    )
    // 아직 모른다 — 펼쳤다 접는 깜빡임이 없게 접힌 채로 기다린다
    expect(details().open).toBe(false)
    rerender(
      <PageIntro line="한 줄 요약" firstVisit={true}>
        나머지 설명
      </PageIntro>,
    )
    expect(details().open).toBe(true)
  })

  it('한 번 정한 뒤로는 사람이 접은 대로 둔다 — 종목 수가 바뀌어도 다시 펼치지 않는다', async () => {
    const { rerender } = render(
      <PageIntro line="요약" firstVisit={true}>
        설명
      </PageIntro>,
    )
    await userEvent.click(screen.getByText('접기'))
    expect(details().open).toBe(false)
    // 화면이 기억하는 상태도 접힘이다 — 글자가 "자세히"로 바뀐다
    expect(await screen.findByText('자세히')).toBeInTheDocument()
    rerender(
      <PageIntro line="요약" firstVisit={false}>
        설명
      </PageIntro>,
    )
    rerender(
      <PageIntro line="요약" firstVisit={true}>
        설명
      </PageIntro>,
    )
    expect(details().open).toBe(false)
    expect(screen.getByText('자세히')).toBeInTheDocument()
  })
})
