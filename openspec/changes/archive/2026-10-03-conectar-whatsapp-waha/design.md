# Diseño — conectar-whatsapp-waha

## Estado actual (medido en el server, 2026-10-03)

- WAHA corre en Docker (`devlikeapro/waha`, `0.0.0.0:3000`, up 3 días).
- `Setting`: `OPENWA_URL=http://127.0.0.1:3000`, `OPENWA_SESSION=default`,
  `OPENWA_API_KEY=omniwa_…`, `WHATSAPP_ALLOWLIST=["099185402"]`,
  `WHATSAPP_ALLOWLIST_ENABLED=true`, `DISPATCH_WHATSAPP_ENABLED=true`, `CHATBOT_ENABLED` (toggle).
- `src/lib/whatsapp.ts` → `getWhatsAppConfig()` lee `OPENWA_*` con respaldo a `WAHA_*`
  (`url = OPENWA_URL || WAHA_URL || env`). Las rutas `src/app/api/wa/{status,qr,session}` ya la
  usan y pegan a la API de WAHA (`/api/sessions/{s}`, `/api/{s}/auth/qr`, header `X-Api-Key`).
- **La falla**: el componente `WhatsAppSection` en `settings/page.tsx` llama directo a
  `getSetting("WAHA_URL")`, `getSetting("WAHA_API_KEY")`, `getSetting("WAHA_COMMANDS")` para
  poblar el formulario. Como esta instancia guardó todo en `OPENWA_*`, el formulario queda vacío y
  parece desconectado.
- Cruft: dentro de `settings/page.tsx` quedó pegado un comentario de IA (instrucciones de edición)
  que no es código.

## Decisión

**No cambiar el motor ni las claves canónicas en runtime** (hoy `OPENWA_*` y el despacho andan).
El arreglo vive en la UI y en el helper:

1. **Fuente única en la UI.** `WhatsAppSection` deja de leer `getSetting("WAHA_*")` crudo y pasa a
   mostrar lo que resuelve el sistema. Para el estado/QR ya existen las rutas `/api/wa/*` (usan
   `getWhatsAppConfig()`); el formulario de configuración lee/escribe las claves canónicas
   `OPENWA_*` (que es lo que `getWhatsAppConfig()` prioriza).
2. **Compatibilidad de claves.** `getWhatsAppConfig()` ya acepta ambas; se mantiene ese respaldo
   para no romper Olivos (que usa `WAHA_*`). La UI guarda en `OPENWA_*` en San Nicolás.
   (Alternativa descartada: migrar todo a `WAHA_*` — obliga a tocar server.js y dispatch-worker y
   arriesga el despacho que hoy funciona, sin beneficio real.)
3. **Limpieza.** Quitar el comentario de IA pegado en `settings/page.tsx`.

## Riesgos y verificación

- Riesgo bajo: sólo cambia una pantalla de administración y, si hiciera falta, el respaldo de
  claves en `getWhatsAppConfig()`. El despacho de avisos no se toca.
- Verificar tras aplicar: el panel muestra estado de la sesión WAHA real; si está sin vincular,
  muestra QR; guardar la config la persiste y `getWhatsAppConfig()` la devuelve; un aviso de prueba
  llega al número de la allowlist. `tsc`/`next build` sin errores nuevos.
