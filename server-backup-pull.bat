@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem 서버의 백업을 이 PC 로 가져온다 (0.45.0, DEPLOY.md 10).
rem
rem   backup.bat             = 이 PC 에서 돌리는 앱(SQLite)의 백업을 뜬다
rem   server-backup-pull.bat = 서버(Docker)의 백업을 이 PC 로 가져온다  <- 이 파일
rem
rem 서버가 통째로 사라지면 서버 안의 백업도 같이 사라진다. 일주일에 한 번 이것을 누르거나
rem 윈도우 "작업 스케줄러"에 걸어 둔다(DEPLOY.md 10). 서버의 가장 새 매일 백업 한 벌을 받아,
rem 이 PC 에는 최근 4벌만 남긴다 — 방침 5절(탈퇴한 사람의 데이터가 오래 남지 않게).
rem 받은 크기가 같을 때만 서버에 "밖에 꺼냈다"고 적는다(진단 화면의 "밖에 꺼낸 것").
rem
rem 서버 주소·키 경로는 같은 폴더의 backup-pull.local.txt 에 적는다. 그 파일은 저장소에 올라가지 않는다(.gitignore).

set "CONF=%~dp0backup-pull.local.txt"
if not exist "%CONF%" (
    > "%CONF%" echo # server-backup-pull.bat 설정 — 이 파일은 저장소에 올라가지 않습니다
    >> "%CONF%" echo # 서버 접속: 사용자@주소 (DEPLOY.md 3번에서 쓴 것)
    >> "%CONF%" echo SERVER=ubuntu@서버주소
    >> "%CONF%" echo # 서버에 접속하는 개인키 파일 (공백이 있어도 됩니다)
    >> "%CONF%" echo KEY=%USERPROFILE%\.ssh\서버키.key
    >> "%CONF%" echo # 서버에서 저장소를 받아 둔 폴더
    >> "%CONF%" echo REPO=~/Dashboard
    >> "%CONF%" echo # 이 PC 에 받을 폴더 (저장소 밖)
    >> "%CONF%" echo DEST=%USERPROFILE%\dashboard-backups
    echo [처음 한 번] backup-pull.local.txt 를 만들었습니다.
    echo 메모장으로 열어 SERVER 와 KEY 를 고친 뒤 이 파일을 다시 실행하세요.
    start "" notepad "%CONF%"
    pause
    exit /b 1
)

set "SERVER="
set "KEY="
set "REPO=~/Dashboard"
set "DEST=%USERPROFILE%\dashboard-backups"
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CONF%") do set "%%A=%%B"
if "%SERVER%"=="" goto :badconf
if "%KEY%"=="" goto :badconf
if not exist "%KEY%" (
    echo [오류] 키 파일이 없습니다: %KEY%
    echo backup-pull.local.txt 의 KEY 를 고쳐 주세요.
    pause
    exit /b 1
)

set SSH=ssh -i "%KEY%" -o BatchMode=yes -o ConnectTimeout=20
set SCP=scp -i "%KEY%" -o BatchMode=yes -o ConnectTimeout=20

echo [1/4] 서버에서 가장 새 매일 백업을 고릅니다...
set "LINE="
for /f "usebackq delims=" %%L in (`%SSH% %SERVER% "%REPO%/deploy/backup-export.sh export"`) do set "LINE=%%L"
if "%LINE%"=="" (
    echo [오류] 서버에서 백업을 꺼내지 못했습니다. 위 메시지를 보세요.
    goto :clean_fail
)
for /f "tokens=1,2" %%A in ("%LINE%") do (
    set "NAME=%%A"
    set "SIZE=%%B"
)

if not exist "%DEST%" mkdir "%DEST%"
echo [2/4] 받습니다: !NAME! (!SIZE! 바이트)
rem 서버 쪽 경로는 홈에서부터(앞에 ~ 를 붙이지 않는다 — scp 의 방식에 따라 펼쳐지지 않는다)
%SCP% "%SERVER%:dashboard-backup-export/!NAME!" "%DEST%\!NAME!"
set "PULLED=%ERRORLEVEL%"

echo [3/4] 서버의 꺼낼 폴더를 비웁니다...
%SSH% %SERVER% "%REPO%/deploy/backup-export.sh clean"

if not "%PULLED%"=="0" (
    echo [오류] 받지 못했습니다. 서버에 "꺼냈다"고 적지 않습니다.
    goto :fail
)
set "GOT=0"
for %%F in ("%DEST%\!NAME!") do set "GOT=%%~zF"
if not "!GOT!"=="!SIZE!" (
    echo [오류] 받은 크기가 다릅니다 ^(!GOT! / !SIZE!^). 서버에 "꺼냈다"고 적지 않습니다.
    del "%DEST%\!NAME!" 2>nul
    goto :fail
)

echo [4/4] 서버에 "밖에 꺼냈다"고 적습니다...
%SSH% %SERVER% "%REPO%/deploy/backup-export.sh mark"
if errorlevel 1 (
    echo [주의] 백업은 받았지만 서버에 꺼낸 시각을 남기지 못했습니다 ^(서버가 0.45 보다 옛 버전이거나 디스크·권한^).
)

rem 최근 4벌만 남긴다 — 이름에 시각이 있어 이름 순서가 곧 시간 순서
powershell -NoProfile -Command "Get-ChildItem -LiteralPath $env:DEST -Filter 'signalboard-*' | Sort-Object Name -Descending | Select-Object -Skip 4 | Remove-Item -Force"

echo.
echo 끝났습니다: %DEST%\!NAME!
echo 이 PC 에는 최근 4벌만 남깁니다.
if /i not "%~1"=="/quiet" pause
exit /b 0

:badconf
echo [오류] backup-pull.local.txt 에 SERVER 와 KEY 가 있어야 합니다.
pause
exit /b 1

:clean_fail
%SSH% %SERVER% "%REPO%/deploy/backup-export.sh clean"
:fail
if /i not "%~1"=="/quiet" pause
exit /b 1
