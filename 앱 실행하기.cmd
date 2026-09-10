@echo off
chcp 949 >nul
setlocal
title Python 학습 앱

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto :node_missing
where npm >nul 2>&1
if errorlevel 1 goto :node_missing

if not exist "node_modules" (
    echo 필요한 패키지를 처음 설치합니다. 잠시만 기다려 주세요.
    call npm install
    if errorlevel 1 goto :install_failed
)

echo.
echo Python 학습 앱을 실행합니다.
echo.
echo PC에서는 브라우저가 자동으로 열립니다.
echo 휴대폰과 태블릿에서는 아래 Network 주소로 접속하세요.
echo 휴대폰과 PC는 같은 Wi-Fi에 연결되어 있어야 합니다.
echo.
echo 이 창을 닫으면 앱이 종료됩니다.
echo.

call npm run dev -- --host 0.0.0.0 --open
if errorlevel 1 goto :server_failed
goto :end

:node_missing
echo.
echo 이 앱을 실행하려면 Node.js가 필요합니다.
echo Node.js를 설치한 뒤 다시 실행해 주세요.
echo.
pause
goto :end

:install_failed
echo.
echo 패키지 설치에 실패했습니다. 인터넷 연결과 npm 설정을 확인해 주세요.
echo.
pause
goto :end

:server_failed
echo.
echo 개발 서버를 실행하지 못했습니다. 오류 내용을 확인한 뒤 다시 실행해 주세요.
echo.
pause

:end
endlocal
