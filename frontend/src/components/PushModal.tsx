import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { useBackToClose } from '../lib/backToClose'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { KIND_TEXT, STATE_TEXT } from '../lib/pushText'
import { stockLabel } from '../lib/display'
import type { PushKind, PushSettings, PushSlot, Stock } from '../types'
import { ErrorNotice } from './ErrorNotice'
import { lockBodyScroll } from '../lib/scrollLock'

/**
 * 알림 설정 — 이 기기에서 켜고 끄기, 받을 종류, 시험 알림 (ROADMAP 6단계).
 *
 * **켜는 건 기기마다, 받을 종류는 사람마다다.** 폰에서 켜고 PC에서 안 켜면 폰에만 온다.
 * 종류는 어느 기기에서 고르든 같다.
 *
 * 0.45.0 — **받을 때**(아침·오후)와 **종목별 알림**. 알림이 실제로 가는 때는 둘뿐이라(미국 장 뒤 아침 7:30쯤, 일본·한국 장 뒤
 * 오후 4시쯤) 시각을 고르게 하지 않고 둘 중에서 고른다(주인 결정). 받지 않는 때 켜진 신호는 다음에 받는 때, 그때도 켜져
 * 있으면 온다. 옛 서버(칸 없음)면 두 칸을 그리지 않는다.
 */

const SLOT_TEXT: Record<PushSlot, { label: string; hint: string }> = {
  // 두 번 모두 **모든 종목**을 본다 — "미국 종목"이라 쓰면 아침을 끄면 미국 종목 알림이 끊기는 것으로 읽혔다(B 사용자 확인)
  morning: { label: '아침 (7:30쯤)', hint: '밤사이 미국 장 시세를 받은 뒤' },
  afternoon: { label: '오후 (4시쯤)', hint: '일본·한국 장 시세를 받은 뒤' },
}
const SLOTS: PushSlot[] = ['morning', 'afternoon']

/** 브라우저가 던진 오류는 "Error: …" 가 붙지 않게 문장만 보여준다. 서버 오류는 안내·원인을 그대로. */
function shown(e: unknown): unknown {
  if (e instanceof ApiError) return e
  if (e instanceof Error) return e.message
  return e
}

/** 이 기기의 상태와 내 알림 설정을 함께 읽는다. 기기 상태를 못 읽으면 "지원 안 됨"으로 본다. */
function load(account: string): Promise<[PushState, PushSettings]> {
  return Promise.all([pushState(account).catch(() => 'unsupported' as const), api.getPushSettings()])
}

