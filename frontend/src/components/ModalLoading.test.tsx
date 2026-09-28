import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModalLoading } from './ModalLoading'

describe('팝업 틀 (조각을 받는 동안)', () => {
  it('누르자마자 제목과 닫기 버튼이 있는 팝업이 뜬다', () => {
    render(<ModalLoading title="삼성전자" subtitle="005930.KS" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: '삼성전자' })
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('005930.KS')).toBeInTheDocument()
    expect(screen.getByText('여는 중…')).toBeInTheDocument()
  })

  it('받는 중에도 닫을 수 있다 — ✕ · Esc · 바깥', async () => {
    const onClose = vi.fn()
    const { container } = render(<ModalLoading title="VOO" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(container.querySelector('.modal-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('안쪽을 눌러도 닫히지 않는다', async () => {
    const onClose = vi.fn()
    render(<ModalLoading title="VOO" onClose={onClose} />)
    await userEvent.click(screen.getByText('여는 중…'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('작은 팝업(헤더 메뉴의 설정)은 차트 크기의 틀을 깔지 않는다 (8-5)', () => {
    const { container, rerender } = render(<ModalLoading title="VOO" onClose={() => {}} />)
    expect(container.querySelector('.chart-modal')).not.toBeNull()
    expect(container.querySelector('.skeleton-chart')).not.toBeNull()

    rerender(<ModalLoading plain title="화면 설정" onClose={() => {}} />)
    expect(container.querySelector('.chart-modal')).toBeNull()
    expect(container.querySelector('.skeleton-chart')).toBeNull()
    expect(screen.getByRole('dialog', { name: '화면 설정' })).toHaveAttribute('aria-busy', 'true')
  })
})
