# Tasks

## 1. Funciones de instalación

- [ ] 1.1 `lib/funciones.ts`:
  - agregar `alcance: "modulo" | "instalacion"` (modulo opcional en las de instalación);
  - agregar `FUNC_INTRUSION` (defecto true), `FUNC_ALARMAS_RECEPCION` (false) y `FUNC_ALARMAS_GESTION` (false, requiere recepción), cada una con su «qué» y su «si se apaga»;
  - las funciones de matrículas siguen igual.
  - Verificación: test en `tests/funciones.test.ts` sobre `dependenciaCumplida` para gestión sin recepción, y `tsc` limpio.
- [ ] 1.2 `actions/funciones.ts`:
  - `toggleFuncion` audita quién y cuándo, y rechaza prender una función cuya dependencia está apagada;
  - nuevo helper de servidor `exigirFuncion(id)`, que devuelve 404 `{ error: "función apagada" }`.
  - Verificación: test del helper con la función apagada y prendida.
- [ ] 1.3 `scripts/funciones-instalacion.js`, idempotente: escribe las tres claves si faltan (Intrusión true; Recepción y Gestión true sólo si hay `CentralAlarma`). `desplegar.sh` lo corre después de las migraciones.
  - Verificación: correrlo dos veces en el lab; la segunda no cambia nada y el log lo dice.
- [ ] 1.4 `ModosSection.tsx`: sección «Funciones de la instalación», debajo de las capas y arriba de las funciones de Matrículas. Cada función muestra qué hace y qué deja de pasar, y Gestión aparece deshabilitada con el motivo cuando Recepción está apagada. Usa `fijarFuncion` para que el panel cambie sin recargar.
  - Verificación: vista previa en claro y oscuro; prender y apagar en el lab sin recargar.

## 2. Que todo obedezca a las funciones

- [ ] 2.1 `admin/layout.tsx`:
  - Monitor Intrusión depende de `FUNC_INTRUSION` en cualquier modo;
  - Gestión de alarmas se ve con Intrusión o Recepción;
  - `AlertaIntrusionGlobal` se monta con Intrusión y `AlertaCentralGlobal` con Gestión.
  - Verificación: en el lab, modo Filas con Intrusión prendida muestra el menú; apagarla lo saca sin recargar.
- [ ] 2.2 Rutas con `exigirFuncion`:
  - Intrusión: `/api/monitor/intrusion*` y `/api/monitor/alarmas`;
  - Recepción: `/api/centrales*` (alta, zonas, mensajes);
  - Gestión: `/api/centrales/eventos*` y `/api/monitor/centrales`.

  `/admin/alarmas` oculta la pestaña Centrales sin Recepción; Dispositivos no ofrece dar de alta centrales sin Recepción.
  - Verificación: curl con sesión a cada ruta con su función apagada → 404.
- [ ] 2.3 `POST /api/notifications/event`: con `FUNC_INTRUSION` apagada, descartar los eventos INTRUSION que no son de central y contestar 200 `{ omitido }`.
  - Verificación: test de la ruta con un cruce de línea, y log de `server.js` sin errores 4xx/5xx.
- [ ] 2.4 `lib/monitor/vistas.ts`: campo `funcion` en Intrusión (`FUNC_INTRUSION`) y Alarmas (`FUNC_ALARMAS_GESTION`).
  - Monitores y la rotación las filtran.
  - `/monitor/[vista]` muestra «Esta vista está apagada en la instalación» y reintenta cada 60 s.
  - Verificación: vista previa del cartel; en el lab, apagar Gestión y ver que la pared Alarmas cambia sola.
- [ ] 2.5 `alarm-receiver.js`: sondea `FUNC_ALARMAS_RECEPCION` y `FUNC_ALARMAS_GESTION` cada 15 s.
  - Recepción apagada → cerrar TCP DC-09, UDP y TCP CMS; prendida → volver a escuchar.
  - Gestión apagada → registrar el mensaje y avisar por reglas, sin crear la `Detection` CENTRAL ni las fotos.
  - Si la consulta falla, se queda en el último estado.
  - Verificación: `scripts/probar-dc09.js` sigue pasando (27); en el lab, `nc -z` al 10010 cierra y abre en menos de 30 s; un evento del simulador con Gestión apagada queda en el registro sin alarma.
- [ ] 2.6 Verificación de punta a punta: las ocho combinaciones de las tres funciones en el lab, con el simulador y una cámara de intrusión, comparadas contra los escenarios de `specs/funciones-instalacion/spec.md`. El resultado se anota en el doc del proyecto.

## 3. Cámaras del abonado y de la zona

- [ ] 3.1 Migración aditiva `CentralAlarma.camaras TEXT[] DEFAULT '{}'`, comentada con `///` en `schema.prisma`.
  - Verificación: `prisma migrate deploy` en el lab sin errores y `\d "CentralAlarma"` con la columna.
- [ ] 3.2 `lib-centrales-camaras.js` (CommonJS) + `lib/centrales/camaras.ts` (tipado):
  - `camarasDeZona`, que resuelve zona → área → abonado con `origen` (equipos y canales `nvrch-<nvr>-<ch>`, tope 4);
  - `camarasDelAbonado`;
  - para cada cámara, su stream y su grabador (`resolveForCamera` o el NVR del canal).
  - Verificación: `tests/camaras-centrales.test.ts` con una zona con cámaras elegidas, otra sólo con área, otra sin nada, y un canal de NVR.
- [ ] 3.3 Selector de cámaras con equipos más canales de NVR (la misma fuente que el Monitor CCTV), agrupado por área, con las del área de la central primero.
  - Verificación: en el lab aparecen los canales de NVR que no son equipo.
