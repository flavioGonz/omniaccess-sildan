# Spec Delta

## Purpose

Que OmniAccess vea, clasifique y administre las cuentas locales de cada equipo (cámaras, LPR, grabadores y terminales), para centralizar quién puede entrar a cada uno y detectar las cuentas que nadie dio de alta desde el panel.

## ADDED Requirements

### Requirement: Función de la instalación
Todo lo de cuentas, sesiones y sincronización SHALL depender de la función «Usuarios de equipos» de la instalación, apagada por defecto. Apagada, no se lee ningún equipo, no se muestran el bloque ni la pantalla, y las rutas responden 404 de función apagada.

#### Scenario: Instalación nueva
- **WHEN** se despliega la versión en una instalación sin tocar Ajustes
- **THEN** no sale ningún pedido de cuentas o sesiones a los equipos y no aparece nada nuevo en el panel

#### Scenario: Se prende en Ajustes → Modos
- **WHEN** se prende «Usuarios de equipos»
- **THEN** la próxima vuelta de la tarea lee los equipos compatibles y aparecen el bloque y la pantalla

### Requirement: Inventario de cuentas por equipo
El sistema SHALL leer las cuentas locales de cada equipo cuya marca tenga la capacidad «usuarios», guardando por cuenta: nombre, id en el equipo, nivel, si el equipo la deja borrar, primera y última vez vista. Una cuenta que deja de aparecer se marca desaparecida, sin borrar su historia.

#### Scenario: Primera lectura de un equipo
- **WHEN** se leen las cuentas de una cámara Hikvision que tiene `admin` y `guardia1`
- **THEN** el inventario de esa cámara muestra las dos cuentas con su nivel y la fecha de la lectura

#### Scenario: Una cuenta borrada en el equipo
- **WHEN** una cuenta que estaba en el inventario no aparece en la lectura siguiente
- **THEN** queda marcada como desaparecida con la fecha, y sigue visible en su historia

#### Scenario: Equipo que no contesta
- **WHEN** la lectura de un equipo falla (sin respuesta, 401 o 404)
- **THEN** el inventario conserva lo último leído, muestra cuándo fue y por qué falló esta vez, y no marca ninguna cuenta como desaparecida

### Requirement: Clasificación de cada cuenta
Cada cuenta SHALL quedar en una de cuatro clases: servicio (la que usa OmniAccess para hablar con el equipo), de fábrica (la que el equipo no deja borrar), gestionada (la creó OmniAccess para un usuario del panel) o no gestionada (cualquier otra).

#### Scenario: La cuenta con la que habla OmniAccess
- **WHEN** el equipo está dado de alta con el usuario `admin` y la lectura trae `admin`
- **THEN** esa cuenta figura como «servicio»

#### Scenario: Una cuenta creada a mano en el equipo
- **WHEN** aparece `tecnico2`, que OmniAccess no creó y no es la de servicio ni la de fábrica
- **THEN** figura como «no gestionada»

### Requirement: Aviso de cuenta no gestionada
Cuando una lectura encuentra una cuenta no gestionada que antes no estaba, el sistema SHALL abrir una alerta del equipo y registrar el hallazgo en Auditoría. El sistema MUST NOT borrar, deshabilitar ni modificar esa cuenta por su cuenta.

#### Scenario: Aparece una cuenta nueva
- **WHEN** la lectura de las 14:00 trae `invitado` y la de las 13:00 no lo traía
- **THEN** el equipo tiene una alerta abierta «Cuenta no gestionada: invitado», Auditoría registra «Cuenta nueva en el equipo» y la cuenta sigue en el equipo

#### Scenario: La misma cuenta en la lectura siguiente
- **WHEN** la cuenta no gestionada sigue estando en la lectura siguiente
- **THEN** no se abre una segunda alerta ni se repite el registro

#### Scenario: Se la reconoce como conocida
- **WHEN** quien tiene `dispositivos.usuarios` marca la cuenta como conocida, con un motivo
- **THEN** la alerta se cierra, la cuenta sigue «no gestionada» con la marca de conocida, y Auditoría registra quién la marcó y por qué

