@echo off
title Etho Multi-Bot Hub - Servidor
chcp 65001 > nul
echo ========================================================
echo  🚀 INICIANDO ETHO MULTI-BOT HUB (SISTEMA DE WHATSAPP)
echo ========================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no está instalado o no se encuentra en el PATH.
    echo Por favor descarga e instala Node.js 20+ desde https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] Verificando dependencias...
if not exist node_modules (
    echo Instalando paquetes npm...
    call npm install
)

echo [2/3] Levantando servidor en http://localhost:3000...
echo.

:: Abrir navegador en 2 segundos en segundo plano
start "" powershell -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

:: Ejecutar el servidor
npm start

