# Tasks

## 1. Medición y base

- [ ] 1.1 Medir la escritura en Hikvision, en un equipo de prueba que designe Nico. Nunca en uno de la red 192.168.1.0/24, de San Nicolás ni de un cliente. Medir en una cámara, un grabador y, si hay, una terminal facial:
  - si el alta (`POST /ISAPI/Security/users`), el cambio (`PUT`) y la baja (`DELETE`) piden `<loginPassword>`, y en qué forma;
  - qué id hay que mandar;
  - qué devuelve el equipo cuando la clave no cumple la regla;
  - que la cuenta creada entra con su clave, y que después del `DELETE` ya no.
  - Verificación: queda `claude/usuarios-equipos-medicion.md` en el proyecto, con los cuerpos (sin claves) y las respuestas por modelo y firmware.
- [ ] 1.2 Migración aditiva `…_usuarios_de_equipos` (`prisma migrate deploy`, sólo comentarios `//` y `///`):
  - `CuentaEquipo`, `SesionEquipo` y `SincroCuenta`;
  - en `User`: `cuentaEquipos`, `claveEquipos`, `claveEquiposVersion` y `nombreEquipos`;
  - en `AppRole`: `nivelEquipos` y `tiposEquipos`;
  - en `Device`: `passwordAnterior`;
  - `lib-cifrado-datos.js` y `lib/cifrado-datos.ts` suman `claveEquipos` y `passwordAnterior` a los campos cifrados (los dos gemelos).
  - Verificación: la migración corre en el lab; `prisma.cuentaEquipo.count()` da 0; una prueba confirma que `claveEquipos` se guarda con el prefijo `enc:v1:`.
- [ ] 1.3 La función `EQUIPOS_USUARIOS` en `lib/funciones.ts` (alcance instalación, apagada por defecto) y el permiso `dispositivos.usuarios` en `lib/permisos.ts` (configurar, delicado). Ninguna plantilla de rol lleva el permiso.
  - Verificación: `node scripts/probar.js` en verde, con las pruebas de catálogo de permisos y de funciones; la función aparece en Ajustes → Modos.

## 2. Leer cuentas y sesiones (sólo lectura)

- [ ] 2.1 `IUsuariosDriver` en `lib/drivers/IDeviceDriver.ts`, con su guardia de tipo, y en `catalogo.ts` las capacidades `usuarios` y `sesiones`, sólo para Hikvision.
  - Verificación: `tsc` limpio; el catálogo dice «todavía no» para las demás marcas.
- [ ] 2.2 La lectura en `HikvisionDriver`:
  - `listarCuentas` (lista, `inherent` o id 1, capacidades y `REGLAS_CLAVE[HIKVISION]`);
  - `listarSesiones`;
  - el parseo, en `lib/usuarios-equipo/hikvision.ts`.
  - Prueba: `tests/usuarios-equipo.test.ts` sobre las respuestas medidas el 28/10: cámara v2.0 con sesiones, grabador v1.0 con 4 cuentas y `bondIpAddressList`, y 404.
- [ ] 2.3 `lib/usuarios-equipo/inventario.ts`:
  - `clasificar` (servicio, de fábrica, gestionada, no gestionada);
  - `procedencia` (servidor, grabador, equipo conocido, desconocida), con las cuatro fuentes de design §6;
  - `fusionarLectura`: altas, desaparecidas y la regla de que una lectura fallida no borra.
  - Pruebas sobre los escenarios del spec: primera lectura, cuenta borrada, equipo que no contesta, cuenta de servicio, sesión del grabador e IP desconocida.
- [ ] 2.4 La tarea `/api/devices/usuarios/tick`:
  - sesiones cada 5 minutos y cuentas cada `CUENTAS_CADA_MIN`;
  - `EN_PARALELO = 4`, sin los equipos apagados, con `exigirFuncion`;
  - las alertas `cuenta-no-gestionada` y `sesion-desconocida` (abrir una sola vez y cerrar cuando corresponde), y `ACCION_EQUIPOS` en `AccionSistema`;
  - la retención de `RETENCION_SESIONES_DIAS`;
  - suma la línea del cron y la entrada en `lib/tareas/catalogo.ts`; el middleware la deja pasar como las demás tareas.
  - Verificación en el lab, con la función prendida: una vuelta lee los 79 equipos en menos de 60 s (medido en el registro). Las alertas de la primera vuelta coinciden con las cuentas y las IP reales. La segunda vuelta no repite ninguna. Con la función apagada, 404 y ningún pedido a los equipos.
- [ ] 2.5 Las rutas de lectura, con `dispositivos` y `exigirFuncion`:
  - `GET /api/devices/[id]/usuarios`: cuentas con su clase, sesiones abiertas, última lectura y su error;
  - `GET /api/devices/usuarios`: todas, con filtros;
  - `GET /api/devices/usuarios/sesiones`: la historia.

  La respuesta nunca trae claves.
  - Prueba: `permisos-api` las cubre; sin `dispositivos`, 403.
