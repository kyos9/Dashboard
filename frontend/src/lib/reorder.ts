/**
 * 목록에서 항목 하나를 한 칸 옮긴다.
 *
 * 화면에는 필터가 걸려 있을 수 있어서, 전체 순서에서 그냥 한 칸 옮기면 눈에 보이는
 * 순서는 그대로인 채 아무 일도 안 일어난 것처럼 보인다 (가려진 종목과 자리를
 * 바꾸기 때문이다). 그래서 **보이는 목록 기준으로 이웃을 찾고**, 전체 순서에서는
 * 그 이웃의 자리로 옮긴다.
 *
 * @param order   전체 순서 (보이지 않는 항목 포함)
 * @param visible 지금 화면에 보이는 항목들 (order와 같은 상대 순서)
 */
export function moveOne(
  order: string[],
  visible: string[],
  item: string,
  direction: 'up' | 'down',
): string[] {
  const seen = visible.indexOf(item)
  if (seen === -1) return order

  const neighbour = direction === 'up' ? visible[seen - 1] : visible[seen + 1]
  if (neighbour === undefined) return order // 이미 끝이다

  const from = order.indexOf(item)
  const to = order.indexOf(neighbour)
  if (from === -1 || to === -1) return order

  const next = [...order]
  next.splice(from, 1)
  next.splice(next.indexOf(neighbour) + (direction === 'up' ? 0 : 1), 0, item)
  return next
}

/**
 * 끌어다 놓은 자리로 옮긴다.
 *
 * 놓은 행의 위(before)나 아래(after)에 끼워 넣는다. 어느 쪽인지는 마우스가 그 행의
 * 절반을 넘었는지로 정한다(`dropSide`) — 넘기 전에 자리를 바꿔버리면, 커서가 조금만
 * 떨려도 행이 위아래로 튄다.
 *
 * 필터가 걸려 있어도 전체 순서에서 "놓은 행"의 자리를 그대로 쓰므로, 화면에 보이는
 * 결과와 저장되는 순서가 어긋나지 않는다.
 */
export function placeAt(
  order: string[],
  item: string,
  target: string,
  side: 'before' | 'after',
): string[] {
  const from = order.indexOf(item)
  const to = order.indexOf(target)
  if (from === -1 || to === -1 || from === to) return order

  const next = [...order]
  next.splice(from, 1)
  next.splice(next.indexOf(target) + (side === 'after' ? 1 : 0), 0, item)
  // 원래 있던 자리 그대로면 새 배열을 만들지 않는다 (끌고 있는 동안 매번 다시 그리게 된다)
  return next.join('\u0000') === order.join('\u0000') ? order : next
}

/**
 * 놓으려는 행의 앞인가 뒤인가.
 *
 * 세로로 쌓인 목록(표)은 위아래 절반으로, 가로로 늘어선 목록(카드가 여러 열일 때)은
 * 좌우 절반으로 가른다. `horizontal`은 옆 항목이 같은 줄에 있는지로 판단한 값이다.
 */
export function dropSide(
  rect: { top: number; left: number; width: number; height: number },
  pointer: { x: number; y: number },
  horizontal: boolean,
): 'before' | 'after' {
  const middle = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2
  const at = horizontal ? pointer.x : pointer.y
  return at > middle ? 'after' : 'before'
}
