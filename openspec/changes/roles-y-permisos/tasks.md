# Tasks

## 1. Catálogo

- [ ] 1.1 `src/lib/permisos.ts`:
  - el catálogo de design §1, con `modulo`, `seccion`, `nivel`, `delicado`, `descripcion` y `rutas`;
  - `MODULOS` en orden; `normalizarPermisos` (niveles + traducción de lo viejo, design §2–3);
  - `permisosDeSesion` normaliza;
  - `PLANTILLAS_ROL` (Supervisor, Operador de monitoreo, Guardia de garita, Técnico, Administración del barrio, Auditor), ninguna con `accesos` ni `mantenimiento`.
  - Verificación: `tsc` limpio.
- [ ] 1.2 `tests/permisos.test.ts`:
  - cobertura: cada `page.tsx` de `src/app/admin` y `src/app/monitor` pide permiso o está en `PAGINAS_LIBRES`;
  - traducción: cada clave vieja sigue abriendo sus rutas de antes (lista fija en la prueba, copiada del catálogo del 7/10);
  - niveles: Operar y Configurar arrastran Ver;
  - ninguna plantilla tiene un permiso delicado de Administración.
  - Verificación: `node scripts/probar.js` en verde.
- [ ] 1.3 `scripts/permisos-roles.js` (idempotente): normaliza `AppRole.permisos` y escribe qué cambió por rol; la segunda corrida no cambia nada. `desplegar.sh` lo corre después de las migraciones.
  - Verificación: dos corridas en el lab; la segunda dice «nada que cambiar».

## 2. Aplicación en el servidor

- [ ] 2.1 `src/lib/permiso-servidor.ts`:
  - `exigirPermiso(clave)` para acciones y `rechazoPorPermiso(clave)` para rutas;
  - registro `[permisos]` y modo `OMNI_PERMISOS_SOLO_AVISAR`;
  - los diez `exigir*` copiados (franja, monitores, destino-eventos, estacionamiento, procesos, visitas, compartir, clips-telegram, clips, empresas, accesos, contador-fila) pasan a usarla con la clave nueva que corresponda.
  - Verificación: prueba unitaria con sesión con y sin el permiso, y en sólo avisar.
- [ ] 2.2 `src/lib/permisos-acciones.ts`: la clasificación de los 62 archivos de `src/app/actions` (defecto, patrón de lectura, excepciones). Incluye `secreto` para `getSetting` y las lecturas de ajustes, con `lib/ajustes-secretos.ts`.
  - Prueba: cada `export async function` de `src/app/actions` queda en anónima, de guardia, lectura o con permiso, y todo permiso existe en el catálogo.
- [ ] 2.3 `src/lib/permisos-api.ts`: la tabla de prefijos, métodos y permiso para las rutas de `/api` que no son públicas.
  - Prueba: cada `route.ts` con POST, PUT, PATCH o DELETE queda cubierta por la tabla, por la lista pública del middleware o por un chequeo propio declarado.
- [ ] 2.4 `src/middleware.ts`:
  - `puertaDeAcciones` también con sesión (design §5);
  - el bloque de API consulta `permisos-api`;
  - la sesión de pantalla y la de guardia, sin cambios.
  - Verificación: en el lab, con un usuario de rol Operador, invocar `updateSetting` y POST `/api/centrales/eventos/<id>` → 403 con el permiso que falta. Con sólo avisar → pasa y queda en el registro.
- [ ] 2.5 Defensa adentro: `exigirPermiso` explícito en `restoreBackup`, `downloadBackup`, `updateDatabaseUrl`, `runDatabaseMigrations`, `populateDatabase`, `purgeAccessEvents`, `deleteAllUsers` y `saveAdmin` (`mantenimiento` o `accesos`); en `tratarEvento`, `saltearPaso` y tomar (`hub.tratar`); y en armar y desarmar (`centrales`, ya existe).
  - Verificación: las pruebas de centrales siguen pasando; una prueba nueva para tratar sin permiso.

## 3. Menú y pantallas

- [ ] 3.1 `admin/layout.tsx`: cada entrada del menú pregunta por su clave nueva (Monitor LPR → `lpr`, CCTV → `video`, Gestión de alarmas → `alarmas` o `hub` o `intrusion`, OmniVision → `vision`, Auditoría → `auditoria`, Consolas → `guardia.puestos`, …).
  - Verificación: con el rol Operador traducido, el menú es el mismo que antes.
- [ ] 3.2 `admin/alarmas/page.tsx`: cada grupo se ve si la sesión tiene su permiso (LPR → `lpr`, Intrusión → `intrusion` o `vision`, Alarm Hub → `hub`). Los botones de atender piden `alarmas.atender`; los de tratar, `hub.tratar`.
- [ ] 3.3 Botones que hoy aparecen siempre y que el servidor ahora corta: se esconden o se deshabilitan con la explicación (`Pista`) cuando falta el permiso.
  - Pantallas: Personas, Unidades, Vehículos, Dispositivos, Grupos, Monitores (crear enlace), ficha de evento (tratar), Ajustes → Mantenimiento.
  - Verificación: recorrer con un rol de sólo ver; no queda ningún botón que termine en error.

## 4. Accesos

- [ ] 4.1 `AccesosSection.tsx` → Roles: la matriz de design §8 (módulo × nivel, prender el módulo o el nivel entero, Ver bloqueado mientras haya Operar o Configurar, `Pista` en cada celda, marca de delicado, resumen arriba, estado del módulo en la instalación).
  - Verificación: vista previa en claro y oscuro y a 1440 px.
- [ ] 4.2 Plantillas al crear un rol; duplicar sigue igual.
- [ ] 4.3 `accesos.ts`:
  - auditoría de roles y usuarios del sistema (design §9), con lo que se sumó y lo que se sacó;
  - no dejar la instalación sin nadie con `accesos`.
  - Verificación: prueba del último administrador; la auditoría aparece en `/admin/audit`.
- [ ] 4.4 `auth.ts`: ENTRAR y ENTRAR_FALLIDO en `AccionSistema`. Usuarios muestra la última entrada y el resumen por módulo, y se filtra por rol.

## 5. Cierre

- [ ] 5.1 `tsc --noEmit`, `node scripts/probar.js` y `node scripts/probar-dc09.js` en verde. Desplegar en el lab con `OMNI_PERMISOS_SOLO_AVISAR=1` y correr `scripts/permisos-roles.js`.
- [ ] 5.2 Recorrer el lab con un rol Operador y con uno de cada plantilla, y vaciar el registro de «habría rechazado» corrigiendo la clasificación. Después sacar el modo sólo avisar y repetir.
- [ ] 5.3 Documentar en el proyecto (`claude/roles-y-permisos.md`): el catálogo, la traducción, cómo se clasifica una acción o una ruta nueva, y el modo sólo avisar.

## Workflow follow-up

- San Nicolás sólo cuando Nico lo diga: leer antes sus roles (sólo lectura) y confirmar la traducción.
- Alcance por área: propuesta aparte (design, Open Questions).
