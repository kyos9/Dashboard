# 쓰는 법: npm pack @sun-typeface/suit spoqa-han-sans @fontsource-variable/noto-sans-kr @fontsource/ibm-plex-sans-kr @fontsource/gothic-a1 를 <F> 에 풀고
#   python mkfonts-02d.py <F> docs/design/mockups/assets/fonts-02d docs/design/mockups/4차/02d-다른글꼴.html
# 결과(작은 파일 수백 개)는 저장소에 넣지 않는다(.gitignore) — 고른 글꼴만 나중에 제대로 싣는다.
# 목업 02d 용: 글꼴마다 목업에 나오는 글자만 남긴 작은 woff2 를 만든다 (저장소에 넣어도 가볍게)
import sys, glob, os, io
from fontTools.ttLib import TTFont
from fontTools import subset
F, OUT, SRC = sys.argv[1], sys.argv[2], sys.argv[3]
chars = set(open(SRC, encoding='utf-8').read()) | set('0123456789,.+−-%₩원주D·…—')
chars = {c for c in chars if ord(c) >= 0x20}
fonts = {
 'SUIT': [(f'{F}/sun-typeface-suit-2.0.5/package/fonts/variable/woff2/SUIT-Variable.woff2', '400 700')],
 'Spoqa Han Sans Neo': [(f'{F}/spoqa-han-sans-3.3.0/package/Subset/SpoqaHanSansNeo/SpoqaHanSansNeo-{w}.woff2', n) for w, n in [('Regular','400'),('Medium','500'),('Bold','700')]],
 'Noto Sans KR': [(p, '400 700') for p in sorted(glob.glob(f'{F}/fontsource-variable-noto-sans-kr-5.3.1/package/files/noto-sans-kr-*-wght-normal.woff2'))],
 'IBM Plex Sans KR': [(p, w) for w in ('400','500','600','700') for p in glob.glob(f'{F}/fontsource-ibm-plex-sans-kr-5.3.0/package/files/ibm-plex-sans-kr-*-{w}-normal.woff2')],
 'Gothic A1': [(p, w) for w in ('400','500','600','700') for p in glob.glob(f'{F}/fontsource-gothic-a1-5.3.0/package/files/gothic-a1-*-{w}-normal.woff2')],
}
os.makedirs(OUT, exist_ok=True)
css = []
for fam, files in fonts.items():
  slug = fam.replace(' ', '')
  for i, (p, w) in enumerate(files):
    f = TTFont(p); cmap = f.getBestCmap() or {}
    have = sorted(c for c in chars if ord(c) in cmap)
    if not have: continue
    o = subset.Options(); o.flavor = 'woff2'; o.layout_features = ['kern','liga','calt','tnum','ccmp','locl']
    s = subset.Subsetter(o); s.populate(text=''.join(have)); s.subset(f)
    name = f'{slug}-{i}.woff2'; f.flavor = 'woff2'; f.save(os.path.join(OUT, name))
    ur = ','.join(f'U+{ord(c):04X}' for c in have)
    css.append(f"@font-face{{font-family:'{fam}';src:url('{name}') format('woff2');font-weight:{w};font-display:swap;unicode-range:{ur}}}")
open(os.path.join(OUT, 'fonts.css'), 'w').write('\n'.join(css) + '\n')
print(len(css), sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT)))