- [ ] 2.6 El bloque «Usuarios del equipo» en `CajonDispositivo`:
  - la tabla de cuentas con su chip de clase y las sesiones con su procedencia;
  - «Marcar conocida» para una cuenta o una IP, con motivo (se habilita en 3.2);
  - los avisos de marca sin soporte y de sólo lectura;
  - los cuatro estados.

  Piezas de `ui/`, sin colores sueltos.
  - Verificación: vista previa con datos simulados (cámara con sesiones, grabador con 4 cuentas, equipo caído y marca sin soporte), en claro y oscuro, a 1366 px.
- [ ] 2.7 En Dispositivos, las cuentas por área (design §10–11), en sólo lectura:
  - `areaGestora(estado, deviceId)` con la herencia;
  - el campo `cuentas?` en `Area` (`actions/areas.ts`, sin acción de escritura todavía);
  - el panel «Cuentas» de `VistaArea`: la franja de estado, «Revisar» y «Auditoría» del área;
  - el escudo y el punto de aviso en `ArbolAreas`;
  - en «Todas», la tabla de cuentas de todo el sitio, con filtros, buscador y la pestaña de sesiones.

  No hay una página fuera de Dispositivos.
  - Pruebas: `areaGestora` con sub-área que hereda, sub-área con ajuste propio, «Sin área» y equipo de un área borrada.
  - Verificación: en el lab, buscar `admin` en «Todas» lista los equipos con su área; la auditoría de un área muestra sólo lo de sus equipos.
- [ ] 2.8 Documentar en el proyecto (`claude/usuarios-de-equipos.md`):
  - qué se lee y cada cuánto;
  - qué significa cada clase y cada procedencia;
  - cómo marcar conocida una cuenta o una IP;
  - qué no se ve: las sesiones cortas entre sondeos.
  - Verificación: el doc existe y coincide con lo desplegado.

## 3. Altas, cambios y bajas a mano

- [ ] 3.0 La ventana `ConfirmarCuentas` (design §12):
  - recibe un plan;
  - encabezado con ícono y tono por gravedad;
  - la tabla `ADVERTENCIAS`, con la sobrescritura del admin local, de una cuenta ajena, el NVR que entra con esa clave y la sesión abierta;
  - la lista por equipo agrupada por área, y «Queda afuera»;
  - la confirmación reforzada (casilla y escribir la cantidad);
  - el paso al avance con estados animados y «Reintentar»;
  - el foco inicial en Cancelar; Esc y Cancelar no envían nada.

  Se arma con `ui/dialog`, tokens e íconos de lucide, sin colores sueltos.
  - Pruebas: la gravedad y las advertencias que salen de cada tipo de plan; el botón queda deshabilitado sin la confirmación reforzada.
  - Verificación: vista previa con cinco planes (crear en un equipo, sincronizar un área con mezcla, borrar en 5, adoptar y rotar admin en 8), en claro y oscuro, a 1366 y 1920 px, y con la entrada y la salida animadas.

- [ ] 3.1 La escritura en `HikvisionDriver`: `crearCuenta`, `cambiarCuenta` y `borrarCuenta`, tal como lo dejó la medición 1.1, por `authenticatedRequest`. Más `lib/usuarios-equipo/clave.ts`, con `validarClave(marca, nombre, clave)` y `generarClave(marca)`; las dos usan `REGLAS_CLAVE`.
  - Pruebas: la clave generada siempre pasa la validación (1000 corridas); la validación rechaza las claves cortas, las de un solo tipo y las que contienen el nombre; los cuerpos XML no tienen la clave fuera de su etiqueta.
- [ ] 3.2 Las rutas de escritura, con `dispositivos.usuarios` y `exigirFuncion`:
  - `POST` y `PATCH` en `/api/devices/[id]/usuarios`, y `DELETE` en `/api/devices/[id]/usuarios/[cuenta]`;
  - `POST …/conocida` para una cuenta o una IP.

  Rechazan la cuenta de servicio y la de fábrica antes de salir, y los equipos de un área no gestionada. Reciben el plan confirmado, lo recalculan y lo rechazan si cambió. Vuelven a leer el equipo para verificar. Registran en Auditoría sin la clave.
  - Pruebas: borrar la de servicio → rechazo sin pedido al equipo (con el driver simulado); sin permiso → 403; equipo de un área sin gestionar → rechazo; plan viejo → rechazo con el plan nuevo; en un equipo de sólo lectura → corte con el aviso.
- [ ] 3.3 Las acciones, todas a través de `ConfirmarCuentas`:
  - en el bloque del equipo: crear (nombre, nivel y clave escrita o generada, mostrada una sola vez), cambiar clave, cambiar nivel y borrar;
  - en el panel del área: «Crear cuenta en el área» (elegir los equipos) y el ajuste del área (gestionada, heredada y roles), con su plan.

  No se muestran sin permiso, en un área sin gestionar ni en un equipo de sólo lectura.
  - Verificación: en el equipo de prueba de 1.1, dentro de un área de prueba gestionada: crear, entrar con la cuenta nueva, cambiarle la clave, borrarla y confirmar que no entra. Auditoría y la auditoría del área muestran las cuatro acciones. En un equipo de San Nicolás, desde el lab, las acciones no aparecen.
