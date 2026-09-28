import { useState, type ReactNode } from 'react'

/**
 * 화면 맨 위 안내 — 한 줄 + "자세히" (ROADMAP 8-4).
 *
 * 매일 여는 사람에게 3~5줄 설명은 본문을 밀어낼 뿐이다. 한 줄만 두고 나머지는 접는다.
 * 처음 온 사람(종목이 아직 없는 사람)에게는 펼쳐서 보여준다 — 그 사람에게는 설명이 본문이다.
 *
 * `firstVisit` 은 데이터를 받기 전에는 모른다(null). 받고 나서 처음으로 true 가 되면 한 번 펼친다.
 * 그 뒤로는 사람이 접고 편 대로 둔다.
 */
export function PageIntro({
  line,
  firstVisit = null,
  children,
}: {
  line: ReactNode
  firstVisit?: boolean | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [decided, setDecided] = useState(false)

  // 그리는 중에 한 번 정한다 — effect 로 하면 접힌 화면이 한 번 그려진 뒤 펼쳐진다
  if (!decided && firstVisit !== null) {
    setDecided(true)
    if (firstVisit) setOpen(true)
  }

  return (
    <details className="page-intro hint" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>{line}</span> <span className="intro-more">{open ? '접기' : '자세히'}</span>
      </summary>
      <p>{children}</p>
    </details>
  )
}
