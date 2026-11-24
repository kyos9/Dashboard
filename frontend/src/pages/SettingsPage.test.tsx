/**
 * 설정 탭의 "만든 것들" — 글꼴(OFL)과 토스페이스는 저작권 표시와 라이선스 전문을 같이 실어야 한다.
 * (토스페이스 라이선스: 재배포할 때 저작권 표시 · 라이선스를 포함, 고친 판은 허락 없이 내지 않는다 — 원본 그대로)
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forgetPhone, pretendMidWidth } from '../test/phone'
import { api } from '../api/client'
import { SettingsPage } from './SettingsPage'

afterEach(() => forgetPhone())

// 설정 탭의 예전 목록 + 창 배치를 본다 — PC 설정(왼쪽 메뉴 + 오른쪽 내용)은 SettingsPage.pc.test
beforeEach(() => {
  pretendMidWidth()
  vi.restoreAllMocks()
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.47.0' })
})

it('만든 것들을 펼치면 글꼴 · 토스페이스의 저작권과 라이선스 전문 링크', async () => {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByText('만든 이와 글꼴'))
  const credits = document.querySelector('.settings-credits') as HTMLElement
  expect(credits).toHaveTextContent('© Viva Republica')
  const links = within(credits).getAllByRole('link', { name: '전문' }).map((a) => a.getAttribute('href'))
  expect(links).toEqual(['/licenses/pretendard.txt', '/licenses/spoqa-han-sans-neo.txt', '/licenses/tossface.txt'])
  // 설정 줄의 그림은 토스페이스 원본 SVG — 글자가 아니라 그림이라 화면 읽기에는 빈 이름
  expect(document.querySelectorAll('img.settings-face[alt=""]').length).toBeGreaterThan(0)
})

it('PC 는 한 장 + 왼쪽 목차 — 창 없이 모두 펼치고, 목차를 누르면 그 자리로 (디자인 5차 목업 08b 나)', async () => {
  forgetPhone()
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
  const toc = screen.getByRole('navigation', { name: '설정 목차' })
  expect(screen.getByRole('region', { name: '화면' })).toHaveTextContent('테마')
  const credits = screen.getByRole('region', { name: '정보' })
  const links = within(credits).getAllByRole('link', { name: '전문' }).map((a) => a.getAttribute('href'))
  expect(links).toEqual(['/licenses/pretendard.txt', '/licenses/spoqa-han-sans-neo.txt', '/licenses/tossface.txt'])
  await userEvent.click(within(toc).getByRole('button', { name: '정보' }))
  expect(within(toc).getByRole('button', { name: '정보' })).toHaveAttribute('aria-current', 'true')
  await userEvent.click(within(screen.getByRole('region', { name: '화면' })).getByRole('button', { name: '어둡게' }))
  expect(within(screen.getByRole('region', { name: '화면' })).getByRole('button', { name: '어둡게' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('dialog')).toBeNull()
})
