# Proposal

## Why

Los roles se armaron el 7/10 con 19 permisos, cuando OmniAccess era LPR, intrusión y filas. Desde entonces se sumaron Alarm Hub, OmniVision, la gestión de alarmas unificada, los monitores de pared, las visitas y los proveedores, el video con grabaciones y clips, y las funciones de la instalación. Nada de eso tiene permiso propio: va colgado de «monitor» o de «ajustes», o no tiene ninguno. Nico (23/10): «revisá bien los roles según todo lo que hemos creado; faltan secciones, módulos y que sea más profesional».

La revisión dio estos resultados, medidos en el código del lab:

- **Pantallas sin permiso.** `/admin/audit` (Auditoría), `/admin/dashboard-face/*` (listas de rostros y carga), `/admin/queue` y `/admin/notificaciones-queue` no están en el catálogo. Cualquier usuario con sesión las abre.
- **Permisos que mezclan cosas distintas.** «Monitor» abre a la vez LPR, CCTV, rostro, filas y la gestión de alarmas. «Ajustes» abre toda la configuración, OmniVision entero (también la búsqueda y el mapa de calor) y las tareas de mantenimiento: respaldo, restauración, cambio de base y migraciones. No hay forma de dar «ver» sin «editar»: quien consulta residentes también los da de baja.
- **El permiso sólo corta el menú y la página, no la acción.** El middleware revisa permisos en las páginas. En la API alcanza con tener sesión, y en las acciones de servidor también.
  - 136 de las 196 rutas de `/api` y 46 de los 62 módulos de acciones no preguntan qué rol tiene quien llama.
  - Un usuario con sólo «Monitor» puede invocar `updateSetting`, `restoreBackup`, `updateDatabaseUrl` o `deleteAllUsers`.
  - Sin sesión ya está cerrado: el 9/10 se sumó la puerta de acciones públicas (`lib/acciones-publicas`). Se probó el 23/10 en el lab: un POST anónimo a `/login` con una acción de Ajustes dio 403.
- **El editor de roles es una lista de casillas sueltas.** No muestra los módulos de la instalación ni separa niveles. No avisa de los permisos delicados, no tiene plantillas y no deja rastro de quién cambió un rol.

## What Changes

- **Catálogo por módulo y por nivel.** Cada sección de OmniAccess es una fila con hasta tres niveles: **Ver**, **Operar** y **Configurar**. Los módulos son Operación, LPR, Video, Intrusión, Alarm Hub, OmniVision, Rostro, Filas, Guardia, Padrón, Equipos y Administración. Son 48 permisos, contra 19 hoy.
  - Hay permisos nuevos para lo que hoy no tiene: Gestión de alarmas, Alarm Hub (ver, tratar, configurar), OmniVision, Video y grabaciones, Rostro, Visitas, Auditoría y Mantenimiento.
  - Operar y Configurar incluyen Ver.
- **Compatibilidad.**
  - Cada permiso viejo se expande a los nuevos que cubren lo mismo, así nadie pierde lo que hoy usa. Un script idempotente reescribe los roles guardados, y `permisosDeSesion` expande los permisos viejos de las sesiones abiertas.
  - Administrador sigue viendo todo. El rol de sistema Operador se expande igual que los demás.
  - **BREAKING (buscado):** las cuatro pantallas que hoy abre cualquiera pasan a pedir su permiso.
- **El permiso se aplica en el servidor, no sólo en el menú.**
  - Cada acción de servidor y cada ruta de API que cambia algo queda clasificada con su permiso. El middleware lo exige con la sesión del panel, igual que ya hace sin sesión.
  - Lo que no esté clasificado no se ejecuta, y una prueba lo detecta antes de compilar.
  - Las lecturas siguen abiertas con sesión, salvo las delicadas: secretos de Ajustes, usuarios del sistema y respaldos.
- **Cobertura completa.** Una prueba recorre todas las páginas de `/admin` y `/monitor`. Si una página nueva no tiene permiso y no está declarada como libre, la prueba falla.
- **Accesos más profesional** (Ajustes → Accesos):
  - el rol se edita como una matriz de módulos por niveles;
  - cada módulo dice si está activo en esta instalación;
  - cada permiso lleva una explicación con `Pista`;
  - los permisos delicados (Accesos, Mantenimiento, enlaces de pantalla, armar y desarmar centrales) llevan una marca;
  - hay plantillas para crear un rol de un toque: Supervisor, Operador de monitoreo, Guardia de garita, Técnico, Administración del barrio y Auditor;
  - cada cambio de rol o de usuario del sistema queda en Auditoría.
- **El menú y las pantallas** preguntan por los permisos nuevos. Por ejemplo, Gestión de alarmas muestra cada grupo según el permiso de su módulo.

## Capabilities

### New Capabilities

- `permisos-catalogo`: el catálogo de permisos por módulo, sección y nivel; las dependencias entre niveles; la expansión de los permisos viejos; y qué ruta pide qué permiso.
- `permisos-aplicacion`: cómo se exige un permiso en páginas, acciones de servidor y rutas de API, y que nada quede sin clasificar.
- `accesos-panel`: cómo se administran los roles y los usuarios del sistema (matriz, plantillas, permisos delicados y auditoría de cambios).

### Modified Capabilities

(ninguna: `openspec/specs/` está vacío; los cambios anteriores no archivaron specs de permisos)

## Impact

- **Código:**
  - `src/lib/permisos.ts` (catálogo, expansión, `permisoDeRuta`);
  - nuevos `src/lib/permisos-acciones.ts` y `src/lib/permisos-api.ts` (clasificación) y `src/lib/permiso-servidor.ts` (`exigirPermiso`, en lugar de los diez `exigirAjustes`/`exigirVideo`/… copiados en cada archivo);
  - `src/middleware.ts` (la puerta de acciones y la API con sesión);
  - `src/app/admin/layout.tsx` (menú), `src/app/admin/settings/AccesosSection.tsx` (editor), `src/app/actions/accesos.ts` (auditoría y plantillas);
  - `src/app/admin/alarmas/page.tsx` (grupos por permiso);
  - las acciones con chequeo propio (tratamiento de eventos, enlaces de pantalla, clips).
- **Datos:** sin migración de esquema. `scripts/permisos-roles.js` reescribe `AppRole.permisos` (idempotente) y `desplegar.sh` lo corre.
- **Sesiones:** los tokens abiertos siguen sirviendo, porque sus permisos viejos se expanden al leerse. Los permisos nuevos de un rol valen al volver a entrar, igual que hoy; Administrador los ve enseguida.
- **Riesgo:** una acción clasificada de menos deja a alguien sin poder hacer su tarea. Se cubre con la prueba de clasificación, con un modo «sólo avisar» en el lab antes de cortar y con el registro de cada rechazo.
- **Instancias:** primero el lab. San Nicolás sólo cuando Nico lo diga, con el mismo script.
