import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { ErrorNotice } from './ErrorNotice'

const LONG_DETAIL =
  'VOO 시세를 받지 못했습니다 — yahoo: 3회 시도 모두 실패 — ConnectionError: CONNECT tunnel failed, ' +
  'response 403 | stooq: HTTP 403'

describe('오류 표시', () => {
  it('오류가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<ErrorNotice error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('사용자가 할 일(hint)을 앞세우고 기술적 원인은 접어둔다', () => {
    render(
      <ErrorNotice
        error={new ApiError(502, '백신·방화벽이 막고 있는지 확인해주세요.', LONG_DETAIL)}
      />,
    )

    expect(screen.getByText('백신·방화벽이 막고 있는지 확인해주세요.')).toBeInTheDocument()
    // 긴 원인 문자열은 펼쳐야 보인다
    expect(screen.getByText('기술적 원인 보기')).toBeInTheDocument()
    expect(screen.getByText(LONG_DETAIL)).toBeInTheDocument()
  })

  it('안내가 없으면 기술적 원인을 그대로 앞에 보여준다', () => {
    render(<ErrorNotice error={new ApiError(409, null, 'VOO already exists')} />)

    expect(screen.getByText('VOO already exists')).toBeInTheDocument()
    // 접어둘 내용이 따로 없다
    expect(screen.queryByText('기술적 원인 보기')).not.toBeInTheDocument()
  })

  it('API 오류가 아닌 것도 표시한다', () => {
    render(<ErrorNotice error={new TypeError('Failed to fetch')} />)
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument()
  })

  it('닫기를 누르면 알린다', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<ErrorNotice error={new ApiError(500, null, '오류')} onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: '오류 메시지 닫기' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('닫기 콜백이 없으면 버튼을 그리지 않는다', () => {
    render(<ErrorNotice error={new ApiError(500, null, '오류')} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
