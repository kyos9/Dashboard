@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

if not exist ".venv\Scripts\activate.bat" (
    echo [오류] .venv 폴더가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
echo 백엔드 서버를 시작합니다... (닫으려면 이 창을 닫거나 Ctrl+C)
uvicorn app.main:app --reload --port 8000

pause
