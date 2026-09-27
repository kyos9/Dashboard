import { useInstall } from '../lib/install'

/** 설치 버튼 — 설치할 수 없거나 이미 설치했으면 아무것도 그리지 않는다. */
export function InstallButton() {
  const { available, start, hint } = useInstall()
  if (!available && !hint) return null
  return (
    <>
      {available && (
        <button className="ghost" onClick={start} title="홈 화면에 앱으로 추가합니다">
          앱 설치
        </button>
      )}
      {hint}
    </>
  )
}
