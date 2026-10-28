# Proposal

## Why

Cada cámara, grabador y terminal tiene sus propias cuentas locales: la `admin` del instalador, un «operador» que se creó para un vecino en 2023, el técnico que ya no trabaja con nosotros. Hoy OmniAccess no las ve. Nadie sabe cuántas hay ni quién entra a cada equipo, y dar de baja a una persona significa recorrer los equipos uno por uno.

El 28/10 Nico pidió tres cosas:

- **leer** los usuarios locales de cada equipo;
- **crearlos y borrarlos** desde el panel, para centralizar la seguridad y auditar mejor los accesos locales;
- **sincronizar** los usuarios del panel hacia los equipos.

Medido el 28/10 en el lab, en una muestra de 14 de sus 79 equipos (todos Hikvision): la lista de usuarios (`/ISAPI/Security/users`) contesta en 13 de los 14, y las sesiones abiertas (`/ISAPI/Security/onlineUser`) también, con el usuario, la IP y la hora de entrada. En San Nicolás los 9 equipos son Hikvision. Ya se puede construir sobre equipos reales.

## What Changes

- **Cuentas de cada equipo.** OmniAccess lee las cuentas locales de cada equipo compatible: el nombre, el nivel (Administrador, Operador o Visualizador) y si se puede borrar. Las guarda como inventario, con la primera y la última vez que las vio, y clasifica cada una:
  - **servicio**: la cuenta con la que OmniAccess habla con el equipo;
  - **de fábrica**: la `admin` que el equipo no deja borrar;
  - **gestionada**: la creó OmniAccess para un usuario del panel;
  - **no gestionada**: todo lo demás.
- **Aviso de cuenta no gestionada.** Cuando aparece en un equipo una cuenta que OmniAccess no creó, se marca y se avisa: una alerta del equipo y una entrada en Auditoría. **No se borra sola** (decisión de Nico del 28/10); borrarla es una acción aparte.
- **Altas, bajas y cambios a mano.** Desde la ficha del equipo se puede crear una cuenta, cambiarle la clave o el nivel, y borrarla. Cada acción pide confirmación y queda en Auditoría. Nunca se toca la cuenta de servicio ni la de fábrica.
- **Quién está conectado.** Se leen las sesiones abiertas de cada equipo (usuario, IP y desde cuándo) y se reconoce de dónde viene cada una: el servidor de OmniAccess, un grabador dado de alta o una IP desconocida. Una sesión desde una IP desconocida se registra y se avisa: es el «acceso local» que hoy no se ve.
- **Una pantalla para todo el sitio.** «Usuarios de equipos» junta todas las cuentas de todos los equipos en una tabla, para responder dos preguntas: qué cuentas hay en todos lados y dónde está cada persona.
- **Sincronización desde el panel:**
  - un usuario del panel puede tener **cuenta en equipos**; se marca a mano, por persona (decisión de Nico);
  - su **rol** dice con qué nivel se crea la cuenta y en qué tipos de equipo;
  - su **clave de equipos** es propia, distinta de la del panel, y se guarda **cifrada** como las claves de los dispositivos (decisión de Nico); con ella OmniAccess puede crear la cuenta en un equipo nuevo o en uno reseteado sin pedirla de nuevo;
  - crear la persona, cambiarle el rol o la clave, o darla de baja **se aplica a los equipos**;
  - una revisión periódica compara lo que debería haber con lo que hay y muestra las diferencias para corregirlas.
- **Rotación de la cuenta de servicio**, en una fase posterior (decisión de Nico): cambiar la clave con la que OmniAccess habla con cada equipo, en el equipo y en OmniAccess a la vez, comprobando la clave nueva antes de guardarla.
- **Marcas:** primero **Hikvision**, todos sus tipos (cámaras, LPR, grabadores y terminales faciales). El catálogo de soporte suma la capacidad «usuarios» y dice qué marcas no la tienen todavía, en vez de mostrar un botón que no anda.

## Capabilities

### New Capabilities

- `equipos-cuentas-locales`: inventario de las cuentas locales de cada equipo, su clasificación, el aviso de las no gestionadas y las altas, bajas y cambios hechos a mano.
- `equipos-sesiones-locales`: las sesiones abiertas en cada equipo, de dónde vienen y su registro.
- `equipos-sincronizacion-panel`: la cuenta en equipos de los usuarios del panel, con su política por rol, su clave cifrada, la aplicación de los cambios y la revisión de diferencias.
- `equipos-rotacion-servicio`: el cambio de la clave de la cuenta de servicio de un equipo (fase posterior).

### Modified Capabilities

Ninguna: `openspec/specs/` todavía no tiene especificaciones archivadas.

## Impact

- **Base**, con una migración aditiva:
  - `CuentaEquipo`: deviceId, nombre, id en el equipo, nivel, origen, userId (si es gestionada), vista por primera y última vez, desaparecida;
  - `SesionEquipo`: deviceId, usuario, IP, procedencia, desde y hasta;
  - `User`: suma `cuentaEquipos`, `claveEquipos` (cifrada) y `nombreEquipos`;
  - `AppRole`: suma `nivelEquipos` y `tiposEquipos`.
- **Drivers:**
  - una interfaz nueva, `IUsuariosDriver` (listar, sesiones, crear, cambiar clave o nivel, borrar);
  - su versión Hikvision sobre ISAPI, con `authenticatedRequest`, que ya respeta los equipos de sólo lectura (`OMNI_EQUIPOS_SOLO_LECTURA`);
  - `catalogo.ts` suma la capacidad `usuarios`.
- **Tareas:** una tarea programada nueva, `/api/devices/usuarios/tick`, que lee cuentas y sesiones; se suma a `lib/tareas/catalogo.ts`. Además, una cola de aplicación por equipo.
- **Permisos:**
  - `dispositivos.usuarios` (nuevo, configurar, delicado) para crear, borrar y cambiar cuentas;
  - para ver, alcanza con `dispositivos`;
  - la cuenta en equipos de un usuario del panel se edita con `accesos`.
- **Pantallas:**
  - un bloque «Usuarios del equipo» en `CajonDispositivo`;
  - una página nueva, «Usuarios de equipos», en Equipos;
  - en `AccesosSection`, la cuenta en equipos del usuario y el nivel por rol.
- **Auditoría:** acciones nuevas en `AccionSistema`; `DeviceAlert` suma los tipos `cuenta-no-gestionada` y `sesion-desconocida`.
- **San Nicolás:** nada se lleva hasta que Nico lo diga. Desde el lab los equipos de San Nicolás siguen siendo de sólo lectura: se pueden leer, nunca escribir.
