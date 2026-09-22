"""테스트가 모델을 직접 짓지 않는지 지킨다.

4단계에서 이 네 표에 *사용자*가 붙는다. 그때 고칠 곳이 `tests/factories.py` 한 곳이
되게 하려고 모아둔 것이라, 새 테스트가 다시 `Stock(...)` 을 직접 쓰기 시작하면 모아둔
의미가 그날로 사라진다. 사람이 기억하는 대신 여기서 잡는다.

일부러 파일 텍스트를 읽는다. import 를 뒤지는 방법으로는 `from app import models` 뒤에
`models.Stock(...)` 으로 쓰는 경우를 놓친다.
"""

import re
from pathlib import Path

# 4단계에서 사용자가 붙는 표들. 시세·지표·시그널은 모두가 같이 쓰므로 여기 없다.
PER_USER_MODELS = ("Stock", "Holding", "PortfolioSettings", "BuyExecution")

TESTS_DIR = Path(__file__).resolve().parent

# 팩토리 자신과, 이 검사 자체는 당연히 예외다.
EXEMPT = {"factories.py", Path(__file__).name}


def test_tests_build_per_user_rows_only_through_factories():
    offenders = []
    for path in sorted(TESTS_DIR.glob("test_*.py")) + [TESTS_DIR / "conftest.py"]:
        if path.name in EXEMPT:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for model in PER_USER_MODELS:
                # 앞에 글자가 붙은 것(`_Stock(`)은 모델이 아니라 그 테스트가 만든 가짜다.
                if re.search(rf"(?<!\w){model}\(", line):
                    offenders.append(f"{path.name}:{lineno}: {line.strip()}")

    assert not offenders, (
        "모델을 직접 짓지 말고 tests/factories.py 의 make_* 를 쓰세요 "
        "(4단계에서 사용자 칸이 붙습니다):\n" + "\n".join(offenders)
    )
