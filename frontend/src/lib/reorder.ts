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

/** 보이는 목록에서 맨 위/맨 아래인가 — 화살표를 흐리게 만들 때 쓴다 */
export function isEdge(visible: string[], item: string, direction: 'up' | 'down'): boolean {
  const seen = visible.indexOf(item)
  if (seen === -1) return true
  return direction === 'up' ? seen === 0 : seen === visible.length - 1
}