- [ ] 3.4 Sumar al doc del proyecto las altas y bajas a mano, y las cuentas protegidas.
  - Verificación: el doc actualizado.

## 4. Sincronización desde el panel

- [ ] 4.1 `lib/usuarios-equipo/sincro.ts`:
  - `cuentasDeseadas(usuarios, roles, equipos, areas)`, con las tres condiciones de `equipos-moderacion-por-area`;
  - los equipos movidos fuera de un área gestionada quedan «fuera de área», sin borrar;
  - `planDeEquipo(deseadas, leidas)`, con crear, cambiar clave, cambiar nivel, borrar gestionada y conflicto;
  - la regla de que las no gestionadas, la de servicio y la de fábrica nunca entran en el plan;
  - la validación del nivel por marca (sin «administrador» en Hikvision).
  - Pruebas sobre los escenarios del spec: alta, baja, rol «ninguno», rol no habilitado en el área, sub-área que hereda, equipo movido de área, conflicto por nombre, equipo reseteado, nivel cambiado a mano y equipo con cuentas ajenas.
- [ ] 4.2 La aplicación:
  - `SincroCuenta` por `(userId, deviceId)`;
  - al guardar, intento inmediato en segundo plano; lo que falla queda pendiente y lo toma la tarea 2.4;
  - el control de la clave por `claveEquiposVersion`;
  - las bajas pendientes sobreviven al borrado del `User` (design §8);
  - «Adoptar» un conflicto, con confirmación.
  - Verificación en el lab, con el equipo de prueba y uno apagado a propósito: el apagado queda pendiente y se aplica solo al volver.
- [ ] 4.3 Ajustes → Accesos:
  - en el editor del rol: nivel y tipos de equipo;
  - en la ficha del usuario: «Cuenta en equipos», la clave (generar o escribir; sin `OMNI_CLAVE_DATOS` no se puede prender), el resumen «N de M al día» y la lista de pendientes y conflictos;
  - antes de guardar, `ConfirmarCuentas` con el plan: «Se crea la cuenta en 12 equipos»;
  - al borrar: «También se quitan sus cuentas de 12 equipos»;
  - si se cancela, no se guarda.

  Todo con `accesos`.
  - Verificación: vista previa con los estados (al día, pendientes, conflicto y sin clave de cifrado), y en el lab, alta y baja de un usuario de prueba contra el equipo de prueba.
- [ ] 4.4 «Revisar» y «Sincronizar» en el panel del área: por equipo, lo que falta, lo que sobra, lo que tiene otro nivel y lo que quedó fuera de área. «Sincronizar» abre `ConfirmarCuentas` con el plan del área y sus sub-áreas.
  - Verificación: con el equipo de prueba, borrar a mano en el equipo una cuenta gestionada. La revisión la muestra faltante y «Volver a aplicar» la crea con la clave guardada.
- [ ] 4.5 Sumar al doc del proyecto la sincronización: quién se sincroniza, la política por rol, la clave cifrada, las bajas pendientes y los conflictos.
  - Verificación: el doc actualizado.

## 5. Rotación de la cuenta de servicio (fase posterior)

- [ ] 5.1 Hacer la rotación comprobada (design §13), con `ConfirmarCuentas` y la advertencia de sobrescritura del admin local:
  - cambiar la clave en el equipo, comprobarla con un GET y recién entonces guardarla;
  - `passwordAnterior` y el reintento con la segunda clave en `authenticatedRequest` ante un 401;
  - el estado «rotación sin confirmar».
  - Pruebas con el driver simulado: rotación correcta, el equipo cambió pero no entra, y el equipo rechazó el cambio.
- [ ] 5.2 La rotación en lote, de a uno, que se detiene en la primera falla. Además, el aviso y la actualización de la clave en el canal del NVR que graba esa cámara.
  - Verificación: en el equipo de prueba, una rotación correcta y una con la comprobación forzada a fallar; el equipo nunca queda sin control y la salud sigue verde.
- [ ] 5.3 Sumar al doc del proyecto la rotación: el orden de pasos, qué hacer con «rotación sin confirmar» y el NVR.
  - Verificación: el doc actualizado.

## 6. Cierre

- [ ] 6.1 Correr `tsc --noEmit` y `node scripts/probar.js` en verde. Desplegar en el lab y recorrer las cuatro fases con un usuario Técnico, uno sin permiso y un enlace de pantalla. Comprobar que ninguna escritura de cuentas salió sin pasar por `ConfirmarCuentas`.
  - Verificación: ningún pedido de escritura salió hacia la red 192.168.1.0/24 (lo dice el registro de `exigirEscritura`).

## Workflow follow-up

- San Nicolás, sólo cuando Nico lo diga: primero la lectura sola unos días; después, si la pide, la sincronización.
- Siguientes cambios:
  - otras marcas (Dahua e Intelbras por RPC2, Axis por VAPIX, Akuvox);
  - el registro de entradas del equipo (`logSearch` de tipo Operation);
  - los avisos por WhatsApp o Telegram de cuentas y sesiones desconocidas;
  - permisos por canal.
- Archivar el cambio cuando esté completo.