- [ ] 3.4 `CajonCentral.tsx`:
  - pestaña Cámaras del abonado;
  - en Zonas, cada zona dice qué cámaras usa y de dónde salen («elegidas», «del área X», «del abonado», «ninguna»).
  - Verificación: vista previa; guardar y releer en el lab.
- [ ] 3.5 `alarm-receiver.js`: usar `camarasDeZona` para las fotos del momento y para `camaras` del aviso `general_detection`, que pasa a enviar `{ id, nombre, stream }`. `VistaAlarmas` acepta la forma vieja (strings) y la nueva.
  - Verificación: un evento del simulador en una zona sin cámaras elegidas y con área trae las fotos de las cámaras del área.

## 4. Video verificación

- [ ] 4.1 `components/centrales/VerificacionVideo.tsx`:
  - grilla en vivo (`Vivo`/`vivoDe`, códec convertido si hace falta, foto a los 12 s con el rótulo «foto»);
  - «Ver el momento» por cámara con `VerGrabacion` (`instanteMs` del evento, «antes» de `FICHA_CLIP_ANTES_SEG`), o «sin grabador»;
  - tira «Otras cámaras del abonado»;
  - modo `soloLectura`.
  - Verificación: vista previa con 1, 2 y 4 cámaras, una sin video, y una sin grabador.
- [ ] 4.2 `/api/centrales/eventos/[id]` y `/api/monitor/centrales` devuelven `camaras` (con `origen`) y `otras`, resueltas con `camarasDeZona` y `camarasDelAbonado`.
  - Verificación: curl en el lab con un evento del simulador.
- [ ] 4.3 `FichaEventoCentral.tsx`: reemplazar `Camaras` (la foto cada 5 s) por `VerificacionVideo`.
  - Verificación: en el lab, abrir un evento y ver el vivo; «Ver el momento» reproduce desde N s antes en una cámara de NVR.
- [ ] 4.4 `VistaAlarmas.tsx`: reemplazar `VideoZona` por `VerificacionVideo` en `soloLectura`, sin botones de decisión.
  - Verificación: vista previa; en el lab, con enlace de pantalla, el vivo y la grabación funcionan y no hay forma de tomar ni de tratar.

## 5. Procedimientos por clase

- [ ] 5.1 `tratamiento-tipos.ts`:
  - `CENTRALES_PROCEDIMIENTOS` por clase (`{ texto, obligatorio }[]` o `null`);
  - `CENTRALES_PROCEDIMIENTO` por prioridad admite `{ texto, obligatorio }` además de strings;
  - `procedimientoDe(clase, prioridad)` devuelve los pasos y el origen.
  - Verificación: tests de lectura de lo guardado hoy (strings), de clase con lista, de clase en `null`, y de tope de 12 pasos.
- [ ] 5.2 El servidor guarda en `details.procedimiento` la instantánea (pasos y origen) la primera vez que arma el evento (ver design §8). Sin instantánea, un evento viejo resuelve con lo vigente y se guarda.
  - Verificación: un evento del simulador trae la instantánea; cambiar el ajuste no cambia ese evento.
- [ ] 5.3 `tratamiento.ts`:
  - acción `PASO_PROC_SALTEO` con motivo (mínimo 4 letras), sólo para quien tiene el evento;
  - `tratarEvento` devuelve 409 con los pasos obligatorios faltantes.
  - Verificación: tests de tratar con un obligatorio sin tildar (409), salteado con motivo (ok) y salteado sin motivo (400).
- [ ] 5.4 `FichaEventoCentral.tsx`:
  - pasos con su estado (pendiente, hecho o salteado), quién y hace cuánto;
  - «Saltear» con el motivo;
  - TRATAR dice qué falta;
  - el origen del procedimiento a la vista.
  - Verificación: vista previa y prueba en el lab con un Robo del simulador.
- [ ] 5.5 `PrioridadesCentralesSection.tsx` → Procedimiento:
  - editor por clase y por prioridad, con orden, marca de obligatorio y «usar el de su prioridad»;
  - los textos por defecto quedan vacíos (Nico los completa).
  - Verificación: guardar, recargar y ver lo mismo; tratar un evento nuevo con la lista nueva.
- [ ] 5.6 `/api/monitor/centrales` + `VistaAlarmas`: avance del procedimiento de la alarma al frente (hechos/total, faltantes, quién). Se actualiza con `alarma_gestion`.
  - Verificación: tildar un paso en el panel y verlo en la pared en menos de 2 s.

## 6. Cierre

- [ ] 6.1 `tsc --noEmit`, `node scripts/probar.js` y `node scripts/probar-dc09.js` en verde. Desplegar en el lab con `desplegar.sh`, correr `scripts/funciones-instalacion.js` y reiniciar `alarm-receiver`.
  - Verificación: `DESPLIEGUE_OK` en `/tmp/despliegue.log` y `pm2 list` con todo `online`.
- [ ] 6.2 Actualizar los docs del proyecto `claude/monitores.md` y `claude/alarm-hub-implementado.md`: funciones, cámaras zona → área → abonado, video verificación y procedimientos por clase.
  - Verificación: los docs nombran las claves de `Setting`, las rutas y los procesos que hay que reiniciar.

## Workflow follow-up

- Pasar a San Nicolás sólo cuando Nico lo diga (con el mismo script de funciones, que dejará prendido lo que hoy funciona allá).
- Archivar con `/opsx:archive` cuando esté validado, y avisar en `centro-de-monitoreo` que la verificación en vivo y en grabación quedó cubierta acá (el clip automático del caso sigue allá).
