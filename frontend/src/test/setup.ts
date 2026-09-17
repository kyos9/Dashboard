import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom에는 ResizeObserver가 없다. 차트는 컨테이너 폭을 이걸로 따라가므로 자리만 채워둔다.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom에는 캔버스도 없다 — `getContext('2d')`가 null을 돌려준다.
//
// 차트 라이브러리는 축 폭을 재려고 캔버스에 글자를 그려보므로, null을 받으면
// `Error: Value is null`로 터진다. 그것도 `requestAnimationFrame` 안에서,
// **테스트가 끝난 뒤에** 터진다. 그래서 테스트는 전부 통과했다고 나오는데
// 종료 코드는 1이다 — 출력만 보면 멀쩡해 보여서 놓치기 딱 좋다
// (실제로 CI를 붙이고 나서야 드러났다).
//
// 진짜 canvas 패키지를 설치하는 방법도 있지만 네이티브 빌드가 딸려와 설치가
// 무거워진다. 우리가 검증하는 건 그림이 아니라 화면의 글자와 동작이므로,
// 그리기 명령은 받아만 두고 아무것도 안 하면 된다.
if (typeof HTMLCanvasElement !== 'undefined') {
  const TEXT_WIDTH_PER_CHAR = 8 // 실제로 재지 않는다. 0만 아니면 축 폭 계산이 돈다.

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== '2d') return null

    // 값을 돌려줘야 하는 것만 적어두고, 나머지 그리기 명령(fillRect, stroke, …)은
    // 전부 아무 일도 하지 않는 함수로 내준다. 라이브러리가 뭘 부르든 안 터진다.
    const stub: Record<string | symbol, unknown> = {
      canvas: this,
      // 읽히기 전에 값이 있어야 하는 스타일 속성들
      font: '10px sans-serif',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      lineDashOffset: 0,
      textAlign: 'start',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      shadowBlur: 0,
      shadowColor: 'transparent',
      measureText: (text: string) => ({
        width: String(text).length * TEXT_WIDTH_PER_CHAR,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: String(text).length * TEXT_WIDTH_PER_CHAR,
      }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createPattern: () => null,
      getLineDash: () => [],
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(w, 1) * Math.max(h, 1) * 4),
        width: w,
        height: h,
      }),
      isPointInPath: () => false,
      isPointInStroke: () => false,
    }

    return new Proxy(stub, {
      get: (target, prop) => (prop in target ? target[prop] : () => {}),
      set: (target, prop, value) => {
        target[prop] = value
        return true
      },
    })
  } as typeof HTMLCanvasElement.prototype.getContext
}

afterEach(() => {
  cleanup()
})
