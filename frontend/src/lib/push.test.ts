/**
 * 이 기기에서 알림 켜기·끄기·맞추기.
 *
 * 가장 중요한 것은 "기기는 켠 사람의 것" 규칙이다. 한 폰을 둘이 번갈아 쓸 때, 앞사람이 켠
 * 구독을 뒷사람의 화면이 자기 것으로 다시 보내면 뒷사람의 알림이 앞사람이 켠 기기로 간다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({
  api: {
    getPushKey: vi.fn(),
    addPushSubscription: vi.fn(),
    removePushSubscription: vi.fn(),
  },
}))

import { api } from '../api/client'
import {
  base64UrlToBytes,
  disablePush,
  enablePush,
  forgetPushDevice,
  pushAccount,
  pushState,
  pushSupport,
  syncPush,
} from './push'

const SERVER_KEY = 'BAECAw' // 바이트 4,1,2,3
const OTHER_KEY = new Uint8Array([9, 9, 9, 9]).buffer
const OWNER_KEY = 'signalboard.pushOwner'

interface FakeSub {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  unsubscribe: ReturnType<typeof vi.fn>
  toJSON: () => unknown
}

function fakeSub(endpoint = 'https://fcm.googleapis.com/fcm/send/dev', key: ArrayBuffer | null = null): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: key ?? base64UrlToBytes(SERVER_KEY).buffer },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  }
}

let current: FakeSub | null
let permission: NotificationPermission
const subscribe = vi.fn()
const requestPermission = vi.fn()
const register = vi.fn()
let registered: boolean

function install() {
  const reg = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe,
    },
  }
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => (registered ? reg : undefined)),
      register,
      ready: Promise.resolve(reg),
    },
  })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      get permission() {
        return permission
      },
      requestPermission,
    },
  })
}

beforeEach(() => {
  current = null
  permission = 'default'
  registered = true
  localStorage.clear()
  vi.mocked(api.getPushKey).mockResolvedValue({ public_key: SERVER_KEY })
  vi.mocked(api.addPushSubscription).mockResolvedValue({ ok: true })
  vi.mocked(api.removePushSubscription).mockResolvedValue(undefined)
  subscribe.mockImplementation(async () => (current = fakeSub('https://fcm.googleapis.com/fcm/send/new')))
  requestPermission.mockImplementation(async () => (permission = 'granted'))
  register.mockImplementation(async () => {
    registered = true
  })
  install()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('켤 수 있는 기기인가', () => {
  it('https 의 보통 브라우저는 된다', () => {
    expect(pushSupport()).toBe('ok')
  })

  it('https 가 아니면 — 집 안 주소로 들어온 경우', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    expect(pushSupport()).toBe('insecure')
  })

  it('푸시가 없는 브라우저', () => {
    Reflect.deleteProperty(window, 'PushManager')
    expect(pushSupport()).toBe('unsupported')
  })

  it('아이폰 사파리는 "지원 안 됨"이 아니라 "홈 화면에 추가하면 됨"이다', () => {
    const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    )
    Reflect.deleteProperty(window, 'PushManager') // 설치 전 사파리에는 아예 없다
    expect(pushSupport()).toBe('needs-install')
    ua.mockRestore()
  })
})

describe('켜기', () => {
  it('권한 → 서버 키로 구독 → 서버에 맡기고, 켠 사람을 적어둔다', async () => {
    await enablePush('me@example.com')

    expect(requestPermission).toHaveBeenCalled()
    const options = subscribe.mock.calls[0][0]
    expect(options.userVisibleOnly).toBe(true)
    expect([...options.applicationServerKey]).toEqual([4, 1, 2, 3])
    expect(api.addPushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      keys: { p256dh: 'P', auth: 'A' },
    })
    expect(localStorage.getItem(OWNER_KEY)).toBe('me@example.com')
    expect(await pushState('me@example.com')).toBe('on')
  })

  it('권한을 거절하면 구독하지 않고 이유를 말한다', async () => {
    requestPermission.mockImplementation(async () => (permission = 'denied'))
    await expect(enablePush('me')).rejects.toThrow('사이트 설정에서 알림을 허용')
    expect(subscribe).not.toHaveBeenCalled()
    expect(api.addPushSubscription).not.toHaveBeenCalled()
    expect(await pushState('me')).toBe('denied')
  })

  it('창을 그냥 닫으면(허용도 거절도 아님) 켜지 않는다', async () => {
    requestPermission.mockImplementation(async () => 'default')
    await expect(enablePush('me')).rejects.toThrow('허용을 누르지 않아')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('옛 서버 키로 만든 구독이 남아 있으면 거두고 새로 만든다', async () => {
    const stale = fakeSub('https://fcm.googleapis.com/fcm/send/old', OTHER_KEY)
    current = stale
    await enablePush('me')
    expect(stale.unsubscribe).toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('같은 키의 구독이 있으면 그대로 다시 맡긴다', async () => {
    current = fakeSub()
    await enablePush('me')
    expect(subscribe).not.toHaveBeenCalled()
    expect(api.addPushSubscription).toHaveBeenCalledTimes(1)
  })

  it('서비스 워커가 아직 안 붙었으면 붙이고 켠다', async () => {
    registered = false
    await enablePush('me')
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(api.addPushSubscription).toHaveBeenCalled()
  })

  it('브라우저가 등록을 거절하면(시크릿 창 등) 원문 대신 할 일을 말한다', async () => {
    subscribe.mockRejectedValue(new DOMException('Registration failed - permission denied', 'NotAllowedError'))
    await expect(enablePush('me')).rejects.toThrow(/시크릿 창이거나.*\(Registration failed - permission denied\)/)
    expect(api.addPushSubscription).not.toHaveBeenCalled()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })

  it('서버가 거절하면 켠 것으로 적지 않는다', async () => {
    vi.mocked(api.addPushSubscription).mockRejectedValue(new Error('지원하지 않는 알림 서버'))
    await expect(enablePush('me')).rejects.toThrow('지원하지 않는 알림 서버')
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })
})

describe('끄기', () => {
  it('서버에서 지우고 브라우저 구독도 거둔다', async () => {
    const sub = fakeSub()
    current = sub
    localStorage.setItem(OWNER_KEY, 'me')
    await disablePush()
    expect(api.removePushSubscription).toHaveBeenCalledWith(sub.endpoint)
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })

  it('서버에 이미 없어도(404) 브라우저 쪽은 거둔다', async () => {
    const sub = fakeSub()
    current = sub
    vi.mocked(api.removePushSubscription).mockRejectedValue(new Error('404'))
    await disablePush()
    expect(sub.unsubscribe).toHaveBeenCalled()
  })

  it('탈퇴 뒤에는 서버에 묻지 않고 브라우저 쪽만 거둔다', async () => {
    const sub = fakeSub()
    current = sub
    localStorage.setItem(OWNER_KEY, 'me')
    await forgetPushDevice()
    expect(api.removePushSubscription).not.toHaveBeenCalled()
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })
})

describe('화면이 열릴 때 맞추기', () => {
  beforeEach(() => {
    permission = 'granted'
  })

  it('내가 켠 기기면 같은 구독을 다시 보낸다 (서버를 되돌려도 다시 채워진다)', async () => {
    current = fakeSub()
    localStorage.setItem(OWNER_KEY, 'me')
    await syncPush('me')
    expect(api.addPushSubscription).toHaveBeenCalledTimes(1)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('서버 키가 바뀌었으면 새 키로 다시 구독한다', async () => {
    const stale = fakeSub('https://fcm.googleapis.com/fcm/send/old', OTHER_KEY)
    current = stale
    localStorage.setItem(OWNER_KEY, 'me')
    await syncPush('me')
    expect(stale.unsubscribe).toHaveBeenCalled()
    expect(api.addPushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }),
    )
  })

  it('다른 사람이 켠 기기면 내 것으로 가져오지 않고 거둔다', async () => {
    const theirs = fakeSub()
    current = theirs
    localStorage.setItem(OWNER_KEY, 'friend@example.com')
    await syncPush('me@example.com')
    expect(api.addPushSubscription).not.toHaveBeenCalled()
    expect(theirs.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem(OWNER_KEY)).toBeNull()
  })

  it('누가 켰는지 모르면(기록이 지워졌다) 건드리지 않는다', async () => {
    const sub = fakeSub()
    current = sub
    await syncPush('me')
    expect(api.addPushSubscription).not.toHaveBeenCalled()
    expect(sub.unsubscribe).not.toHaveBeenCalled()
  })

  it('알림 권한이 없거나 구독이 없으면 아무것도 안 한다', async () => {
    permission = 'default'
    current = fakeSub()
    localStorage.setItem(OWNER_KEY, 'me')
    await syncPush('me')
    permission = 'granted'
    current = null
    await syncPush('me')
    expect(api.getPushKey).not.toHaveBeenCalled()
    expect(api.addPushSubscription).not.toHaveBeenCalled()
  })

  it('서버가 안 잡혀도 넘어지지 않는다', async () => {
    current = fakeSub()
    localStorage.setItem(OWNER_KEY, 'me')
    vi.mocked(api.getPushKey).mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(syncPush('me')).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('상태', () => {
  it('구독이 있어도 내가 켠 게 아니면 "꺼짐"', async () => {
    current = fakeSub()
    localStorage.setItem(OWNER_KEY, 'friend')
    expect(await pushState('me')).toBe('off')
  })

  it('계정 없는 서버는 하나로 친다', () => {
    expect(pushAccount(null)).toBe('local')
    expect(pushAccount({ email: 'me@example.com' })).toBe('me@example.com')
  })

  it('base64url 을 바이트로', () => {
    expect([...base64UrlToBytes('_-8')]).toEqual([255, 239])
  })
})