### Requirement: Altas, cambios y bajas a mano
Quien tenga el permiso `dispositivos.usuarios` SHALL poder crear una cuenta en un equipo compatible de un área gestionada, cambiarle la clave o el nivel, y borrarla. Cada acción pasa por la confirmación previa (ver `equipos-confirmacion-cambios`), se aplica en el equipo, se vuelve a leer para verificarla y queda en Auditoría con quién, qué equipo y el resultado.

#### Scenario: Crear una cuenta
- **WHEN** se crea `supervisor` como Operador en una cámara y el equipo la acepta
- **THEN** la lectura posterior la trae, figura como gestionada por un alta manual, y Auditoría registra el alta con resultado correcto

#### Scenario: El equipo rechaza la clave
- **WHEN** la clave no cumple la regla del equipo (largo o tipos de carácter)
- **THEN** se rechaza antes de enviarla, explicando la regla; si el equipo igual la rechaza, se muestra su motivo y nada cambia en el inventario

#### Scenario: Sin permiso
- **WHEN** un usuario sin `dispositivos.usuarios` pide crear o borrar una cuenta
- **THEN** la API responde 403 y el panel no le ofrece esas acciones

### Requirement: Cuentas protegidas
El sistema MUST NOT borrar, deshabilitar, renombrar ni cambiar la clave o el nivel de la cuenta de servicio ni de la cuenta de fábrica de un equipo desde esta función. La única excepción es la rotación de la cuenta de servicio, especificada aparte.

#### Scenario: Intento de borrar la cuenta de servicio
- **WHEN** se pide borrar la cuenta con la que OmniAccess habla con el equipo
- **THEN** se rechaza con «Es la cuenta con la que OmniAccess maneja este equipo: borrarla lo deja sin control», y no sale ningún pedido al equipo

### Requirement: Claves fuera de la vista
Las claves de las cuentas SHALL viajar sólo hacia el equipo. El sistema MUST NOT mostrarlas, devolverlas por la API, escribirlas en registros ni guardarlas en Auditoría.

#### Scenario: Auditoría de un cambio de clave
- **WHEN** se cambia la clave de una cuenta
- **THEN** Auditoría dice «Cambió la clave de supervisor en Cámara Acceso 1» sin el valor de la clave

### Requirement: Equipos de sólo lectura
En un equipo marcado de sólo lectura para el servidor (`OMNI_EQUIPOS_SOLO_LECTURA`), el sistema SHALL leer cuentas y sesiones, y MUST NOT enviar ningún alta, cambio ni baja. El panel lo dice en lugar de ofrecer las acciones.

#### Scenario: Desde el lab, un equipo de San Nicolás
- **WHEN** en el lab se abre la ficha de un equipo de la red 192.168.1.0/24
- **THEN** se ven sus cuentas y sesiones, las acciones de escritura no aparecen, y un pedido directo a la API se corta antes de salir con el aviso de sólo lectura

### Requirement: Marcas sin soporte
Para un equipo cuya marca no tiene la capacidad «usuarios», el sistema SHALL decir que no se pueden leer sus cuentas todavía, en vez de mostrar una lista vacía.

#### Scenario: Una central de alarma
- **WHEN** se abre el bloque «Usuarios del equipo» de un Alarm Hub genérico
- **THEN** dice «Las cuentas de esta marca todavía no se leen» y no muestra acciones

### Requirement: Vista de cuentas en Dispositivos
La vista «Cuentas» de Dispositivos SHALL listar las cuentas de los equipos del área elegida y sus sub-áreas («Todas» lista las de todo el sitio). Se puede filtrar por clase, por nivel, por equipo y por nombre de cuenta, para ver en qué equipos está cada nombre. No hay una pantalla aparte fuera de Dispositivos.

#### Scenario: Dónde está una persona
- **WHEN** en «Todas» se busca `jperez`
- **THEN** la tabla muestra cada equipo donde existe esa cuenta, con su área, su nivel, su clase y la última vez que se vio
