# Design

## Context

El motivo está en proposal.md (Why). Lo que condiciona el cómo:

- **`src/lib/permisos.ts` es puro.** Lo usan el middleware, el layout y Ajustes. Cada permiso tiene `rutas` (prefijos de página), y `permisoDeRuta` elige el prefijo más largo.
- **La sesión es un JWT.** Trae `perms` (copiado del rol al entrar), `rolAppId` y `role`. `permisosDeSesion` devuelve el catálogo entero al Administrador y lo del token a los demás.
- **El middleware ya tiene dos puertas:**
  - `puertaDeAcciones`: sin sesión del panel, sólo pasan las acciones de `lib/acciones-publicas` (ANONIMAS y DE_GUARDIA). Las nombra «archivo#función» y resuelve el id con `server-reference-manifest.json`, porque el id cambia en cada compilación.
  - la API: con sesión válida pasa todo.
- **Hay 482 acciones exportadas en 62 archivos y 196 rutas de API.** Diez archivos tienen su propio `exigirAjustes`/`exigirVideo`/`exigirGuardia` copiado.
- **Otras identidades:** la consola de guardia (cookie `guardia`), los enlaces de pantalla (cookie `pantalla`, sólo lectura y por alcance) y los equipos (tokens propios). Este cambio no las toca.
- **Lab:** dos roles, Administrador (2 usuarios) y Operador (sistema, 0 usuarios). San Nicolás tiene los suyos y no se mira desde acá.

## Goals / Non-Goals

**Goals:**
- Que el catálogo describa OmniAccess como es hoy, por módulo y nivel, y que crecer sea agregar un renglón.
- Que el permiso se cumpla en el servidor con una sola pieza, sin repetir el chequeo en cada archivo.
- Que ningún rol existente pierda nada en el despliegue.
- Que lo no clasificado se note en las pruebas y no en producción.

**Non-Goals:**
- Alcance por área (un rol que sólo ve las alarmas de ciertas áreas): queda para después; ver Open Questions.
- Cambiar la consola de guardia, los enlaces de pantalla o la autenticación (contraseñas, 2FA).
- Bloquear usuarios o vencerles el acceso (pediría columnas nuevas).

## Decisions

### 1. Claves planas con el nivel en el nombre

Cada permiso es una clave plana: `hub` (ver), `hub.tratar`, `hub.config`. El catálogo le agrega a cada una `modulo`, `seccion`, `nivel` (`ver` | `operar` | `configurar`), `delicado` y `rutas`. Las claves que ya existen conservan su nombre con su sentido de «ver» (`historial`, `usuarios`, …) y lo nuevo se suma al lado.

- Por qué: `AppRole.permisos` ya es `String[]` y el JWT ya lleva una lista. Con claves planas no hace falta esquema nuevo, y `incluye(perms, "hub.tratar")` sigue siendo un `includes`.
- Descartado: un objeto `{ seccion: nivel }` por rol. Pide migrar el esquema y cambiar el token, y no deja dar Configurar sin Operar donde tiene sentido (por ejemplo, un técnico que calibra reglas y no atiende alarmas).

El catálogo (48 permisos), con los delicados marcados con ⚠:

| Módulo | Sección | Ver | Operar | Configurar |
|---|---|---|---|---|
| Operación | Gestión de alarmas | `alarmas` | `alarmas.atender` | |
| | Historial y lecturas | `historial` | `historial.exportar`, `grabaciones` (mandaban clips) | |
| | Mapa y seguimiento | `mapa` | | `mapa.editar` |
| | Monitores de pared | `monitores` | | `monitores.config` ⚠ |
| LPR | Monitor LPR | `lpr` | `lpr.operar` | |
| | Lista de vigilancia | | `vigilancia` | |
| | Invitados | `invitados` | `invitados.gestionar` | |
| | Plazas | `plazas` | | `plazas.config` |
| Video | Monitor CCTV y vivo | `video` | | |
| | Grabaciones y clips | | `grabaciones` | |
| | Búsqueda inteligente | `acuseek` | | |
| Intrusión | Intrusión | `intrusion` | `intrusion.atender` | `intrusion.reglas` |
| Alarm Hub | Eventos | `hub` | `hub.tratar` | `hub.config` |
| | Control de centrales | | `centrales` ⚠ | |
| OmniVision | OmniVision | `vision` | | `vision.config` |
| Rostro | Rostro | `rostros` | `rostros.listas` | |
| Filas | Filas | `filas` | | `filas.config` |
| Guardia | Consola y bitácora | | `guardia` | `guardia.puestos` |
| | Visitas y proveedores | | `visitas` | |
| Padrón | Personas | `usuarios` | `usuarios.editar` | |
| | Unidades | `unidades` | `unidades.editar` | |
| | Vehículos y credenciales | `vehiculos` | `vehiculos.editar` | |
| | Grupos de acceso | | | `grupos` |
| Equipos | Dispositivos | `dispositivos` | | `dispositivos.editar` |
| Administración | Ajustes | | | `ajustes` |
| | Notificaciones | | | `notificaciones` |
| | Auditoría | `auditoria` | | |
| | Mantenimiento | | | `mantenimiento` ⚠ |
| | Accesos al panel | | | `accesos` ⚠ |

