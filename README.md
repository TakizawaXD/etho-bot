# ETHO MULTI-BOT HUB & DASHBOARD PRO

Sistema integral de WhatsApp: **Backend (Node.js 24 + Baileys Multi-Instancia) + Frontend Web Reactivo SaaS + Base de Datos en Supabase (PostgreSQL) + SQLite Local Nativo**.

Permite desplegar y controlar múltiples bots con diferentes números desde un panel visual ejecutivo, ver el código QR en vivo para vincular WhatsApp, crear bots con 4 facetas (Recreativo, Asistente, Asesor, IA Autónoma), gestionar catálogo de productos, capturar prospectos (CRM Leads), horarios de atención, transferencia a asesor humano (#asesor), probar en el simulador de chat en vivo y registrar toda la actividad en Supabase en tiempo real.

---

## 🌟 Características Principales

### 1. 🏛️ Panel de Control SaaS (Web Dashboard)
- Acceso desde cualquier navegador en `http://localhost:3000`.
- Diseño **Executive SaaS** con barra lateral (*Sidebar*), migas de pan (*Breadcrumbs*), modo oscuro (*Dark Mode*) y 100% responsivo para móviles con barra inferior táctil.
- Estado del servidor y sincronización con Supabase en tiempo real mediante **Server-Sent Events (SSE)**.

### 2. 🎭 Wizard de Creación con 4 Facetas de Bot
- **🎮 Recreativo & Grupos (Estilo Etho)**: Los 219 comandos de economía, ruleta, anime, gacha, stickers y juegos.
- **💼 Asistente Personal**: Tareas, notas, recordatorios y productividad personal.
- **🛍️ Asesor Comercial & Ventas**: Atención a clientes 24/7, catálogo interactivo (`#catalogo`), horarios y captura de prospectos.
- **🧠 Bot Autónomo con IA**: Conversa por sí mismo en chats y menciones sin necesidad de prefijos ni comandos.

### 3. 💼 CRM de Prospectos (Leads) con Exportación CSV
- Captura automática de interesados cuando un cliente escribe su correo, teléfono o solicita información comercial.
- Tabla interactiva con filtro por estado (*Nuevo*, *Contactado*, *Ganado*, *Perdido*).
- Botón **Descargar Excel (CSV)** con 1 clic.

### 4. 🛍️ Catálogo Digital de Productos & Servicios
- Registra productos con foto, categoría, precio y moneda.
- Comando automático en WhatsApp **`#catalogo`**: el bot genera y envía el menú interactivo con precios.

### 5. 🕒 Horarios Comerciales y Transferencia a Humano (Human Handoff)
- **Horarios de Atención**: Define días y horas laborales. Fuera de horario, el bot envía un mensaje automático de cortesía.
- **Transferencia a Asesor Humano**: Si el cliente escribe `#asesor`, `#humano` o `#soporte`, el bot le avisa y **pausa sus respuestas automáticamente** durante el tiempo configurado para permitir atención personalizada.

### 6. 💬 Simulador de Chat Estilo WhatsApp (Playground)
- Ventana interactiva en el navegador que simula una conversación con el bot.
- Evalúa tanto las reglas dinámicas personalizadas como la IA antes de conectar un número real.

### 7. 🎯 Creador de Reglas y Funciones Dinámicas (Sin Código)
- Crea comandos personalizados (`#promo`), texto exacto o palabras clave.
- Variables dinámicas: `{user}` (etiqueta al usuario), `{name}` (nombre), `{date}`, `{time}`, `{bot}`.

### 8. ☁️ Sincronización en Tiempo Real con Supabase
- Sincroniza en la nube: bots, logs de actividad, prospectos, catálogo, reglas, usuarios y grupos.
- Script SQL listo para ejecutar en `supabase/schema.sql`.

---

## 🚀 Inicio Rápido en Windows

Simplemente haz doble clic en el archivo:
👉 **`iniciar.bat`**

Este archivo verificará dependencias, iniciará el servidor y abrirá `http://localhost:3000` en tu navegador automáticamente.

---

## 🛠️ Ejecución Manual

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor
npm start
```

Panel disponible en: **`http://localhost:3000`**

---

## 📱 Cómo Vincular un Bot de WhatsApp

1. Abre el panel en `http://localhost:3000`.
2. Haz clic en **`+ Nuevo Bot`**.
3. Elige la **Faceta** (*Recreativo, Asistente, Asesor, IA Autónoma*) y nómbralo.
4. En la tarjeta creada, haz clic en **`Escanear QR`**.
5. Abre **WhatsApp** en tu teléfono > **Dispositivos vinculados** > **Vincular dispositivo** y escanea el código en pantalla.
6. ¡Listo! El bot cambiará su estado a **En Línea** y comenzará a responder.
