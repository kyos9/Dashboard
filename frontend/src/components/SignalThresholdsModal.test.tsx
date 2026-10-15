import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { LEGACY_SIGNAL_RULES, resetSignalRules } from '../lib/signalRules'
import type { SignalRules } from '../types'
import { SignalThresholdsModal } from './SignalThresholdsModal'

const DEFAULTS = { adx_trend: 20, vol_ratio_expand: 1.1, disparity_below: 0, lookback_days: 5 }
const LIMITS = {
  adx_trend: { min: 10, max: 40, step: 0.5 },
  vol_ratio_expand: { min: 0.5, max: 3, step: 0.05 },
  disparity_below: { min: -20, max: 0, step: 0.5 },
  lookback_days: { min: 1, max: 20, step: 1 },
}

function rules(custom: boolean): SignalRules {
  return {
    ...LEGACY_SIGNAL_RULES,
    thresholds: custom ? { ...DEFAULTS, adx_trend: 25, lookback_days: 3 } : DEFAULTS,
    defaults: DEFAULTS,
    custom,
    limits: LIMITS,
  }
}

function open(custom = false) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<SignalThresholdsModal rules={rules(custom)} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved, dialog: screen.getByRole('dialog', { name: '시그널 기준' }) }
}

async function setField(dialog: HTMLElement, label: string, value: string) {
  const input = within(dialog).getByLabelText(label)
  await userEvent.clear(input)
  if (value) await userEvent.type(input, value)
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetSignalRules()
})
afterEach(() => resetSignalRules())

describe('시그널 기준 팝업', () => {
  it('칸 넷에 지금 값과 기본값, 쓰이는 조건 풀이가 있다', () => {
    const { dialog } = open(true)
    expect(within(dialog).getByLabelText('ADX 기준')).toHaveValue('25')
    expect(within(dialog).getByLabelText('비교 기간')).toHaveValue('3')
    expect(within(dialog).getByText('기본 20 · 바꿈')).toBeInTheDocument()
    expect(within(dialog).getByText('기본 1.1배')).toBeInTheDocument()
    expect(within(dialog).getByText(/매수 '변동성 축소'와 매도 'ADX 상승' 두 조건에 같이/)).toBeInTheDocument()
    expect(within(dialog).getByText(/변동성이 줄었으면 거래량비와 상관없이 ✓/)).toBeInTheDocument()
    expect(within(dialog).getByText('내 기준을 쓰는 중')).toBeInTheDocument()
  })

  it.each([
    ['ADX 기준', '45', '10 ~ 40 사이로 넣어 주세요'],
    ['ADX 기준', '20.3', '0.5 단위로 넣어 주세요'],
    ['거래량비 기준', '1.12', '0.05 단위로 넣어 주세요'],
    ['이격도 기준', '2', '−20 ~ 0 사이로 넣어 주세요'],
    ['비교 기간', '0', '1 ~ 20 사이로 넣어 주세요'],
    ['비교 기간', '', '숫자를 넣어 주세요'],
  ])('%s 에 %s → "%s", 저장 못 함', async (label, value, message) => {
    const { dialog } = open()
    await setField(dialog, label, value)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(message)
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('아무것도 안 바꿨으면 "저장"이 꺼져 있고, 넣을 수 있는 범위는 틀리기 전에 보인다 (0.42.0 사용자 확인)', async () => {
    const { dialog } = open(true)
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled()
    expect(within(dialog).getByText('10 ~ 40')).toBeInTheDocument()
    expect(within(dialog).getByText('−20 ~ 0')).toBeInTheDocument()
    await setField(dialog, 'ADX 기준', '26')
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeEnabled()
  })

  it('저장·되돌리기 뒤 화면에 보일 한 줄을 넘긴다', async () => {
    vi.spyOn(api, 'putSignalThresholds').mockResolvedValue(rules(true))
    const { dialog, onSaved } = open()
    await setField(dialog, '비교 기간', '3')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(onSaved).toHaveBeenCalledWith('시그널 기준을 저장했습니다 — 내 기준으로 다시 그립니다')
  })

  it('이격도는 음수를 받는다', async () => {
    const put = vi.spyOn(api, 'putSignalThresholds').mockResolvedValue(rules(true))
    const { dialog, onSaved, onClose } = open()
    await setField(dialog, '이격도 기준', '-2.5')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(put).toHaveBeenCalledWith({ ...DEFAULTS, disparity_below: -2.5 })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('"기본값으로" — 내 기준을 쓰는 중이면 서버에서 지우고, 아직 기본이면 고치던 칸만 되돌린다', async () => {
    const reset = vi.spyOn(api, 'resetSignalThresholds').mockResolvedValue(rules(false))
    const first = open(true)
    await userEvent.click(within(first.dialog).getByRole('button', { name: '기본값으로' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(first.onSaved).toHaveBeenCalled()
  })

  it('아직 기본이면 "기본값으로"는 칸만 되돌리고 서버를 부르지 않는다', async () => {
    const reset = vi.spyOn(api, 'resetSignalThresholds')
    const { dialog } = open(false)
    expect(within(dialog).getByRole('button', { name: '기본값으로' })).toBeDisabled()
    await setField(dialog, 'ADX 기준', '30')
    await userEvent.click(within(dialog).getByRole('button', { name: '기본값으로' }))
    expect(within(dialog).getByLabelText('ADX 기준')).toHaveValue('20')
    expect(reset).not.toHaveBeenCalled()
  })

  it('저장이 실패하면 팝업을 닫지 않고 까닭을 보인다', async () => {
    vi.spyOn(api, 'putSignalThresholds').mockRejectedValue(new Error('adx_trend: 10 ~ 40 사이여야 합니다'))
    const { dialog, onClose } = open()
    await setField(dialog, 'ADX 기준', '25')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('adx_trend')
    expect(onClose).not.toHaveBeenCalled()
  })
})
