# Tasks

> Pruebas de lógica pura: `node --test --experimental-strip-types tests/visitas/*.test.ts` (Node 22, sin dependencias nuevas). Los módulos puros de `src/lib/visitas/` usan sólo imports relativos para poder probarse así.

## 1. Datos y ajustes

- [ ] 1.1 Agregar a `prisma/schema.prisma` los modelos `Visita`, `PerfilMatricula` y `AvisoGuardia` con sus índices (design D2) y crear la migración con `./node_modules/.bin/prisma migrate dev --create-only`; verificar que el SQL sólo crea tablas e índices nuevos y que `prisma generate` compila.
- [ ] 1.2 Crear `src/lib/visitas/ajustes.ts`: valores por defecto con su porqué (`MODO_ACCESO` CERRADO; tipos Delivery 15 / Servicio 120 / Obra 480 / Visita 180; avisos y umbrales; hora de corte 05:00; rutina 4 días / 30 min; ventana de perfil 30 días; antirrebote 60 min), lectura de `Setting` con caché de 30 s y validación de los JSON; verificar con `tests/visitas/ajustes.test.ts` (JSON roto o ausente → defaults; valores fuera de rango → acotados).

## 2. Cálculos puros (perfiles, rutinas, presentación)

- [ ] 2.1 `src/lib/visitas/calculos.ts`: mediana y p90 de permanencias, rutina a partir de las primeras entradas por día (días de semana, minuto medio, desvío, mínimo de días y desvío máximo), clase de la matrícula y "fuera de rutina" (día no habitual o a más de X min); verificar con `tests/visitas/calculos.test.ts` usando los casos medidos (06:48–06:53 lun–vie → "lun a vie · 06:50 ±2 min"; 3 días → Ocasional; sólo salidas → soloCalle).
- [ ] 2.2 `src/lib/visitas/presentacion.ts`: texto y tono de una lectura según modo + registrado + lista negra (D10) y textos de cada aviso con su motivo; verificar con `tests/visitas/presentacion.test.ts` que en ABIERTO nunca sale "Permitido"/"Denegado" y en CERRADO sale como hoy.

## 3. Motor de visitas y avisos

- [ ] 3.1 `src/lib/visitas/registro.ts: estaRegistrada(plate)` (padrón, visita en curso, invitación vigente, lista blanca) y helpers para abrir/cerrar/extender visitas y para crear avisos con antirrebote en base (D6); verificar en el CT con un script de una sola vez sobre una matrícula de prueba que dos avisos iguales seguidos dejan uno solo.
- [ ] 3.2 `src/lib/visitas/motor.ts: alLeerMatricula(lectura)` según D5 (salida → cierra; entrada → invitación abre visita, fuera de rutina, primera vez de noche, da vueltas, entró sin registrarse en ABIERTO; interior → visto adentro), sin bloquear y con su propio `try/catch`; engancharlo en `src/app/api/notifications/event/route.ts` y `src/lib/paso-por-acceso.ts`; verificar con `POST /api/notifications/event` simulado (token interno) que una salida de una matrícula con visita la cierra con `cierre=CAMARA_SALIDA`.
- [ ] 3.3 Emitir por `avisarPorSocket` los eventos `visita` (alta, cambio, cierre) y `aviso_guardia` (nuevo, atendido); verificar con un cliente socket.io de prueba que llegan al registrar una visita y al cerrarla.
- [ ] 3.4 `src/lib/visitas/perfiles.ts: recalcularPerfiles()` con la consulta agregada en hora del barrio (D4) y `upsert` de lo que cambió; verificar en el CT que corre en < 5 s sobre la base real y que las rutinas medidas (p. ej. SES0500 lun–vie 06:50) salen igual.
- [ ] 3.5 Ruta `GET /api/visitas/tick` con `x-tracking-token` (D8): vencidas → `VISITA_EXCEDIDA`, p90 superado → `PERMANENCIA_INUSUAL`, cierre `FIN_DEL_DIA` a la hora de corte, perfiles cada 10 min; agregarla a las rutas internas del middleware; verificar con `curl` (401 sin token, 200 con token) y que una visita vencida genera un solo aviso aunque el tick corra varias veces.

## 4. Consola del guardia

