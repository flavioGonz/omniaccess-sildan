# Conectar el módulo de WhatsApp de Ajustes con el motor WAHA

## Why

El motor de WhatsApp del barrio (contenedor Docker **WAHA**, `devlikeapro/waha`, en
`127.0.0.1:3000`) ya está corriendo y el envío de avisos funciona, pero el panel de
**Ajustes → WhatsApp** (`/admin/settings`) quedó, tras el merge del primer barrio, leyendo claves
`WAHA_*` que en esta instancia no existen —la configuración real vive en claves `OPENWA_*`—,
así que el panel se ve **desconectado** y no se puede ver el estado de la sesión, el QR ni
editar la configuración desde la interfaz.

## What Changes

- El panel de Ajustes → WhatsApp lee y escribe la **misma fuente de verdad** que usa el resto
  del sistema (`getWhatsAppConfig()` / claves `OPENWA_*`), en lugar de claves `WAHA_*` sueltas.
- El panel muestra el **estado real de la sesión WAHA** (conectada / necesita QR / inalcanzable),
  el **QR en vivo** cuando hay que vincular, y el número vinculado.
- Se unifica el nombre de las claves de configuración de WhatsApp para que la UI, los webhooks y
  el worker de despacho no difieran (sin romper lo que hoy anda).
- Limpieza: se quitan los comentarios de IA pegados por error dentro de `settings/page.tsx`.
- **No BREAKING**: no se cambia el motor (sigue WAHA) ni se tocan los avisos que ya funcionan.

## Capabilities

### New Capabilities
- `whatsapp` — integración de WhatsApp del barrio (configuración, estado de sesión, QR,
  allowlist y envío). Comportamiento durable del sistema, no sólo este arreglo.

### Modified Capabilities
- (ninguna: no hay specs previas; es la primera capability)

## Impact

- Código: `src/app/admin/settings/page.tsx` (componente `WhatsAppSection`), posiblemente
  `src/lib/whatsapp.ts` (unificar claves) y `src/app/actions/settings.ts` (`testWahaConnection`,
  `getWahaHistory`). Rutas `src/app/api/wa/{status,qr,session}` ya usan `getWhatsAppConfig()` y
  quedan como están.
- Datos: claves en la tabla `Setting` (`OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION`,
  `WHATSAPP_ALLOWLIST*`, `CHATBOT_ENABLED`). No se tocan datos de residentes.
- Infra: ninguna — WAHA ya está desplegado. Sólo build + `pm2 restart` de la app al aplicar.
