@echo off
chcp 65001 >nul
echo 신호판 대시보드를 시작합니다...
echo.

start "신호판 - 백엔드" cmd /k "%~dp0start-backend.bat"
timeout /t 3 /nobreak >nul

start "신호판 - 프런트엔드" cmd /k "%~dp0start-frontend.bat"
echo 서버가 켜질 때까지 잠시 기다렸다가 브라우저를 엽니다...
timeout /t 6 /nobreak >nul

start http://localhost:5173
