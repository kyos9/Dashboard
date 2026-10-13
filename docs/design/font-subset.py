"""웹 글꼴 부분집합 만들기 (디자인 1차, docs/design/01-기획.md 4장).

KS X 1001 한글 2,350자 + ASCII + 앱이 쓰는 기호만 남기고, 가변 굵기 축을 400~700 으로 좁힌다.
결과: frontend/src/assets/fonts/WantedSansVariable-ko.woff2 (약 290KB)

    pip install fonttools brotli
    npm pack wanted-sans@1.0.3 && tar xzf wanted-sans-1.0.3.tgz
    python font-subset.py package/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2 \
        WantedSansVariable-ko.woff2 400 700

2,350자 밖의 글자(드문 한글, 일본어 등)는 브라우저가 그 글자만 시스템 글꼴로 그린다.
"""
import sys, os
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer
src, out, lo, hi = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
chars=set()
for a in range(0xB0,0xC9):
  for b in range(0xA1,0xFF):
    try: chars.add(bytes([a,b]).decode('euc-kr'))
    except: pass
base = set(chr(c) for c in range(0x20,0x7f)) | set('·—–…‘’“”•↗→←↑↓▲▼◆✕✎✦⋯₩¥€£%‰°±×÷≤≥≠~※−')
f = TTFont(src)
opts = subset.Options(); opts.flavor='woff2'; opts.layout_features=['kern','liga','calt','ccmp','locl','mark','mkmk','tnum']
s = subset.Subsetter(opts); s.populate(text=''.join(sorted(chars|base))); s.subset(f)
if 'fvar' in f: f = instancer.instantiateVariableFont(f, {'wght': (lo, hi)})
f.flavor='woff2'; f.save(out); print(out, os.path.getsize(out))
