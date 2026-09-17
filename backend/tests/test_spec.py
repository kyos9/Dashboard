"""시그널 명세 문서가 코드와 같이 살아 있는지 본다.

원본 `SIGNAL_APP_SPEC.md`는 **저장소에 커밋된 적이 없었다.** 코드 여섯 곳과 README가
"3장 참고"라고 가리키는데 가리킬 파일이 없는 상태로 한참을 지냈고, 아무도 몰랐다.
지표·시그널 공식의 근거 문서라 잃으면 "이 조건식이 원래 맞나"를 확인할 방법이 없다.

경계값과 공식 자체는 test_signals.py / test_indicators.py가 본다. 여기서는 그 둘이
못 보는 것 하나만 본다 — **문서가 있고, 가리키는 장이 실제로 있는가.**
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC = REPO_ROOT / "SIGNAL_APP_SPEC.md"

# 문서를 가리키는 코드/문서를 찾을 곳
SEARCH_DIRS = (REPO_ROOT / "backend" / "app", REPO_ROOT / "frontend" / "src")
SEARCH_FILES = (REPO_ROOT / "README.md", REPO_ROOT / "ROADMAP.md")

# "SIGNAL_APP_SPEC.md 3~4장", "SIGNAL_APP_SPEC.md 6장" 등에서 장 번호를 뽑는다
REFERENCE = re.compile(r"SIGNAL_APP_SPEC\.md[^\n]{0,20}?(\d+)(?:~(\d+))?장")


def _sources() -> list[Path]:
    found = [p for p in SEARCH_FILES if p.is_file()]
    for directory in SEARCH_DIRS:
        if directory.is_dir():
            found += [
                p
                for p in directory.rglob("*")
                if p.suffix in {".py", ".ts", ".tsx"} and "__pycache__" not in p.parts
            ]
    return found


def test_spec_document_exists():
    assert SPEC.is_file(), (
        "SIGNAL_APP_SPEC.md 가 없습니다. 코드가 이 문서를 근거로 가리키고 있으므로, "
        "지우려면 참조도 같이 지워야 합니다."
    )


def test_every_chapter_the_code_points_at_exists():
    """코드가 '5장 참고'라고 적었으면 5장이 실제로 있어야 한다."""
    headings = {int(n) for n in re.findall(r"^## (\d+)\.", SPEC.read_text(encoding="utf-8"), re.M)}
    assert headings, "명세에 `## N.` 형태의 장 제목이 하나도 없습니다"

    missing = []
    for path in _sources():
        text = path.read_text(encoding="utf-8", errors="ignore")
        for start, end in REFERENCE.findall(text):
            for chapter in range(int(start), int(end or start) + 1):
                if chapter not in headings:
                    missing.append(f"{path.relative_to(REPO_ROOT)} → {chapter}장")

    assert not missing, "명세에 없는 장을 가리킵니다: " + ", ".join(sorted(set(missing)))


def test_the_spec_says_it_was_reconstructed():
    """이 문서는 코드에서 복원한 것이라 백테스트 근거가 없다 — 그 사실이 문서에 남아야 한다.

    "ADX 20이 왜 20인가"의 답이 여기 없다는 걸 모르면, 임계값을 바꿀 때 이 문서를
    근거로 삼게 된다. 근거가 아니라 현황이다.
    """
    text = SPEC.read_text(encoding="utf-8")
    assert "복원한 것" in text
    assert "백테스트" in text
