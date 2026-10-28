# Design

## Context

El pedido está en proposal.md (Why). Lo que importa del código actual:

- **Equipos.** Cada uno es un `Device`, con `brand`, `deviceType`, `ip`, `httpPort`, `username` y `password`. La clave se guarda cifrada (`enc:v1`, `lib/cifrado-datos`) y se descifra al leer. Los grabadores también son `Device` (`deviceType NVR`).
- **Cómo se habla con un equipo.** Hay un solo camino, `authenticatedRequest` (`lib/digest-auth`), que ya llama a `exigirEscritura`. En el lab, `OMNI_EQUIPOS_SOLO_LECTURA=192.168.1.0/24` corta cualquier POST, PUT o DELETE hacia los equipos de San Nicolás. Sólo dejan pasar los POST de consulta que están en `POST_DE_LECTURA`, y ninguno toca `/Security/users`.
- **Capacidades por marca.** Los drivers (`lib/drivers/*Driver.ts`) implementan interfaces por capacidad (`ILprDriver`, `IFaceDriver`, `IRfidDriver`…). `catalogo.ts` declara lo que de verdad anda: es la única fuente que mira la interfaz.
- **Usuarios del panel.** Son `User` con `appRoleId`. La clave del panel es una `Credential` con hash bcrypt y no se puede recuperar. Ajustes → Accesos (`AccesosSection`, `actions/accesos.ts`) los crea, edita y borra, y registra en `AccionSistema` con los textos de `ACCION_ACCESOS`.
- **Alertas y tareas.** Las alertas de equipo son `DeviceAlert` (`offline`, `disk`, `mem`, `drift`). El cron llama rutas `…/tick`, descritas en `lib/tareas/catalogo.ts`.

**Medición del 28/10, en el lab y sólo con GET.** En 14 equipos Hikvision, cámaras y grabadores:

- **Cuentas** (`/ISAPI/Security/users`): contestan 13 de 14; la que no, da 404. Las cámaras tienen sólo `admin`. Un grabador tiene 4 cuentas: Administrador, Operador y dos Visualizador. Los grabadores marcan la `admin` con `<attribute><inherent>true</inherent>`.
- **Sesiones abiertas** (`/ISAPI/Security/onlineUser`): contestan 13 de 14. Traen cuenta, tipo, hora de entrada e IP de origen. Las cámaras tienen 2 o 3 sesiones de `admin` abiertas: las de OmniAccess y la del grabador.
- **Capacidades** (`/ISAPI/Security/users/1/capabilities`): en un grabador traen `id max=32`, `userName max=32` e `isSupportWeakPassword=false`.

San Nicolás tiene 9 equipos, todos Hikvision: 2 LPR, 3 cámaras, 3 NVR y 1 LPR interior.

## Goals / Non-Goals

**Goals**

- Que la lectura de cuentas y sesiones sirva sola, como fase de sólo lectura, sin riesgo para los equipos.
- Que la escritura nunca deje a OmniAccess sin control de un equipo.
- Un estado deseado calculable y comparable: qué cuentas debería haber en cada equipo según el panel.

**Non-Goals**

- **Otras marcas.** Dahua e Intelbras (RPC2 `userManager.*`), Axis (`pwdgrp.cgi`) y Akuvox quedan para después. Esta fase deja la interfaz lista y el catálogo diciendo «todavía no».
- **Permisos finos por canal** (`/ISAPI/Security/UserPermission`). Las cuentas se crean con los permisos por defecto del nivel.
- **Avisos por WhatsApp o Telegram** de las cuentas y sesiones desconocidas. Quedan como alerta del equipo y en Auditoría, y se suman a las reglas de notificación en otro cambio.
- **El registro de entradas que guarda el equipo** (`logSearch` de tipo Operation). Captaría las sesiones cortas que el sondeo no ve; es el siguiente paso, con su propia medición.
- **Equipos detrás de un grabador.** Una cámara que no está dada de alta como `Device` no se ve.

## Decisions

### 1. Una función de la instalación, apagada por defecto

Todo cuelga de una función nueva, `EQUIPOS_USUARIOS` (alcance instalación, `lib/funciones`), apagada por defecto, como pide el criterio del 26/10 (las funciones se activan). Apagada:

- la tarea no lee nada;
- no hay bloque ni pantalla;
- las rutas dan 404 con `exigirFuncion`.

