"""앱 아이콘을 만든다. `python frontend/scripts/make_icons.py`

**왜 스크립트인가.** 아이콘은 한 장이 아니라 다섯 장이고(브라우저 탭, 안드로이드 두 벌,
안드로이드 마스크용, 아이폰), 전부 같은 그림이어야 한다. 손으로 그리면 한 장을 고칠 때
나머지가 조용히 어긋난다 — 그리고 그 어긋남은 홈 화면에 설치해보기 전에는 안 보인다.
여기 적힌 도형 하나에서 전부 뽑는다.

**왜 직접 그리는가.** 이 컨테이너에는 PIL도 cairosvg도 없다. 아이콘 한 벌 때문에
의존성을 새로 들이는 것보다, PNG를 직접 써내는 쪽이 가볍다 (zlib은 표준 라이브러리다).

만들어지는 것:

    public/favicon.svg            브라우저 탭 (벡터)
    public/icon-192.png           안드로이드/데스크톱 설치
    public/icon-512.png           설치 화면·스플래시
    public/icon-maskable-512.png  안드로이드가 제 모양으로 잘라 쓰는 것
    public/apple-touch-icon.png   아이폰 홈 화면 (180px, 투명 금지)
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / "public"

# --- 도형. 0~1 좌표계, y는 아래로 간다 -------------------------------------

# 오르는 차트 선. 신호판이 보여주는 것 자체다.
LINE = [(0.150, 0.700), (0.335, 0.520), (0.470, 0.605), (0.660, 0.330), (0.850, 0.215)]
BASELINE = 0.820
STROKE = 0.070          # 선 굵기
DOT_R = 0.062           # 선 끝의 점
CORNER = 0.215          # 둥근 모서리 반지름

# --- 색. index.css 의 다크 테마에서 그대로 가져온다 -------------------------

BG_TOP = (0x16, 0x1F, 0x2C)
BG_BOTTOM = (0x0A, 0x0E, 0x14)
ACCENT = (0x38, 0xBD, 0xF8)     # --accent
GREEN = (0x22, 0xC5, 0x5E)      # --green
BASE_COLOR = (0x2D, 0x3F, 0x57)  # --border-strong


def _mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / length
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _line_y_at(x):
    """차트 선의 x 위치 높이. 선 바깥이면 None."""
    if x < LINE[0][0] or x > LINE[-1][0]:
        return None
    for (ax, ay), (bx, by) in zip(LINE, LINE[1:]):
        if ax <= x <= bx:
            return ay + (by - ay) * ((x - ax) / (bx - ax))
    return None


def _sample(x, y, corner, scale):
    """한 점의 색. (r, g, b, a) 0~255. 바깥은 완전 투명."""
    # 마스크용·아이폰용은 잘려나갈 것을 감안해 그림을 안쪽으로 줄인다.
    gx = 0.5 + (x - 0.5) / scale
    gy = 0.5 + (y - 0.5) / scale

    # 바탕 — 둥근 사각형(corner=0 이면 꽉 찬 사각형)
    if corner > 0.0:
        cx = min(max(x, corner), 1.0 - corner)
        cy = min(max(y, corner), 1.0 - corner)
        if math.hypot(x - cx, y - cy) > corner:
            return (0, 0, 0, 0)

    r, g, b = _mix(BG_TOP, BG_BOTTOM, y)

    line_y = _line_y_at(gx)

    # 기준선
    if line_y is not None and abs(gy - BASELINE) <= 0.011:
        r, g, b = BASE_COLOR

    # 선 아래 옅은 면 — 아래로 갈수록 사라진다
    if line_y is not None and line_y < gy < BASELINE:
        fade = 1.0 - (gy - line_y) / max(BASELINE - line_y, 1e-6)
        alpha = 0.22 * fade
        r, g, b = _mix((r, g, b), ACCENT, alpha)

    # 선 — 왼쪽은 하늘색, 오른쪽으로 갈수록 초록(오르는 쪽)
    half = STROKE / 2.0 / scale
    near = min(_dist_to_segment(gx, gy, *a, *b2) for a, b2 in zip(LINE, LINE[1:]))
    if near <= half:
        t = (gx - LINE[0][0]) / (LINE[-1][0] - LINE[0][0])
        r, g, b = _mix(ACCENT, GREEN, min(max(t, 0.0), 1.0))

    # 끝점 — 지금 신호가 어디 있는지
    ex, ey = LINE[-1]
    d = math.hypot(gx - ex, gy - ey)
    if d <= DOT_R / scale:
        r, g, b = GREEN
    elif d <= (DOT_R + 0.026) / scale:
        r, g, b = _mix(BG_BOTTOM, (r, g, b), 0.0)  # 점 둘레를 바탕색으로 한 번 끊어준다

    return (int(r + 0.5), int(g + 0.5), int(b + 0.5), 255)


def render(size, corner, scale, supersample=3):
    """size×size RGBA 바이트. supersample 배로 그린 뒤 평균 내 계단을 없앤다."""
    n = size * supersample
    inv = 1.0 / n
    out = bytearray(size * size * 4)
    ss2 = supersample * supersample

    # 한 줄씩: 세로 방향 서브픽셀을 모아 평균낸다
    for py in range(size):
        rows = []
        for sy in range(supersample):
            y = (py * supersample + sy + 0.5) * inv
            row = [_sample((sx + 0.5) * inv, y, corner, scale) for sx in range(n)]
            rows.append(row)
        base = py * size * 4
        for px in range(size):
            ar = ag = ab = aa = 0
            start = px * supersample
            for row in rows:
                for sx in range(start, start + supersample):
                    r, g, b, a = row[sx]
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            i = base + px * 4
            if aa:
                out[i] = ar // aa
                out[i + 1] = ag // aa
                out[i + 2] = ab // aa
            out[i + 3] = aa // ss2
    return out


def write_png(path: Path, size: int, rgba: bytearray):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # 필터 없음
        raw += rgba[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def write_svg(path: Path):
    """탭 아이콘. 같은 도형을 벡터로."""
    pts = " ".join(f"{x * 512:.1f},{y * 512:.1f}" for x, y in LINE)
    area = f"{LINE[0][0] * 512:.1f},{BASELINE * 512:.1f} " + pts + f" {LINE[-1][0] * 512:.1f},{BASELINE * 512:.1f}"
    ex, ey = LINE[-1]
    path.write_text(
        f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="신호판">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#{BG_TOP[0]:02x}{BG_TOP[1]:02x}{BG_TOP[2]:02x}"/>
      <stop offset="1" stop-color="#{BG_BOTTOM[0]:02x}{BG_BOTTOM[1]:02x}{BG_BOTTOM[2]:02x}"/>
    </linearGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="{CORNER * 512:.0f}" fill="url(#bg)"/>
  <polygon points="{area}" fill="url(#area)"/>
  <line x1="{LINE[0][0] * 512:.1f}" y1="{BASELINE * 512:.1f}" x2="{LINE[-1][0] * 512:.1f}" y2="{BASELINE * 512:.1f}"
        stroke="#{BASE_COLOR[0]:02x}{BASE_COLOR[1]:02x}{BASE_COLOR[2]:02x}" stroke-width="6"/>
  <polyline points="{pts}" fill="none" stroke="url(#stroke)" stroke-width="{STROKE * 512:.0f}"
            stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{ex * 512:.1f}" cy="{ey * 512:.1f}" r="{DOT_R * 512:.0f}" fill="#22c55e"/>
</svg>
""",
        encoding="utf-8",
    )


def main():
    write_svg(PUBLIC / "favicon.svg")
    print("favicon.svg")

    # 탭·설치용: 둥근 모서리, 그림은 제 크기
    for size in (512, 192):
        write_png(PUBLIC / f"icon-{size}.png", size, render(size, CORNER, 1.0))
        print(f"icon-{size}.png")

    # 안드로이드가 제 모양(원·사각·물방울)으로 잘라 쓰는 것. 잘려도 남도록 안쪽에 그린다.
    write_png(PUBLIC / "icon-maskable-512.png", 512, render(512, 0.0, 0.78))
    print("icon-maskable-512.png")

    # 아이폰. 투명한 곳이 있으면 검게 나오므로 꽉 찬 사각형으로 만든다.
    write_png(PUBLIC / "apple-touch-icon.png", 180, render(180, 0.0, 0.84, supersample=4))
    print("apple-touch-icon.png")


if __name__ == "__main__":
    main()
