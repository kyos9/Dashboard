/**
 * 산 환율 칸의 단위 (ROADMAP 8-3).
 *
 * 엔은 1엔이 몇 원이라고 쓰지 않는다 — 은행·증권사 화면이 모두 "100엔당"이다. 칸은 사람이 보는
 * 단위(원/100엔)로 받고, 서버에는 1엔 값으로 보낸다. 서버는 자릿수가 틀린 값(100엔 값을 그대로
 * 보낸 910)을 거절한다.
 */
import type { Currency } from '../types'
import { CURRENCY_META } from './display'

const FX_SCALE: Partial<Record<Currency, number>> = { USD: 1, JPY: 100 }

export function fxUnitLabel(currency: Currency): string {
  return currency === 'JPY' ? '원/100엔' : `원/${CURRENCY_META[currency].symbol}`
}

/** 서버 값(1단위에 몇 원) → 칸에 보일 글자. 소수 끝자리 잡음은 뗀다 */
export function fxToInput(value: number | null | undefined, currency: Currency): string {
  const scale = FX_SCALE[currency]
  if (!scale || value === null || value === undefined) return ''
  return String(Number((value * scale).toFixed(4)))
}

/** 칸의 글자 → 서버 값. 비우면 null(모름). 원화 종목에는 없다 */
export function fxFromInput(input: string, currency: Currency): number | null {
  const scale = FX_SCALE[currency]
  if (!scale || input.trim() === '') return null
  return Number(input) / scale
}
