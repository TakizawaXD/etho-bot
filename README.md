# ETHO MULTI-BOT HUB & DASHBOARD PRO

Sistema integral de WhatsApp: **Backend (Node.js 22.13+ y Baileys Multi-Instancia) + Frontend Web Reactivo SaaS + Base de Datos en Supabase (PostgreSQL) + SQLite Local Nativo**.

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

## 📁 Estructura del repositorio

```
src/
  index.js          Punto de entrada (servidor + bots)
  server.js         API REST, SSE y autenticación
  manager.js        Gestor multi-instancia de Baileys
  handler.js        Procesamiento de mensajes
  db.js             SQLite (node:sqlite) + espejo Supabase
  commands/         Comandos por categoría
  lib/              IA, auth, planes, facturación, tickets, mantenimiento, utilidades
  routes/           Rutas de pagos y de tickets
  web/public/       Frontend (único origen: index.html, app.js, style.css, PWA)
scripts/            check.js (valida comandos), banner.js
supabase/           schema.sql
docs/DEPLOY.md      Guía de despliegue
```

## 💬 Estilo de los mensajes

- **Respuestas de IA:** se convierten al formato nativo de WhatsApp (`*negrita*`, `_cursiva_`, viñetas `•`), sin títulos `#`, tablas ni `**`. Está en `src/lib/format.js`.
- **Envío natural:** el bot muestra "escribiendo…" con una pausa proporcional al largo y parte los textos largos por párrafos.
- **Comandos:** encabezado compacto (`*🎵 #play* · _Multimedia_`) definido en `skin()` de `src/lib/ui.js`; los separadores (`SEP_*`) están ahí mismo.
- **Tono:** el prompt pide respuestas breves (2 a 5 líneas), máximo 2 emojis y una sola pregunta de cierre.
- **Menú y avisos:** formato compacto (una línea por comando) y tarjetas uniformes con `card()` en `src/lib/ui.js`. Los errores técnicos ya no se muestran en el chat (solo en los logs).
- **Comunicación de la IA** (`src/lib/ai-quality.js`): protocolo de 10 reglas (directo, sin repetir saludos, una sola pregunta, no inventar datos), responde en el idioma de la persona, resiste intentos de cambiarle las instrucciones, recorta historiales largos, corta siempre en una oración completa y usa un disyuntor para no esperar a proveedores caídos.
- `npm test` valida formato, IA, mensajes, planes, pagos, rutas y mantenimiento.

## 💳 Planes, pagos y soporte

- **Cuenta gratuita:** 7 días de uso y máximo 3 bots. Más tiempo o más bots requiere un plan de pago.
- **Pagos:** tarjeta con Stripe Checkout (activación solo por webhook firmado) y transferencia con aprobación manual. Ver **[docs/PAYMENTS.md](docs/PAYMENTS.md)**.
- **Tickets:** botón *Reportar error* en la landing (sin cuenta) y bandeja *Soporte & Tickets* en el panel.
- **Ideas a futuro:** [docs/ROADMAP.md](docs/ROADMAP.md).

## ✅ Producción

Antes de abrir al público revisa **[docs/PRODUCTION.md](docs/PRODUCTION.md)** y ejecuta `BASE_URL=https://tu-dominio.com npm run smoke` contra tu servidor desplegado.

## ☁️ Despliegue

Consulta **[docs/DEPLOY.md](docs/DEPLOY.md)** (Render, Railway, Docker/VPS y PM2).

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

En el primer arranque se crea el usuario admin; si no defines `ADMIN_PASSWORD` en `.env`, la contraseña generada aparece en la consola.

Panel disponible en: **`http://localhost:3000`**

---

## 📱 Cómo Vincular un Bot de WhatsApp

1. Abre el panel en `http://localhost:3000`.
2. Haz clic en **`+ Nuevo Bot`**.
3. Elige la **Faceta** (*Recreativo, Asistente, Asesor, IA Autónoma*) y nómbralo.
4. En la tarjeta creada, haz clic en **`Escanear QR`**.
5. Abre **WhatsApp** en tu teléfono > **Dispositivos vinculados** > **Vincular dispositivo** y escanea el código en pantalla.
6. ¡Listo! El bot cambiará su estado a **En Línea** y comenzará a responder.