export function PushModal({ account, onClose }: { account: string; onClose: () => void }) {
  const [state, setState] = useState<PushState | null>(null)
  const [settings, setSettings] = useState<PushSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stocks, setStocks] = useState<Stock[] | null>(null)
  const [hasAny, setHasAny] = useState(false)

  const reload = useCallback(async () => {
    const [nextState, nextSettings] = await load(account)
    setState(nextState)
    setSettings(nextSettings)
  }, [account])

  useEffect(() => {
    let cancelled = false
    load(account)
      .then(([nextState, nextSettings]) => {
        if (cancelled) return
        setState(nextState)
        setSettings(nextSettings)
      })
      .catch((e: unknown) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [account])

  // 종목별 알림의 목록 — 숨긴(비활성) 종목은 원래 알림이 없다
  useEffect(() => {
    let cancelled = false
    api
      .listStocks()
      .then((list) => {
        if (cancelled) return
        setStocks(list.filter((s) => s.active))
        // 비활성 종목만 담은 사람도 "종목을 담으면…"의 사람이 아니다(BCD 검토)
        setHasAny(list.length > 0)
      })
      // 못 받으면 null 그대로 — 0개로 두면 종목이 있는 사람에게 "종목을 담으면…"이 떴다(계획 검토)
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 폰의 뒤로가기로도 닫힌다
  useBackToClose(onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const release = lockBodyScroll()
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
    }
  }, [onClose])

  async function run(action: () => Promise<void>, done?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      if (done) setNotice(done)
    } catch (e) {
      setError(shown(e))
    } finally {
      await reload().catch(() => {})
      setBusy(false)
    }
  }

  /** 누르는 즉시 바꾸고 뒤에서 저장한다. 저장이 실패하면 되돌린다 — 체크가 서버를 기다리면 눌렀는데 안 눌린 것처럼 보인다. */
  async function toggleKind(kind: PushKind, on: boolean) {
    if (!settings) return
    const before = settings
    const kinds = on ? [...settings.kinds, kind] : settings.kinds.filter((k) => k !== kind)
    setSettings({ ...settings, kinds })
    setError(null)
    try {
      setSettings(await api.setPushKinds(kinds))
    } catch (e) {
      setSettings(before)
      setError(shown(e))
    }
  }

  /** 받을 때·끈 종목 — 종류와 같게, 누르는 즉시 바꾸고 실패하면 되돌린다 */
  async function savePrefs(prefs: { slots?: PushSlot[]; muted?: string[] }) {
    if (!settings) return
    const before = settings
    setSettings({ ...settings, ...prefs })
    setError(null)
    try {
      setSettings(await api.setPushPrefs(prefs))
    } catch (e) {
      setSettings(before)
      setError(shown(e))
    }
  }

  async function sendTest() {
    const result = await api.sendTestPush()
    if (result.sent === 0) throw new Error('알림 서버에 보내지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal push-modal"
        role="dialog"
        aria-modal="true"
        aria-label="알림"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">
            <h3>알림</h3>
            {settings && settings.devices > 0 && (
              <span className="hint">알림을 켜 둔 기기 {settings.devices}대</span>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <ErrorNotice error={error} onDismiss={() => setError(null)} />

        <section className="push-device">
          {state === null && <p className="hint">확인하는 중…</p>}
          {state === 'on' && (
            <>
              <p>
                <span className="badge badge-green">켜짐</span> 이 기기로 알림을 받습니다.
              </p>
              <div className="push-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run(sendTest, '시험 알림을 보냈습니다. 몇 초 안에 도착합니다.')}
                >
                  시험 알림 보내기
                </button>
                <button className="ghost" disabled={busy} onClick={() => void run(disablePush)}>
                  이 기기 알림 끄기
                </button>
              </div>
            </>
          )}
          {state === 'off' && (
            <>
              <p>
                <span className="badge badge-grey">꺼짐</span> 이 기기는 알림이 꺼져 있습니다.
              </p>
              <div className="push-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run(() => enablePush(account), '켰습니다. 시험 알림으로 확인해 보세요.')}
                >
                  {busy ? '켜는 중…' : '이 기기에서 알림 켜기'}
                </button>
              </div>
              <p className="hint">브라우저가 알림 허용을 물으면 "허용"을 눌러 주세요.</p>
            </>
          )}
          {state !== null && state !== 'on' && state !== 'off' && (
            <p className="push-blocked">{STATE_TEXT[state]}</p>
          )}
          {notice && <p className="push-notice">{notice}</p>}
        </section>

        {settings && (
          <section className="push-kinds">
            <h4>받을 알림</h4>
            {settings.available.map((kind) => (
              <label key={kind} className="push-kind">
                <input
                  type="checkbox"
                  checked={settings.kinds.includes(kind)}
                  onChange={(e) => void toggleKind(kind, e.target.checked)}
                />
                <span>
                  <b>{KIND_TEXT[kind].label}</b>
                  <span className="hint"> — {KIND_TEXT[kind].hint}</span>
                </span>
              </label>
            ))}
          </section>
        )}

        {settings?.slots && (
          <section className="push-kinds push-slots">
            <h4>받을 때</h4>
            {SLOTS.map((slot) => {
              const on = settings.slots!.includes(slot)
              // 둘 다 끄는 것은 알림을 끄는 것 — 마지막 하나는 끌 수 없다(위의 "이 기기 알림 끄기")
              const last = on && settings.slots!.length === 1
              return (
                <label key={slot} className="push-kind">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={last}
                    onChange={(e) =>
                      void savePrefs({
                        slots: e.target.checked ? [...settings.slots!, slot] : settings.slots!.filter((s) => s !== slot),
                      })
                    }
                  />
                  <span>
                    <b>{SLOT_TEXT[slot].label}</b>
                    <span className="hint"> — {SLOT_TEXT[slot].hint}</span>
                    {/* 눌리지 않는 까닭 — 없으면 고장으로 보였다(B 사용자 확인) */}
                    {last && <span className="hint"> (하나는 받아야 합니다)</span>}
                  </span>
                </label>
              )
            })}
            <p className="hint">
              끈 때 생긴 신호는 버리지 않고 다음에 받는 때 알려 드립니다(그때까지 켜져 있으면).
              {settings.available.includes('signup') && ' 가입 신청 알림은 바로 갑니다.'}
            </p>
          </section>
        )}

        {settings?.muted && stocks && stocks.length > 0 && (
          <details className="push-kinds push-stocks">
            <summary>
              <b>종목별 알림</b>
              <span className="hint">
                {' '}
                {/* 보이는 목록의 것만 센다 — 숨긴 종목을 끈 채로 두면 "1종목 끔"인데 목록에 꺼진 줄이 없었다(B 검토) */}
                — {(() => {
                  const off = stocks.filter((s) => settings.muted!.includes(s.ticker)).length
                  return off > 0 ? `${off}종목 끔` : '모두 받음'
                })()}
              </span>
            </summary>
            {/* 모두 다시 받기 — 보이는 목록에서 끈 것이 있을 때만. 서버에는 [] 를 보내 숨긴 종목의 것까지 비운다(0.45.1 D1) */}
            {stocks.some((s) => settings.muted!.includes(s.ticker)) && (
              <button
                type="button"
                className="push-unmute-all"
                onClick={(e) => {
                  // 누르면 단추가 사라진다 — 포커스가 문서 맨 앞으로 빠지지 않게 칸 제목으로
                  e.currentTarget.closest('details')?.querySelector('summary')?.focus()
                  void savePrefs({ muted: [] })
                }}
              >
                모두 다시 받기
              </button>
            )}
            {stocks.map((stock) => (
              <label key={stock.ticker} className="push-kind">
                <input
                  type="checkbox"
                  checked={!settings.muted!.includes(stock.ticker)}
                  onChange={(e) =>
                    void savePrefs({
                      muted: e.target.checked
                        ? settings.muted!.filter((t) => t !== stock.ticker)
                        : [...settings.muted!, stock.ticker],
                    })
                  }
                />
                <span>{stockLabel(stock)}</span>
              </label>
            ))}
            <p className="hint">끈 종목은 매수 시그널·비중 알림이 오지 않습니다. 리뷰 알림은 종목과 상관없이 옵니다.</p>
          </details>
        )}
        {/* 처음 온 사람(종목 0개)에게도 이 기능이 있다는 것을 — 목록을 받았고 서버가 끈 종목을 아는(0.45 이후) 때만 (0.45.1 D2) */}
        {settings?.muted && stocks && !hasAny && (
          <p className="hint push-stocks-empty">종목을 담으면 여기서 종목마다 알림을 끌 수 있습니다.</p>
        )}

        <p className="hint push-foot">
          장 마감 뒤 시세를 받은 다음에 옵니다 — 아침은 밤사이 미국 장, 오후는 일본·한국 장을 받은 뒤(두 번 모두 모든 종목을 봅니다). 같은
          신호로 매일 울리지 않고, 새로 생겼을 때 한 번만 옵니다. 나가기를 누르면 이 기기의 알림도
          꺼집니다.
        </p>
      </div>
    </div>
  )
}
