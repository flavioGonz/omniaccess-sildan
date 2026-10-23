# Spec Delta

## Purpose

Hacer que un permiso se cumpla donde importa: en las páginas, en las acciones de servidor y en la API. Que el rol de una persona no dependa de que el menú le esconda un botón.

## ADDED Requirements

### Requirement: Las páginas piden su permiso

Una página del panel SHALL abrirse sólo si la sesión tiene el permiso de esa página. Si no lo tiene, el sistema SHALL llevar a la pantalla «sin permiso», que nombra el permiso que falta. El menú SHALL mostrar sólo las entradas que la sesión puede abrir.

#### Scenario: Operador sin Alarm Hub
- **WHEN** un usuario sin ningún permiso de Alarm Hub abre Gestión de alarmas
- **THEN** no ve el grupo Alarm Hub ni sus pestañas, y los demás grupos que sí tiene funcionan igual

### Requirement: Las acciones de servidor piden su permiso

Cada acción de servidor que cambia algo SHALL pedir un permiso del catálogo. Una sesión del panel sin ese permiso SHALL recibir un rechazo (403) con el nombre del permiso que falta, y la acción no SHALL ejecutarse. Las lecturas SHALL bastar con la sesión, salvo estas lecturas delicadas, que piden su propio permiso:
- los ajustes que guardan secretos (tokens, claves, cadenas de conexión);
- los usuarios del sistema y los roles;
- los respaldos.

#### Scenario: Restaurar un respaldo sin Mantenimiento
- **WHEN** un usuario con sólo «Monitor LPR · ver» invoca la acción de restaurar un respaldo
- **THEN** recibe 403 «hace falta el permiso Mantenimiento», el respaldo no se restaura y el rechazo queda registrado con el usuario y la acción

#### Scenario: Leer la configuración de una pantalla
- **WHEN** un operador abre un monitor que lee un ajuste común (no secreto)
- **THEN** la lectura funciona con su sesión, sin pedir Ajustes

#### Scenario: Leer un secreto
- **WHEN** una sesión sin Ajustes pide el valor del token de Telegram
- **THEN** recibe 403 y no recibe el valor

### Requirement: La API pide su permiso

Cada ruta de `/api` que cambia algo (POST, PUT, PATCH, DELETE) SHALL pedir un permiso del catálogo cuando se llama con la sesión del panel. Una sesión sin el permiso SHALL recibir 403 en JSON con el permiso que falta. Las rutas públicas, las de los equipos (webhooks, ticks con token propio), las de los enlaces de pantalla y las de la consola de guardia SHALL conservar sus reglas actuales.

#### Scenario: Tratar un evento de central sin permiso
- **WHEN** una sesión sin «Alarm Hub · tratar» manda tratar un evento a `/api/centrales/eventos/<id>`
- **THEN** recibe 403 y el evento sigue pendiente

#### Scenario: Webhook de un equipo
- **WHEN** una cámara manda un evento a su webhook con su token
- **THEN** la ruta se comporta igual que antes del cambio

### Requirement: Nada sin clasificar

Toda acción de servidor exportada y toda ruta de API SHALL estar clasificada como una de estas: anónima, de guardia, de lectura con sesión, o con su permiso. Lo que no esté clasificado no SHALL ejecutarse con la sesión del panel. Una prueba SHALL fallar si una acción o una ruta queda sin clasificar o con un permiso que no existe.

#### Scenario: Acción nueva sin clasificar
- **WHEN** se agrega una acción de servidor y no se la clasifica
- **THEN** la prueba de clasificación falla y nombra el archivo y la función

### Requirement: Modo sólo avisar para la puesta en marcha

Durante la puesta en marcha, el sistema SHALL poder correr en «sólo avisar»: en lugar de rechazar, registra cada llamada que habría rechazado, con usuario, rol, acción o ruta y permiso faltante. Se activa con una variable de entorno y no queda prendido por defecto.

#### Scenario: Lab en sólo avisar
- **WHEN** el lab corre con el modo sólo avisar y un operador usa una acción que su rol no cubre
- **THEN** la acción se ejecuta y queda un registro que dice qué permiso faltó

### Requirement: Los rechazos quedan registrados

Cada rechazo por permiso SHALL quedar en el registro del servidor con fecha, usuario, rol, qué se intentó y el permiso que faltaba.

#### Scenario: Rechazo visible
- **WHEN** una acción se rechaza por permiso
- **THEN** el registro del servidor tiene una línea con usuario, rol, acción y permiso
