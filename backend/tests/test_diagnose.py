"""진단 스크립트가 부르는 이름이 실제로 존재하는지.

**이게 없어서 한 번 놓쳤다.** 환율이 통화별로 일반화(0.10.0)되면서 `fx.fetch_usd_krw`
가 `fx.fetch_krw_rate(currency)` 로 바뀌었는데 `diagnose.py` 만 안 따라왔다. 테스트가
닿지 않는 파일이라 아무도 모르다가, 서버에서 진단을 처음 돌린 날 8번 항목이 통째로
`AttributeError` 로 나왔다 — 하필 "뭐가 잘못됐는지 알려주는 도구"가 고장난 채였다.

스크립트라 불러서 돌려볼 수가 없으므로(돌리면 실제로 바깥에 요청을 보낸다) 소스를
읽어서 `모듈.이름` 꼴을 전부 뽑아 확인한다. 서명까지는 못 보지만, 이름이 사라지는
종류의 고장은 여기서 걸린다.
"""

import ast
import importlib
from pathlib import Path

import pytest

DIAGNOSE = Path(__file__).resolve().parents[1] / "diagnose.py"

# diagnose.py 안에서 이 이름들이 가리키는 앱 모듈. 바깥 라이브러리(requests 등)는
# 여기서 볼 일이 아니다.
WATCHED = {
    "fx": "app.services.fx",
    "macro": "app.services.macro",
    "providers": "app.services.providers",
    "fred": "app.services.providers.fred",
    "symbols": "app.services.symbols",
    "krx": "app.services.krx",
    "cnn": "app.services.providers.cnn",
}


def _referenced() -> set[tuple[str, str]]:
    """소스에서 `모듈.이름` 을 전부 뽑는다."""
    tree = ast.parse(DIAGNOSE.read_text(encoding="utf-8"))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id in WATCHED:
                found.add((node.value.id, node.attr))
    return found


def test_the_diagnostic_calls_names_that_exist():
    missing = []
    for alias, attr in sorted(_referenced()):
        module = importlib.import_module(WATCHED[alias])
        if not hasattr(module, attr):
            missing.append(f"{alias}.{attr}  ({WATCHED[alias]} 에 없음)")

    assert not missing, "diagnose.py 가 없는 이름을 부릅니다:\n  " + "\n  ".join(missing)


def test_the_scan_actually_finds_things():
    """위 테스트가 0개를 훑고 통과하는 일이 없게. (구조가 바뀌면 조용히 그렇게 된다.)"""
    found = _referenced()
    assert len(found) > 5, f"훑은 것이 너무 적습니다: {found}"
    assert ("fx", "fetch_krw_rate") in found


@pytest.mark.parametrize("name", ["fetch_krw_rate", "tracked_currencies", "FALLBACK_KRW"])
def test_the_fx_names_the_diagnostic_needs(name):
    """실제로 사라졌던 자리 — 이름만이라도 못 박아둔다."""
    from app.services import fx

    assert hasattr(fx, name)
