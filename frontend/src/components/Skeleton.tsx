/**
 * 처음 여는 탭에서 값이 오기 전에 보여주는 회색 틀 (ROADMAP 8-1).
 *
 * "불러오는 중…" 한 줄만 있다가 표가 들어오면 화면이 한 번에 아래로 밀린다. 틀을 먼저
 * 깔아 두면 값이 와도 자리가 크게 흔들리지 않는다. 글은 화면 읽기 프로그램에만 들린다.
 */
export function PageSkeleton({ blocks = 3, rows = 5 }: { blocks?: number; rows?: number }) {
  return (
    <div className="page-skeleton" role="status" aria-busy="true">
      <span className="sr-only">불러오는 중…</span>
      {blocks > 0 && (
        <div className="skeleton-cards" aria-hidden="true">
          {Array.from({ length: blocks }, (_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      )}
      {rows > 0 && (
        <div className="skeleton-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      )}
    </div>
  )
}
