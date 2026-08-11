@echo off
setlocal
title Escola de Futebol M6 Futebol Clube - Modo Navegador
color 0A

cd /d "%~dp0"

echo.
echo ============================================================
echo    ESCOLA DE FUTEBOL M6 FUTEBOL CLUBE - MODO NAVEGADOR
echo ============================================================
echo.
echo Este modo abre o sistema direto no seu navegador (Chrome/Edge),
echo sem precisar abrir o aplicativo Electron. Usa os mesmos dados.
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
    echo [ERRO] Este arquivo precisa permanecer na pasta do sistema.
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

echo [2/2] Iniciando o servidor local...
echo.
echo O navegador vai abrir sozinho em alguns segundos.
echo Se nao abrir, acesse manualmente: http://localhost:3000
echo.
echo IMPORTANTE: mantenha esta janela aberta enquanto estiver usando.
echo Para encerrar, pressione Ctrl+C e confirme com S.
echo.

start "" cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:3000"

call npm.cmd run dev

echo.
echo O sistema foi encerrado.
pause
endlocal
