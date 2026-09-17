@echo off
chcp 65001 >nul
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo [오류] node_modules가 없습니다. setup.bat을 먼저 실행해주세요.
    pause
    exit /b 1
)

rem 평소 사용에는 필요 없습니다 — start-all.bat 이 띄우는 백엔드가 화면까지 함께
rem 내보냅니다. 이 파일은 **화면 코드를 고치면서 바로 확인할 때**(HMR) 씁니다.
rem 이때는 백엔드도 따로 떠 있어야 합니다 (start-backend.bat).
echo 프런트엔드 개발 서버를 시작합니다... (닫으려면 이 창을 닫거나 Ctrl+C)
echo 개발용입니다. 평소에는 start-all.bat 을 쓰세요.
npm run dev

pause