En el lab se prende a mano. En San Nicolás, cuando Nico lo diga.

*Alternativa descartada:* que esté siempre. Hubiera abierto alertas en una instalación que nadie preparó para eso.

### 2. Interfaz por capacidad: `IUsuariosDriver`

```
listarCuentas(device) → { cuentas: [{ idEquipo, nombre, nivel, deFabrica }], max?, reglasClave }
listarSesiones?(device) → [{ nombre, ip, desde }]
crearCuenta(device, { nombre, clave, nivel })
cambiarCuenta(device, idEquipo, { clave?, nivel? })
borrarCuenta(device, idEquipo)
```

`listarSesiones` es opcional: una marca puede saber de cuentas y no de sesiones, y eso se dice. El catálogo suma la capacidad `usuarios` (por ahora, sólo Hikvision) y `sesiones`.

*Alternativa descartada:* hacerlo en las rutas con ISAPI directo. Es lo que dejó drivers con métodos vacíos que «andaban».

### 3. Hikvision sobre ISAPI, por el camino de siempre

- **Leer:**
  - `GET /ISAPI/Security/users`;
  - `GET /ISAPI/Security/onlineUser`;
  - `GET /ISAPI/Security/users/1/capabilities`, para los topes y si admite claves débiles.
- **Crear:** `POST /ISAPI/Security/users`, con un `<User>` que lleva el primer id libre, el nombre, la clave y el nivel (`Operator` o `Viewer`). Hikvision admite **un solo** Administrador: un rol que pida «administrador» se rechaza al guardarlo (ver spec).
- **Cambiar:** `PUT /ISAPI/Security/users/<id>`.
- **Borrar:** `DELETE /ISAPI/Security/users/<id>`.

Todo va por `authenticatedRequest`, así la guarda de sólo lectura aplica sin código nuevo.

**A medir antes de escribir (tarea 1.1).** Los firmwares nuevos piden `<loginPassword>` en el cuerpo: la clave de la cuenta con la que se hace el cambio, que es la de servicio y OmniAccess ya la tiene. Hay que medir cuál lo pide y en qué forma, en un equipo de prueba que designe Nico. Nunca en uno de San Nicolás ni de un cliente.

**Regla de clave por marca**, en `REGLAS_CLAVE[HIKVISION]`: de 8 a 16 caracteres, al menos 2 de 4 tipos (minúsculas, mayúsculas, números y signos) y sin contener el nombre de la cuenta. Se valida antes de enviar, y la regla es la misma que usa el generador.

### 4. Inventario en la base, no en vivo

Se suman dos modelos:

- `CuentaEquipo`: único por `(deviceId, nombre)`. Guarda idEquipo, nivel, deFabrica, `origen` (`omniaccess` | `equipo`), userId (si es gestionada), `conocida` y su motivo, primeraVez, ultimaVez y `desaparecida`;
- `SesionEquipo`: deviceId, nombre, ip, procedencia, desde, vistaUltima y hasta.

**La clase no se guarda: se calcula al leer.** Así cambia sola si se edita el usuario del dispositivo. Las reglas:

- **servicio**: el nombre es igual a `Device.username`, sin distinguir mayúsculas;
- **de fábrica**: `deFabrica` (`inherent`, o el id 1 en Hikvision);
- **gestionada**: `origen = omniaccess`;
- **no gestionada**: el resto.

*Alternativa descartada:* leer en vivo al abrir la pantalla. Con 79 equipos tarda más de un minuto, no tiene historia y no puede notar que una cuenta es nueva.

### 5. La tarea: sesiones cada 5 minutos, cuentas cada hora

La tarea es `/api/devices/usuarios/tick` y corre cada 5 minutos:

- en cada vuelta lee las sesiones de todos los equipos compatibles;
- las cuentas, sólo de los equipos cuya última lectura tiene más de `CUENTAS_CADA_MIN = 60` minutos;
- trabaja de a `EN_PARALELO = 4`, con un tope de 6 s por pedido;
- saltea los equipos apagados (`lib/apagado`).

Al final de cada vuelta:

- aplica lo pendiente de la sincronización (decisión 8);
- borra las sesiones cerradas hace más de `RETENCION_SESIONES_DIAS = 90` días.

Para el lab son 79 equipos × 1 GET cada 5 minutos. Es menos que lo que ya pide la salud por minuto.

