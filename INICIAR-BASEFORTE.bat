@echo off
setlocal
title BaseForte - Sistema da Escolinha
color 0A

cd /d "%~dp0"

echo.
echo ============================================================
echo              BASEFORTE - GESTAO ESPORTIVA
echo ============================================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O Node.js nao esta instalado neste computador.
    echo.
    echo Instale a versao LTS em:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O npm nao foi encontrado.
    echo Reinstale o Node.js utilizando a versao LTS.
    echo.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERRO] Este arquivo precisa permanecer na pasta do BaseForte.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [1/2] Preparando o sistema para o primeiro uso...
    echo Isso pode levar alguns minutos.
    echo.
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo [ERRO] Nao foi possivel instalar os componentes do sistema.
        echo Verifique sua conexao com a internet e tente novamente.
        echo.
        pause
        exit /b 1
    )
)

echo [2/2] Iniciando o BaseForte...
echo.
echo O sistema sera aberto em:
echo http://localhost:3000
echo.
echo IMPORTANTE: mantenha esta janela aberta enquanto estiver usando.
echo Para encerrar, pressione Ctrl+C e confirme com S.
echo.

start "" /min powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"

call npm.cmd run dev -- --host 127.0.0.1 --port 3000

echo.
echo O BaseForte foi encerrado.
pause
endlocal
