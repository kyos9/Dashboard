# B 뮤테이션 — 종합 신호등 정리

명령: `npx vitest run src/pages/Dashboard.test.tsx src/pages/Dashboard.portfolio.test.tsx src/lib/display.test.ts src/pages/RebalancePanel.test.tsx` (frontend). 한 줄씩 바꾸고 돌린 뒤 되돌림.

| 뮤테이션 | 파일 | 결과 |
| --- | --- | --- |
| 관망을 다시 글자로 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 관망 풀이 지우기 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 관망 표시를 빈칸으로 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 시그널 이름표 지우기 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 비중 이름표 지우기 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 비활성 비중도 보이기 | `frontend/src/pages/Dashboard.tsx` | 살아남음 → 테스트 더한 뒤 잡힘 |
| 둘 다 뜰 때 매도 꼬리표 빼기 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 요약 배지 옛 말 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 요약 미달 옛 말 | `frontend/src/pages/Dashboard.tsx` | 잡힘 |
| 배지 초과 옛 말 | `frontend/src/lib/display.ts` | 잡힘 |
| 배지 미달 옛 말 | `frontend/src/lib/display.ts` | 잡힘 |
| 비중 줄에 정기 리뷰도 세우기 | `frontend/src/pages/Dashboard.tsx` | 잡힘 (계획 B "비중 칸에는 과중·미달만"을 빠뜨렸던 것을 고친 뒤 더함) |
| 리밸런싱 묶음 옛 말 | `frontend/src/lib/portfolio.ts` | 잡힘 |

"비활성 비중도 보이기"가 처음엔 살아남았다 — 사유가 와도 `active=false` 면 비중 줄을 그리지 않는다는 테스트가 없었다. Dashboard.test.tsx 에 GOOG(active=false) 줄을 더한 뒤 다시 돌려 잡힘. **13/13 잡힘.**