**La lectura que falla no borra.** Si el equipo no contesta, no se marca nada como desaparecido ni se cierra ninguna sesión: se guarda el error y la hora (ver spec).

### 6. De dónde viene cada sesión

Se compara la IP de origen con cuatro fuentes:

1. las IP del servidor: las de `os.networkInterfaces()` y el destino de eventos ya configurado (`getEventTarget`), que es la IP con la que los equipos ven a OmniAccess;
2. las IP de los `Device` NVR;
3. las de los demás `Device`;
4. la lista de IP conocidas, que se carga desde el panel: el Setting `EQUIPOS_IPS_CONOCIDAS`, un JSON `[{ ip, nombre }]`.

Lo que no está en ninguna es «desconocida». Desde el lab, los equipos de San Nicolás ven al servidor por la VPN, con otra IP. La primera vuelta la va a mostrar como desconocida; se marca como conocida («Servidor del lab, por VPN») y ya no avisa.

### 7. Las alertas, en los tipos de alerta que ya existen

`DeviceAlert` suma dos tipos:

- `cuenta-no-gestionada`, una por cuenta: el mensaje lleva el nombre, y se cierra cuando la cuenta se marca conocida o desaparece;
- `sesion-desconocida`, una por par cuenta/IP: se cierra cuando la sesión termina o la IP se marca conocida.

Cada apertura también va a `AccionSistema` con textos de un `ACCION_EQUIPOS`, al lado de `ACCION_ACCESOS`. La salud y la fila del equipo ya muestran las alertas abiertas, sin pantalla nueva.

### 8. La sincronización: estado deseado y comparación, no una cola

- `User` suma `cuentaEquipos`, `claveEquipos` (cifrada con `cifrarDato`, nunca en claro), `claveEquiposVersion` y `nombreEquipos` (por defecto el `username`).
- `AppRole` suma `nivelEquipos` (`ninguno` | `visualizador` | `operador`) y `tiposEquipos` (una lista de `DeviceType`).
- Una función pura, `cuentasDeseadas(usuarios, roles, equipos)`, devuelve qué cuenta debería tener cada equipo. Otra, `planDeEquipo(deseadas, leidas)`, devuelve las acciones: crear, cambiar clave, cambiar nivel, borrar gestionada y conflicto. Las dos se prueban sin equipos.
- `SincroCuenta`, por `(userId, deviceId)`, guarda el estado (`al-dia` | `pendiente` | `error` | `conflicto`), el motivo, los intentos y la `claveVersion` aplicada. La clave está al día cuando `claveVersion == User.claveEquiposVersion`, sin guardar ni comparar la clave misma.
- **Para mostrar antes de guardar** se calcula el plan. Al guardar, las filas afectadas pasan a `pendiente` y se intenta aplicar de inmediato, en segundo plano. Lo que no sale queda pendiente para la vuelta siguiente de la tarea. La reintenta la propia tarea, sin una cola aparte.
- **La baja de una persona** pasa sus cuentas gestionadas a borrar. El `User` no se borra hasta haber intentado las bajas una vez. Las que fallan quedan pendientes contra el registro de la cuenta (con `userId` nulo y el nombre), así no se pierde qué falta borrar.

*Alternativa descartada:* una cola BullMQ como `dispatch-worker`. Suma un proceso y una cola para algo que ya tiene estado propio. La comparación periódica hace lo mismo y además repara un equipo reseteado.

### 9. Permisos

- `dispositivos.usuarios` es nuevo: configurar y **delicado** («Puede crear cuentas con acceso a los equipos y borrarlas»). No va en ningún rol de sistema salvo el de administrador completo.
- Ver cuentas y sesiones va con `dispositivos`.
- La cuenta en equipos de una persona y el nivel por rol van con `accesos`, que ya es el permiso de quién entra a qué.
- El ajuste de un área (gestionada y roles) pide `dispositivos.usuarios` y `dispositivos.editar`: cambia qué equipos se tocan.

### 10. Las pantallas (revisado el 28/10: todo vive en Dispositivos)

Se usan las piezas que ya existen (`ui/tabla`, `ui/celdas`, `Button`, `DeleteConfirmDialog`), con los cuatro estados: cargando, vacío, error con reintento y con datos.

