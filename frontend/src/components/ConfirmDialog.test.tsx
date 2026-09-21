import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog
      title="VOO 삭제"
      confirmLabel="네, 완전히 지웁니다"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      <p>되돌릴 수 없습니다.</p>
    </ConfirmDialog>,
  )
  return { onConfirm, onCancel }
}

describe('되돌릴 수 없는 동작 확인', () => {
  it('화면 위에 떠서 지금 대답할 것을 하나만 남긴다', () => {
    renderDialog()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('VOO 삭제')
  })

  it('처음 손이 가는 곳은 취소다 — Enter 한 번에 지워지면 안 된다', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus()
  })

  it('확인을 누르면 그때 실행한다', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()

    await user.click(screen.getByRole('button', { name: '네, 완전히 지웁니다' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ESC와 바깥 클릭으로 닫힌다', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderDialog()

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)

    await user.click(document.querySelector('.modal-backdrop') as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('처리 중에는 두 번 눌리지 않고, 실수로 닫히지도 않는다', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog({ busy: true, busyLabel: '지우는 중…' })

    expect(screen.getByRole('button', { name: '지우는 중…' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('닫히면 뒤 화면 스크롤을 돌려준다', () => {
    const { unmount } = render(
      <ConfirmDialog title="t" confirmLabel="지우기" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>본문</p>
      </ConfirmDialog>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
