@echo off
chcp 65001 >nul
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo [오류] node_modules가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)

echo 프런트엔드 개발 서버를 시작합니다... (닫으려면 이 창을 닫거나 Ctrl+C)
npm run dev

pause
