/**
 * 팝업이 떠 있는 동안 뒤 화면이 같이 스크롤되지 않게 (0.45.0).
 *
 * 예전에는 팝업마다 "열 때의 값을 쥐었다가 닫을 때 되돌리기"를 했다. 팝업 위에 확인 창이 떠 있는데 둘이 **같은 박자에**
 * 닫히면(일괄 편집의 "버리고 닫기") React 는 바깥부터 정리한다 — 바깥이 '' 로 되돌린 뒤, 안쪽이 쥐고 있던 'hidden' 을
 * 다시 써서 앱 전체가 스크롤되지 않은 채 남았다(D 검토). 그래서 잠근 수를 센다: 처음 잠글 때 원래 값을 쥐고,
 * 마지막이 풀 때 그 값으로 되돌린다. 순서와 상관없다.
 */
let count = 0
let original = ''

export function lockBodyScroll(): () => void {
  if (count === 0) original = document.body.style.overflow
  count += 1
  document.body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    count -= 1
    if (count === 0) document.body.style.overflow = original
  }
}

/** 테스트용 — 모듈 상태를 처음으로 */
export function resetScrollLock() {
  count = 0
  original = ''
}