- **«Usuarios del equipo»**, un `Bloque` en `CajonDispositivo`:
  - las cuentas con su clase como chip: servicio en `info`, de fábrica en `quieto`, gestionada en `bien` y no gestionada en `aviso`;
  - debajo, las sesiones abiertas con su procedencia;
  - las acciones según el permiso, y el aviso de sólo lectura cuando corresponde.
- **Panel «Cuentas» de un área** (`VistaArea`), arriba de la lista de equipos y plegable:
  - una franja de estado con chips («10 al día · 1 pendiente · 1 conflicto · 2 no gestionadas · 1 sesión desconocida»), en tonos de estado y no de acción;
  - los botones «Revisar», «Sincronizar», «Crear cuenta en el área» y «Auditoría», todos en el azul de acción, con íconos (`ScanSearch`, `RefreshCcw`, `UserPlus`, `ScrollText`);
  - el engranaje del ajuste del área: «Cuentas gestionadas» (propio o heredado) y los roles habilitados.
- **En `ArbolAreas`**, cada área gestionada lleva un ícono de escudo (`ShieldCheck`) y, si tiene diferencias o alertas, un punto de aviso.
- **«Todas»** muestra la tabla de cuentas de todo el sitio, con filtros y buscador (`Seek`), y una pestaña de sesiones. No hay una página fuera de Dispositivos.
- **Ajustes → Accesos** (lo de la persona, no lo de los equipos):
  - en la ficha del usuario: «Cuenta en equipos», la clave (generar o escribir) y el estado «12 de 12 al día», con el detalle de cada equipo pendiente o en conflicto;
  - en el editor del rol: el nivel y los tipos de equipo.

### 11. Moderación por áreas

Las áreas ya existen como un árbol guardado en el Setting `DEVICE_AREAS` (`areas[]`, `equipos{deviceId: areaId}`, `apagadas[]`), con `actions/areas.ts`. Cada `Area` suma un campo opcional:

```
cuentas?: { gestionada: boolean; roles: string[] }
```

Si no lo tiene, hereda el de su madre. La raíz y «Sin área» valen «no gestionada».

- `areaGestora(estado, deviceId)` sube por el árbol y devuelve el área que decide y su ajuste. La usan las rutas, el plan de sincronización y las pantallas, así que hay una sola verdad.
- `cuentasDeseadas` (decisión 8) recibe también las áreas. Una persona entra en un equipo sólo si se cumplen las tres condiciones del spec: la marca, el nivel del rol para ese tipo y el rol habilitado en el área.
- **Mover un equipo** de un área gestionada a otra que no lo es no borra nada: deja sus cuentas gestionadas como «fuera de área», visibles en la revisión, y borrarlas es una acción con confirmación. Si un arrastre borrara cuentas, una reorganización del árbol terminaría en bajas en equipos.
- **Cambiar el ajuste de un área** (gestionar o no, los roles) es una escritura de cuentas: pasa por la confirmación con su plan.

*Alternativa descartada:* un modelo `AreaCuentas` aparte. Las áreas ya viven en un JSON con sus propias acciones, y separar su política obligaría a mantener dos árboles en sincronía.

### 12. La ventana de confirmación

Es una sola pieza, `ConfirmarCuentas`, sobre `ui/dialog`: no son los `window.confirm` ni una ventana propia de cada pantalla. La usan el bloque del equipo, el panel del área, Accesos y la rotación. Recibe un **plan** (las acciones por equipo que calcula `planDeEquipo`), así lo que se confirma es exactamente lo que se envía.

- **Encabezado.** Un ícono grande en un círculo del tono de la gravedad, el título de la acción y la cantidad de equipos. Hay tres gravedades:
  - información (`UserPlus`): crear;
  - aviso (`KeyRound`, `ShieldHalf`): cambiar clave o nivel;
  - mal (`UserX`, `ShieldAlert`, `RotateCcwKey`): borrar, adoptar, sobrescribir o rotar.
- **Advertencias**, una por línea, con ícono y el nombre de la cuenta. Salen de una tabla `ADVERTENCIAS` con el texto de cada caso, para no repetirlo en cada pantalla:
  - se sobrescribe la clave del administrador local;
  - se sobrescribe una cuenta que no creó OmniAccess;
  - el NVR entra con esta clave;
  - se borra una cuenta con una sesión abierta ahora.
