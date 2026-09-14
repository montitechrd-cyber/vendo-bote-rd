@echo off
title VENDO BOTE RD - Servidor
echo.
echo  ===================================
echo   VENDO BOTE RD - Iniciando servidor
echo  ===================================
echo.

REM Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js no esta instalado.
    echo  Por favor descargalo en: https://nodejs.org
    echo.
    pause
    start https://nodejs.org
    exit /b
)

echo  Node.js encontrado. Instalando dependencias...
echo.
call npm install

echo.
echo  Iniciando servidor en http://localhost:3000
echo.
start http://localhost:3001
node server.js
pause
