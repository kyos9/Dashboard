import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, UNAUTHORIZED_EVENT } from './client'

interface FakeResponse {
  ok?: boolean
  status?: number
  statusText?: string
  /** 응답 본문 (Response.body와 타입이 달라 이름을 따로 둔다) */
  text?: string
}

function mockFetch({ text = '', ok, status = 200, statusText = 'OK' }: FakeResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: ok ?? status < 400,
      status,
      statusText,
      text: async () => text,
      json: async () => JSON.parse(text || '{}'),
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('오류 응답 해석', () => {
  it('백엔드의 hint/message를 나눠 담는다', async () => {
    // 이렇게 나뉘어야 화면에서 "할 일"을 앞세우고 기술적 원인은 접어둘 수 있다
    mockFetch({
      status: 502,
      statusText: 'Bad Gateway',
      text: JSON.stringify({
        detail: {
          hint: '네트워크에서 시세 서버로 나가지 못하고 있습니다.',
          message: 'VOO 시세를 받지 못했습니다 — yahoo: 403',
        },
      }),
    })

    const error = await api.getDashboard().catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(502)
    expect(error.hint).toBe('네트워크에서 시세 서버로 나가지 못하고 있습니다.')
    expect(error.detail).toContain('yahoo: 403')
    // message는 사용자에게 먼저 보일 문장이어야 한다
    expect(error.message).toBe('네트워크에서 시세 서버로 나가지 못하고 있습니다.')
  })

  it('detail이 문자열이면 그대로 기술적 원인으로 쓴다', async () => {
    mockFetch({
      status: 409,
      statusText: 'Conflict',
      text: JSON.stringify({ detail: 'VOO already exists' }),
    })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.hint).toBeNull()
    expect(error.detail).toBe('VOO already exists')
  })

  it('JSON이 아니면 본문을 그대로 보여준다', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Internal Server Error', text: '<html>500</html>' })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.detail).toBe('<html>500</html>')
  })

  it('본문이 비어도 상태코드로 말이 되는 메시지를 만든다', async () => {
    mockFetch({ ok: false, status: 504, statusText: 'Gateway Timeout', text: '' })

    const error = await api.getDashboard().catch((e) => e)
    expect(error.detail).toBe('504 Gateway Timeout')
  })
})

describe('요청 경로', () => {
  it('종목 검색어를 URL 인코딩한다 (한글·공백이 깨지지 않게)', async () => {
    mockFetch({ text: '[]' })
    await api.searchSymbols('삼성 전자')

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain(encodeURIComponent('삼성 전자'))
    expect(url).toContain('/api/symbols/search')
  })

  it('204 응답은 본문을 파싱하지 않는다', async () => {
    mockFetch({ status: 204, text: '' })
    await expect(api.refreshStock('VOO')).resolves.toBeUndefined()
  })
})

describe('세션이 끊겼을 때', () => {
  it('401이 오면 로그인 화면이 들을 수 있게 알린다', async () => {
    mockFetch({ status: 401, text: JSON.stringify({ detail: { hint: '로그인이 필요합니다.' } }) })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)

    await expect(api.getDashboard()).rejects.toBeInstanceOf(ApiError)
    expect(heard).toHaveBeenCalled()

    window.removeEventListener(UNAUTHORIZED_EVENT, heard)
  })

  it('로그인 실패의 401은 알리지 않는다 — 로그인 화면이 직접 다룬다', async () => {
    mockFetch({ status: 401, text: JSON.stringify({ detail: { hint: '비밀번호가 틀렸습니다.' } }) })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)

    await expect(api.login('틀린값')).rejects.toBeInstanceOf(ApiError)
    expect(heard).not.toHaveBeenCalled()

    window.removeEventListener(UNAUTHORIZED_EVENT, heard)
  })
})

describe('보유수량 저장', () => {
  it('평단가를 안 넘기면 보내지 않는다 — 서버는 보낸 칸만 바꾼다', async () => {
    mockFetch({ text: '{}' })
    await api.updateHolding('VOO', 3)
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ quantity: 3 })
  })

  it('null을 넘기면 "모름"으로 지우라고 보낸다', async () => {
    mockFetch({ text: '{}' })
    await api.updateHolding('VOO', 3, null)
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ quantity: 3, avg_cost: null })
  })
})
