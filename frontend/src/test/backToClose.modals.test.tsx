/**
 * 팝업마다 뒤로가기가 닫기로 이어져 있는지 — 하나라도 빠지면 그 팝업에서는 뒤로가기가 탭을 넘긴다.
 * 훅 자체의 규칙은 `lib/backToClose.test.tsx` 에서 본다.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('lightweight-charts', () => {
  const series = { setData: vi.fn(), applyOptions: vi.fn() }
  const chart = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: () => ({ fitContent: vi.fn() }),
    priceScale: () => ({ applyOptions: vi.fn() }),
  }
  return {
    createChart: vi.fn(() => chart),
    createSeriesMarkers: () => ({ setMarkers: vi.fn() }),
    LineSeries: 'Line',
    AreaSeries: 'Area',
    PriceScaleMode: { Logarithmic: 1, Normal: 0 },
    LineStyle: { Dashed: 2, Dotted: 1, Solid: 0 },
  }
})

import { api } from '../api/client'
import { ChartModal } from '../components/ChartModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DiagnosticsModal } from '../components/DiagnosticsModal'
import { InstallButton } from '../components/InstallButton'
import { MacroChartModal } from '../components/MacroChartModal'
import { PushModal } from '../components/PushModal'
import { UsersModal } from '../components/UsersModal'
import { resetBackToClose } from '../lib/backToClose'

const never = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.restoreAllMocks()
  resetBackToClose()
  window.history.replaceState(null, '', '/')
  vi.spyOn(api, 'getHistory').mockImplementation(never)
  vi.spyOn(api, 'getMacroHistory').mockImplementation(never)
  vi.spyOn(api, 'getLogs').mockImplementation(never)
  vi.spyOn(api, 'listUsers').mockImplementation(never)
  vi.spyOn(api, 'getPushSettings').mockImplementation(never)
})

afterEach(async () => {
  cleanup()
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
})

async function back() {
  await act(async () => {
    window.history.back()
    await new Promise((r) => setTimeout(r, 30))
  })
}

it.each([
  ['차트', (close: () => void) => <ChartModal ticker="VOO" onClose={close} />],
  ['매크로 차트', (close: () => void) => <MacroChartModal code="DGS10" name="미국 10년물" onClose={close} />],
  ['진단', (close: () => void) => <DiagnosticsModal onClose={close} />],
  ['사용자', (close: () => void) => <UsersModal onClose={close} onChanged={() => {}} />],
  ['알림', (close: () => void) => <PushModal account="me@example.com" onClose={close} />],
  [
    '확인 창',
    (close: () => void) => (
      <ConfirmDialog title="삭제할까요?" confirmLabel="삭제" onConfirm={() => {}} onCancel={close}>
        <p>되돌릴 수 없습니다.</p>
      </ConfirmDialog>
    ),
  ],
])('%s 팝업은 뒤로가기로 닫힌다', async (_, popup) => {
  const onClose = vi.fn()
  render(popup(onClose))
  await back()
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('아이폰 설치 안내도 뒤로가기로 닫힌다', async () => {
  const real = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari',
    configurable: true,
  })
  try {
    render(<InstallButton />)
    await userEvent.click(screen.getByRole('button', { name: '앱 설치' }))
    expect(screen.getByRole('dialog', { name: '홈 화면에 추가하는 방법' })).toBeInTheDocument()
    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '앱 설치' })).toBeInTheDocument()
  } finally {
    if (real) Object.defineProperty(window.navigator, 'userAgent', real)
    else Reflect.deleteProperty(window.navigator, 'userAgent')
  }
})
