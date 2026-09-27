/** 종목 검색이 무엇으로 되고 있는지, 목록을 다시 받은 결과를 화면 글자로 (종목 관리 화면). */
import type { ListingRefreshResult, ListingStatus } from '../types'

/** 지금 무엇으로 검색되고 있는지 한 줄로. 목록이 언제 기준인지 모르면
 *  "검색이 안 된다"의 원인을 사용자가 짐작할 수 없다. 국내와 미국은 따로 받으므로 따로 말한다.
 *  "누르세요"는 버튼이 보이는 사람(관리자)에게만 — 없는 버튼을 가리키면 고장으로 읽힌다. */
export function listingHint(listing: ListingStatus | null, canRefresh = true): string {
  if (!listing) {
    return canRefresh ? '신규 상장이나 사명이 바뀐 종목이 검색되지 않을 때 누르세요.' : ''
  }
  const n = (v: number) => v.toLocaleString('ko-KR')
  const day = (at: string | null | undefined) => (at ? at.slice(0, 10) : '최근')

  const kr =
    listing.cached_count > 0
      ? `국내는 거래소 목록 ${n(listing.cached_count)}종목(${day(listing.updated_at)} 받음)으로 찾습니다.`
      : `국내는 아직 거래소 목록을 받지 못해 내장 목록 ${n(listing.seed_count)}종목(${listing.seed_as_of} 기준)으로만 찾습니다 — 중소형주는 목록이 있어야 나옵니다.`

  const usCount = listing.us_count ?? 0
  let us = ''
  if (usCount > 0) {
    us = `미국은 상장목록 ${n(usCount)}종목(${day(listing.us_updated_at)} 받음)으로 찾습니다.`
    // SEC 목록에는 회사만 있다 — ETF 가 안 나오는 이유를 여기서 말해둔다
    if (listing.us_source === 'sec') us += ' ETF는 주요 종목과 티커로 찾습니다.'
  } else if (listing.us_seed_count !== undefined) {
    us = `미국은 주요 종목 ${n(listing.us_seed_count)}개와 티커로 찾습니다.`
  }

  const tail = canRefresh ? '새로 상장된 종목이 안 나오면 누르세요.' : ''
  return [kr, us, tail].filter(Boolean).join(' ')
}

/** 목록을 다시 받은 결과를 한 줄로 — 국내와 미국은 따로 성공·실패한다 */
export function listingRefreshNotice(result: ListingRefreshResult): {
  tone: 'green' | 'amber'
  text: string
  detail?: string
} {
  const n = (v: number) => v.toLocaleString('ko-KR')
  const us = result.us
  if (result.ok && (!us || us.ok)) {
    const got = us ? `국내 ${n(result.count)}종목 · 미국 ${n(us.count)}종목을` : `국내 상장목록 ${n(result.count)}종목을`
    return { tone: 'green', text: `${got} 받았습니다. 신규 상장·사명 변경이 검색에 반영됩니다.` }
  }
  const parts: string[] = []
  const details: string[] = []
  if (result.ok) {
    parts.push(`국내 상장목록 ${n(result.count)}종목은 받았습니다.`)
  } else {
    parts.push(result.hint ?? '국내 상장목록을 받지 못했습니다.')
    if (result.error) details.push(`국내: ${result.error}`)
  }
  if (us?.ok) {
    parts.push(`미국 상장목록 ${n(us.count)}종목은 받았습니다.`)
  } else if (us) {
    parts.push('미국 상장목록은 받지 못했습니다 — 미국 종목은 주요 종목과 티커로 찾습니다.')
    if (us.error) details.push(`미국: ${us.error}`)
  }
  return { tone: 'amber', text: parts.join(' '), detail: details.join('\n') || undefined }
}