Rutas de página que cambian o se suman:
- `monitor` se reparte: `lpr` (`/admin/monitor-lpr`), `video` (`/admin/monitor-cctv`), `rostros` (`/admin/monitor-face` y `/admin/dashboard-face`), `filas` (`/admin/monitor-queue`, `/admin/queue` y `/admin/notificaciones-queue`) y `alarmas` (`/admin/alarmas`).
- `/admin/vision` pasa de `ajustes` a `vision`; dentro, `entrenar`, `reglas`, `probar` y `relecturas` piden `vision.config`.
- `/admin/audit` pide `auditoria`.
- `/admin/visitas` pide `visitas`.
- `/admin/mapas` (el editor) pide `mapa.editar`.
- `/admin/consolas` pide `guardia.puestos`.
- `/admin/horarios-filas` y `/admin/calibracion-aforo` piden `filas.config`.

### 2. Dependencias de nivel resueltas al normalizar

(Implementado: una clave que existe en los dos catálogos —`intrusion`, `ajustes`— sólo se traduce en un token sin `pv` o en un rol antes de la migración, marcada con `PERMISOS_VERSION = 2` en Setting; si no, quitarle un nivel a un rol se desharía solo. Gestión de alarmas la abre también quien tiene el Ver de Alarm Hub, Intrusión, LPR u OmniVision: `TAMBIEN_ABREN`.)

`normalizarPermisos(lista)` agrega «Ver» a toda sección donde haya Operar o Configurar, y traduce las claves viejas. Se aplica al guardar un rol, en el script de migración y en `permisosDeSesion` (para los tokens viejos). Así el chequeo es siempre `includes`, y nunca hay que preguntar «¿tiene ver o algo más alto?».

### 3. Traducción de lo viejo: «misma superficie, nada menos»

| Clave vieja | Se traduce a (además de sí misma, si sigue existiendo) |
|---|---|
| `monitor` | `lpr`, `lpr.operar`, `video`, `grabaciones`, `rostros`, `rostros.listas`, `filas`, `alarmas`, `alarmas.atender`, `hub`, `hub.tratar` |
| `intrusion` | `intrusion.atender`, `intrusion.reglas`, `grabaciones` |
| `historial` | `historial.exportar`, `grabaciones` (mandaban clips) |
| `mapa` | `mapa.editar` |
| `invitados` | `invitados.gestionar` |
| `guardia` | `guardia.puestos`, `visitas` |
| `monitores` | `monitores.config` |
| `usuarios` / `unidades` / `vehiculos` | sus `.editar` |
| `plazas` | `plazas.config` |
| `dispositivos` | `dispositivos.editar`, `hub.config` (la central se daba de alta en Dispositivos) |
| `filas` | `filas.config` |
| `ajustes` | `vision`, `vision.config`, `auditoria`, `mantenimiento`, `hub.config`, `intrusion.reglas`, `plazas.config` |

`rostros.listas` y `auditoria` también los reciben los roles con `monitor` o `ajustes`, porque esas pantallas hoy las abre cualquiera. La regla es no sacar nada que se use; recortar lo que sobre lo decide el administrador después, en la matriz.

Una prueba toma cada clave vieja con sus rutas y acciones de antes del cambio y verifica que la traducción las sigue cubriendo.

### 4. Una sola pieza en el servidor: `exigirPermiso`

`src/lib/permiso-servidor.ts` exporta:
- `exigirPermiso(clave)` para acciones: tira un `Error` con el mensaje «hace falta el permiso X»;
- `rechazoPorPermiso(clave)` para rutas: devuelve 404/403 en JSON.

Lee la sesión con `getSession` + `permisosDeSesion` y registra el rechazo. Los diez `exigir*` copiados pasan a usarla.

### 5. La puerta del middleware, ahora también con sesión

- **Acciones.** `puertaDeAcciones` resuelve el nombre de la acción (`archivo#función`) como ya hace y busca su clasificación en `src/lib/permisos-acciones.ts`:
  - `{ archivo: { defecto, lectura?, por? } }`: el permiso por defecto de las acciones del archivo, un patrón de lecturas (por defecto `/^(get|list|leer|buscar|contar|obtener|ver)/`) que basta con sesión, y excepciones por función (`restoreBackup: "mantenimiento"`, `getSetting: "secreto"`, …).
  - Con sesión y sin el permiso: 403, salvo en modo sólo avisar.
  - Sin sesión sigue la regla de `acciones-publicas`, intacta.
