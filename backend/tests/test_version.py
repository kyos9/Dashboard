"""화면 오른쪽 위에 뜨는 버전.

이 모듈이 있는 이유는 **"올렸는데 그대로"를 가리자는 것**이다 — 코드가 안 고쳐진
건지, 서버가 옛 이미지를 그대로 받아쓰고 있는 건지. 그런데 도커 이미지에는 `.git`
이 안 들어가서(.dockerignore) 정작 서버에서는 커밋을 알려주지 못하고 있었다.
이제 빌드할 때 해시를 박아 넣는다.
"""

import app.version as version


def _fresh():
    """`lru_cache` 를 비운다 — 안 비우면 첫 테스트의 결과가 계속 돌아온다."""
    version.git_revision.cache_clear()
    version.version_string.cache_clear()
    version.built_at.cache_clear()


def test_the_baked_revision_wins(monkeypatch):
    """도커에서 오는 길. git 이 없어도 커밋을 말할 수 있어야 한다."""
    monkeypatch.setenv(version.REVISION_ENV, "1234abcdef567890")
    _fresh()
    try:
        assert version.git_revision() == "1234abc"  # 앞 7자리면 충분하다
        assert version.version_string() == f"{version.APP_VERSION} (1234abc)"
    finally:
        _fresh()


def test_an_empty_build_arg_falls_back_to_git(monkeypatch):
    """손으로 빌드하면 인자가 비어 있다. 빈 문자열을 해시로 쓰면 `0.11.0 ()` 가 된다."""
    monkeypatch.setenv(version.REVISION_ENV, "   ")
    monkeypatch.setattr(version.subprocess, "run", lambda *a, **k: _Git("abc1234\n"))
    _fresh()
    try:
        assert version.git_revision() == "abc1234"
    finally:
        _fresh()


def test_no_revision_anywhere_still_gives_a_version(monkeypatch):
    """git 도 없고 박아둔 값도 없으면 버전만 보여준다 — 여기서 터지면 화면이 통째로 안 뜬다."""
    monkeypatch.delenv(version.REVISION_ENV, raising=False)
    monkeypatch.setattr(version.subprocess, "run", lambda *a, **k: _Git("", code=128))
    _fresh()
    try:
        assert version.version_string() == version.APP_VERSION
    finally:
        _fresh()


class _Git:
    def __init__(self, stdout: str, code: int = 0):
        self.stdout = stdout
        self.returncode = code


# ---------------------------------------------------------------------------
#  만든 시각 — 해시만으로는 사람이 못 읽는다
# ---------------------------------------------------------------------------


def test_the_build_time_is_passed_through_untouched(monkeypatch):
    """서버에서 "9월 21일"로 만들지 않는다 — 보는 사람의 시간대를 서버는 모른다."""
    monkeypatch.setenv(version.BUILT_AT_ENV, "2026-09-21T16:11:00Z")
    _fresh()
    try:
        assert version.built_at() == "2026-09-21T16:11:00Z"
    finally:
        _fresh()


def test_a_nonsense_build_time_is_dropped(monkeypatch):
    """화면에 `Invalid Date` 가 찍히는 건 아무것도 안 뜨는 것보다 나쁘다."""
    monkeypatch.setenv(version.BUILT_AT_ENV, "그런 날짜 없음")
    _fresh()
    try:
        assert version.built_at() is None
    finally:
        _fresh()


def test_info_hands_out_the_pieces_separately(monkeypatch):
    """합쳐서 보내면 화면이 다시 쪼개야 한다."""
    monkeypatch.setenv(version.REVISION_ENV, "abc1234def")
    monkeypatch.setenv(version.BUILT_AT_ENV, "2026-09-21T16:11:00Z")
    _fresh()
    try:
        assert version.info() == {
            "version": version.APP_VERSION,
            "revision": "abc1234",
            "built_at": "2026-09-21T16:11:00Z",
        }
    finally:
        _fresh()


def test_info_survives_a_build_that_knows_nothing(monkeypatch):
    """손으로 빌드하면 둘 다 비어 있다. 그때도 버전은 나와야 한다."""
    monkeypatch.delenv(version.REVISION_ENV, raising=False)
    monkeypatch.delenv(version.BUILT_AT_ENV, raising=False)
    monkeypatch.setattr(version.subprocess, "run", lambda *a, **k: _Git("", code=128))
    _fresh()
    try:
        assert version.info() == {
            "version": version.APP_VERSION,
            "revision": None,
            "built_at": None,
        }
    finally:
        _fresh()
