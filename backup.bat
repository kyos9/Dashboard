@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

rem 지금 당장 한 벌 떠둔다.
rem
rem 평소에는 앱이 알아서 뜬다 (켠 직후 + 매일 한 번, 최대 7벌 보관). 이 파일은
rem **뭔가 크게 바꾸기 직전에** 쓰라고 있다 — 종목을 여럿 지우기 전 같은 때.
rem
rem 복구는 간단하다: backend\backups\ 의 파일을 backend\signal_dashboard.db 로
rem 덮어쓰면 된다 (앱을 stop.bat 으로 끈 뒤에).

if not exist ".venv\Scripts\python.exe" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)

.venv\Scripts\python.exe -m app.services.backup
if errorlevel 1 (
    echo.
    echo [오류] 백업에 실패했습니다. 위 메시지를 확인해주세요.
)

echo.
pause