- **Lista por equipo**, agrupada por área. Cada fila lleva el equipo, el ícono del efecto y el texto («crear jperez · Operador»), y se puede abrir.
- **«Queda afuera»**, en gris: sólo lectura, sin soporte, área sin gestionar o apagado, con el motivo.
- **Confirmación reforzada** para la gravedad mal: la casilla «Entiendo lo que se va a sobrescribir» y, con más de un equipo, escribir la cantidad. El botón de aceptar dice la acción y el número («Borrar en 5 equipos»).
- **Después de aceptar**, la misma ventana pasa al avance: una barra y cada fila con su estado (en curso, hecho y verificado, pendiente o error con el motivo), con entradas y salidas animadas (framer-motion) y «Reintentar» por equipo. Se puede cerrar y el trabajo sigue en el servidor; el área muestra el avance.
- **Esc y Cancelar no envían nada.** El foco arranca en Cancelar, nunca en aceptar.

### 13. La rotación de servicio (fase 4)

Va en este orden:

1. se cambia la clave en el equipo con `cambiarCuenta` sobre la cuenta de servicio;
2. se comprueba con un GET usando la clave nueva;
3. se guarda la clave nueva.

Mientras el equipo queda «rotación sin confirmar», `Device` guarda las dos claves (`passwordAnterior`, cifrada) y `authenticatedRequest` prueba con la segunda si la primera da 401. Las rotaciones en lote van de a una y se detienen en la primera falla.

## Risks / Trade-offs

- **[Que el equipo bloquee la IP de OmniAccess por intentos fallidos]** → Toda la escritura usa la cuenta de servicio, la misma de la salud. Si un pedido da 401, se corta y no se reintenta en la misma vuelta.
- **[Firmwares que piden la escritura de otra forma (`loginPassword`, JSON en lugar de XML)]** → Se mide primero en un equipo de prueba (tarea 1.1). Un 4xx inesperado deja la acción en `error` con la respuesta del equipo, nunca en «al día».
- **[Una sesión corta entre dos sondeos no se ve]** → Se dice en la pantalla: «sesiones vistas cada 5 minutos». El registro del equipo (`logSearch`) queda como siguiente paso, en Non-Goals.
- **[La clave de equipos cifrada vale lo que vale `OMNI_CLAVE_DATOS`]** → Es el mismo riesgo y la misma protección que las claves de los dispositivos, que ya están cifradas así. Sin la clave en el servidor no se puede prender «Cuenta en equipos».
- **[Borrar una persona con un equipo caído deja una cuenta viva en ese equipo]** → La baja queda pendiente con el nombre y la revisión la reintenta hasta que sale. La pantalla muestra «bajas pendientes».
- **[Desde el lab, la IP del servidor se ve distinta]** → Se marca conocida una vez (decisión 6).
- **[Una reorganización de áreas dispara bajas]** → Mover equipos no borra: deja las cuentas «fuera de área» (decisión 11).
- **[Que la confirmación muestre una cosa y se envíe otra]** → La ventana recibe el plan, y la ruta de aplicar vuelve a calcularlo y rechaza si cambió (un equipo leído entretanto). En ese caso, se muestra el plan nuevo.

## Migration Plan

1. Hacer una migración aditiva (`prisma migrate deploy`; en el schema, sólo comentarios `//` y `///`):
   - modelos nuevos: `CuentaEquipo`, `SesionEquipo` y `SincroCuenta`;
   - columnas nuevas en `User`, `AppRole` y `Device` (`passwordAnterior`, para la fase 4).
2. Las columnas nuevas tienen valores por defecto inertes y la función está apagada: desplegar no cambia nada visible.
3. Llevarlo al lab por fases:
   - sólo lectura;
   - escritura a mano en el equipo de prueba;
   - sincronización;
   - rotación.
4. Llevarlo a San Nicolás sólo con el OK de Nico. Allí se prende primero la lectura, sola, unos días.
5. Para volver atrás: apagar la función. Las tablas pueden quedar; no las lee nadie más.

## Open Questions

- **La retención de las sesiones.** Quedan en 90 días; se puede pasar a Ajustes → Almacenamiento si Nico quiere moverla.
- **Si un rol sin cuenta en equipos puede tener igual una cuenta a mano en un equipo puntual.** Hoy sí: un alta manual figura como gestionada y sin rol. No cambia el diseño.
