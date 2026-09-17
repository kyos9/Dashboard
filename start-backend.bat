@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

rem 평소에는 start-all.bat 을 쓰세요 — 창 없이 뜹니다.
rem 이 파일은 **문제를 눈으로 쫓을 때** 씁니다. 로그가 창에 그대로 흐르고,
rem 코드를 고치면 서버가 알아서 다시 뜹니다(--reload).

if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
echo 백엔드 서버를 시작합니다... (닫으려면 이 창을 닫거나 Ctrl+C)
echo 화면도 이 주소에서 함께 열립니다: http://localhost:8000
echo.
uvicorn app.main:app --reload --port 8000

pause
