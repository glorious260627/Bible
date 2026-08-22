@echo off
setlocal
cd /d "%~dp0"

set "BIBLE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BIBLE_NODE%" goto run

for %%N in (node.exe) do set "BIBLE_NODE=%%~$PATH:N"
if defined BIBLE_NODE goto run

echo Node.js를 찾지 못했습니다. Codex 앱을 먼저 실행한 뒤 다시 눌러 주세요.
pause
exit /b 1

:run
title 오늘의 말씀 - 개인 AI 설교 서버
"%BIBLE_NODE%" scripts\android-ai-server.mjs
if errorlevel 1 (
  echo.
  echo 서버를 시작하지 못했습니다. 이미 실행 중인지 확인해 주세요.
  pause
)
