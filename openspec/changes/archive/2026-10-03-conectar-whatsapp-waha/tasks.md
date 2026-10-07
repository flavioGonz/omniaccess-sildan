# Tareas — conectar-whatsapp-waha

## 1. Confirmar estado del motor
- [ ] 1.1 Verificar sesión WAHA en vivo: `GET /api/wa/status` (estado, número vinculado) y, si no
  está vinculada, que `GET /api/wa/qr` devuelva el QR.

## 2. UI: fuente única en el panel de Ajustes
- [ ] 2.1 En `WhatsAppSection` (`settings/page.tsx`), reemplazar las lecturas crudas
  `getSetting("WAHA_URL"/"WAHA_API_KEY"/"WAHA_COMMANDS")` por las claves canónicas `OPENWA_*`
  (con respaldo a `WAHA_*` para no romper el primer barrio).
- [ ] 2.2 Guardar desde el panel escribe `OPENWA_*`; confirmar que `getWhatsAppConfig()` devuelve
  lo guardado.
- [ ] 2.3 Mostrar estado de sesión y QR usando las rutas `/api/wa/*` existentes.
- [ ] 2.4 Verificar la edición de `WHATSAPP_ALLOWLIST` y `CHATBOT_ENABLED` desde el panel.

## 3. Limpieza
- [ ] 3.1 Quitar el comentario de IA pegado dentro de `settings/page.tsx`.

## 4. Verificación
- [ ] 4.1 `tsc --noEmit` y `npm run build` sin errores nuevos (en la nube).
- [ ] 4.2 Desplegar (build + `pm2 restart`) y comprobar en `https://sannicolas.ies.com.uy/admin/settings`:
  panel conectado, estado/QR visibles, guardar persiste, aviso de prueba llega al número de la allowlist.
- [ ] 4.3 Confirmar que el despacho de avisos que ya funcionaba sigue funcionando (no regresión).