- **API.** El bloque «PROTECTED API ROUTES» consulta `src/lib/permisos-api.ts`: una tabla de prefijo, métodos y permiso, donde el prefijo más largo gana. GET basta con sesión salvo que la tabla diga otra cosa; el resto pide su permiso.
- **Defensa en profundidad.** Las acciones más peligrosas también llaman `exigirPermiso` adentro: respaldo, restauración, cambio de base, migraciones, borrado masivo, usuarios del sistema y ajustes con secretos. Así no dependen sólo del middleware: una server action se puede importar desde otra.
- Descartado: poner `exigirPermiso` a mano en las 482 acciones. Es lento, fácil de olvidar y no deja ver de un vistazo qué pide cada cosa. La tabla se revisa en una pantalla y la prueba la completa.

### 6. «Secreto» como clase de lectura

`getSetting(clave)` y las lecturas de ajustes devuelven cualquier `Setting`, también tokens y claves. La clasificación `secreto` exige `ajustes` cuando la clave es secreta: lista en `lib/ajustes-secretos.ts` por patrón (`/TOKEN|SECRET|PASSWORD|CLAVE|API_KEY|DATABASE_URL/`). Cualquier otra clave se lee con sesión. Las pantallas de operación sólo leen ajustes no secretos (se revisa en la tarea de clasificación).

### 7. Modo sólo avisar

`OMNI_PERMISOS_SOLO_AVISAR=1` hace que la puerta registre `[permisos] habría rechazado: <usuario> (<rol>) <acción|ruta> sin <permiso>` y deje pasar. Se usa en el lab mientras se recorre la app con un rol de operador, y se apaga antes de pasar a San Nicolás.

### 8. Editor en matriz

`AccesosSection` → Roles:
- a la izquierda, la lista de roles con su cantidad de usuarios;
- a la derecha, la matriz: módulos como cabeceras con ícono y estado en la instalación (de `getEnabledModules` + `getFunciones`), secciones como filas y tres columnas de nivel;
- celdas con `Pista`, la marca de delicado con `ShieldAlert` en tono aviso, y el resumen arriba;
- «Nuevo rol» abre las plantillas.

Las plantillas son datos en `lib/permisos.ts` (nombre, descripción, permisos) y no se siembran en la base: el administrador crea el rol desde la plantilla y lo ajusta.

### 9. Auditoría

`saveRolApp`, `deleteRolApp`, `duplicarRolApp`, `saveUsuarioSistema` y `deleteUsuarioSistema` escriben en `AccionSistema` (`accion`: ROL_CREAR, ROL_EDITAR, …) con un detalle que dice qué permisos se sumaron y cuáles se sacaron. `login` escribe ENTRAR, o ENTRAR_FALLIDO con el usuario intentado. La última entrada de cada usuario sale de ahí.

## Risks / Trade-offs

- [Una acción que usa un operador queda clasificada con un permiso que su rol no tiene, y su pantalla deja de andar] → Modo sólo avisar en el lab, recorriendo las pantallas con un rol Operador. El registro dice exactamente qué faltó. La traducción de lo viejo es generosa a propósito.
- [El nombre `archivo#función` sale del manifiesto; si Next cambia su formato, la puerta no resuelve nombres] → Ya pasa con `acciones-publicas` y está probado. Si no resuelve, con sesión se deja pasar y se registra «id desconocido», como hoy. La prueba de clasificación corre sobre el código, no sobre el manifiesto.
- [Un token viejo con `perms` congelados no ve los permisos nuevos de su rol hasta volver a entrar] → Es el comportamiento de hoy. Administrador no depende del token, y la traducción cubre lo viejo.
- [Una tabla de 482 acciones se desactualiza] → La prueba de clasificación falla con cada acción nueva sin clasificar. Los permisos por defecto por archivo cubren las funciones nuevas de un archivo ya clasificado.
- [Cuatro pantallas que hoy abre cualquiera se cierran] → Es buscado. La traducción les da acceso a los roles que tenían `monitor` o `ajustes`.

## Migration Plan

1. Desplegar en el lab con `OMNI_PERMISOS_SOLO_AVISAR=1`. `desplegar.sh` corre `scripts/permisos-roles.js`, que normaliza y traduce `AppRole.permisos` (idempotente, y dice qué cambió).
2. Recorrer el lab con un usuario de rol Operador y uno de una plantilla. Revisar el registro de «habría rechazado» y corregir la clasificación hasta que quede vacío en el uso normal.
3. Sacar el modo sólo avisar en el lab y repetir las pruebas.
4. San Nicolás, cuando Nico lo diga: el mismo parche y el mismo script, sin el modo sólo avisar, después de leer sus roles (sólo lectura) para confirmar la traducción.

Vuelta atrás: revertir el parche. Los roles traducidos siguen sirviendo con el catálogo viejo porque conservan las claves viejas que siguen existiendo; las claves nuevas el código viejo las ignora.

## Open Questions

- **Alcance por área:** que un rol se limite a ciertas áreas (por ejemplo, un operador que sólo ve las alarmas del barrio A). Encaja en este modelo como un campo aparte del rol, pero toca cada consulta de alarmas, monitores e historial. Se propone como un cambio siguiente.