- [ ] 4.1 `src/app/actions/visitas.ts` (sesión con permiso `guardia`): registrar, cerrar, extender, listar en curso, listar lotes (de `Unit`, con el nombre del mapa), listar avisos pendientes, atender aviso; verificar que sin sesión devuelven error y con sesión crean/actualizan las filas.
- [ ] 4.2 En `src/app/guard/GuardConsole.tsx`: botón "Registrar visita" (tipos en botones grandes, lote con buscador, matrícula/nombre/empresa opcionales), lista "En el barrio" con cuenta atrás, Extender +5/+10/+15 y Cerrar, y bandeja de avisos con Atendido, en tiempo real por el socket; verificar en el navegador como tablet (Playwright con `hasTouch`) que registrar un Delivery lo muestra con 15:00 corriendo y que Atendido lo saca de pendientes.

## 5. Monitor LPR

- [ ] 5.1 `/api/monitor/lpr`: `modo`, contadores según modo (ABIERTO: todas las entradas/salidas y "No registrados"), `enBarrio` (visitas en curso + no registrados de hoy sin salida, `estimado: true`) y avisos pendientes en `atencion` (en ABIERTO reemplazan al merodeo calculado); `/api/monitor/lpr/lectura/<id>` suma `perfil` y `registrada`; verificar con `curl` y un enlace de pantalla LPR que ambas responden 200 con los campos nuevos y que en CERRADO la respuesta de contadores no cambia.
- [ ] 5.2 `VistaLpr.tsx`: vocabulario por modo con `presentacion.ts`, columna "En el barrio ahora" (cuenta atrás en el cliente, ámbar en el último 20 %, rojo excedida, "~40 min (estimado)" para no registrados), avisos con su motivo en Atención (tocables → ficha), y en la ficha el bloque Perfil con la franja de rutina 7 × 24; escuchar `visita` y `aviso_guardia`; verificar con Playwright en 1280×800 y 800×1280 (táctil) y en 1920×1080 sin toque.

## 6. Panel

- [ ] 6.1 Ajustes → "Visitas y patrones" (modo de acceso con su explicación, tipos y tiempos, cada aviso con su interruptor y umbral, hora de corte) con las piezas del sistema de diseño; verificar que guardar cambia el comportamiento sin reiniciar (cambiar a ABIERTO → el monitor pasa a "Registrado / No registrado").
- [ ] 6.2 `/admin/visitas` (permiso `guardia`, entrada en el menú): tabla de visitas del día (tipo, lote, entra, sale, duración, cómo cerró, quién registró) y tabla de avisos (tipo, motivo, estado, quién atendió), con `ui/tabla`, filtros y estados de carga/vacío/error; verificar 200 y que una visita registrada desde la consola aparece.
- [ ] 6.3 Documentar en el doc del proyecto `claude/visitas-y-patrones.md`: modos, tipos, avisos y umbrales, cómo se calcula cada patrón, límites medidos (45 % de salidas leídas, tránsito de calle, motos) y la línea de cron del tick; verificar que el doc nombra cada ajuste tal como aparece en Ajustes.

## 7. Despliegue y verificación integrada

- [ ] 7.1 Desplegar: `./node_modules/.bin/prisma migrate deploy`, build en segundo plano (`BUILD_EXIT=0`), `pm2 restart omniaccess-web --update-env`; agregar el cron del tick en el CT; poner San Nicolás en ABIERTO; verificar HTTP 200 de `/monitor/lpr`, `/guard`, `/admin/visitas`, `/admin/settings?seccion=visitas`, `/api/monitor/lpr`, `/api/visitas/tick` (con token).
- [ ] 7.2 Prueba de punta a punta en producción con una matrícula conocida: registrar Delivery desde la consola → aparece en el monitor con cuenta atrás → la cámara de Salida la lee (o se simula la lectura) → la visita se cierra y desaparece; registrar otra y dejarla vencer → un solo aviso en consola y monitor, sin WhatsApp; atenderlo.
- [ ] 7.3 Revisar los avisos de las primeras 24 h con los umbrales por defecto y ajustar los que hagan ruido; anotar el resultado (cuántos de cada tipo) en `claude/visitas-y-patrones.md`.
