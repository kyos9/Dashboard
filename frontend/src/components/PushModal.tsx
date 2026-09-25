import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { KIND_TEXT, STATE_TEXT } from '../lib/pushText'
import type { PushKind, PushSettings } from '../types'
import { ErrorNotice } from './ErrorNotice'

/**
 * 알림 설정 — 이 기기에서 켜고 끄기, 받을 종류, 시험 알림 (ROADMAP 6단계).
 *
 * **켜는 건 기기마다, 받을 종류는 사람마다다.** 폰에서 켜고 PC에서 안 켜면 폰에만 온다.
 * 종류는 어느 기기에서 고르든 같다.
 */

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
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

        <p className="hint push-foot">
          장 마감 뒤 시세를 받은 다음에 옵니다 — 미국 종목은 한국 아침, 한국 종목은 오후. 같은
          신호로 매일 울리지 않고, 새로 생겼을 때 한 번만 옵니다. 나가기를 누르면 이 기기의 알림도
          꺼집니다.
        </p>
      </div>
    </div>
  )
}
