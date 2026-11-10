import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusTrap } from './focusTrap'

function Dialog({ children, label = '창' }: { children: React.ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      {children}
    </div>
  )
}

describe('useFocusTrap', () => {
  it('닫힌 <details> 안의 단추는 건너뛴다 — summary 가 마지막이면 Tab 이 첫 칸으로 돈다, 밖으로 새지 않는다 (세 번째 재검토 참고 1)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button>뒤 화면</button>
        <Dialog>
          <button>첫 칸</button>
          <details>
            <summary>보내는 내용 보기</summary>
            <button>안쪽 단추</button>
          </details>
        </Dialog>
      </>,
    )
    screen.getByText('보내는 내용 보기').focus()
    await user.tab()
    expect(screen.getByRole('button', { name: '첫 칸' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByText('보내는 내용 보기')).toHaveFocus()
  })

  it('포커스가 내 밖의 다른 창 안이면 손대지 않는다 — 두 가두기가 서로 끌어와 한 단추에 묶이지 않게 (세 번째 재검토 조건 1)', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Dialog label="수정">
          <input aria-label="칸" />
        </Dialog>
        <Dialog label="닫을까요">
          <button>버리고 닫기</button>
          <button>계속 고치기</button>
        </Dialog>
      </>,
    )
    screen.getByRole('button', { name: '계속 고치기' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: '버리고 닫기' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '계속 고치기' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: '버리고 닫기' })).toHaveFocus()
  })
})
