# Spec Delta

## Purpose

Administrar los roles y los usuarios del sistema de forma clara y segura: ver de un vistazo qué puede hacer cada rol, armarlo rápido y saber quién cambió qué.

## ADDED Requirements

### Requirement: Editor de roles en matriz

Ajustes → Accesos → Roles SHALL mostrar el rol elegido como una matriz:
- una fila por sección, agrupada por módulo, y una columna por nivel (Ver, Operar, Configurar);
- donde un nivel no existe para esa sección, la celda queda vacía;
- cada módulo se puede prender o apagar entero, y cada nivel también en todo el módulo;
- arriba, cuántos permisos tiene el rol, cuántos son delicados y cuántos usuarios lo usan.

#### Scenario: Marcar un módulo entero
- **WHEN** el administrador prende «Alarm Hub» en la cabecera del módulo
- **THEN** quedan marcados ver, tratar, armar y desarmar, y configurar de Alarm Hub, y el contador lo refleja

#### Scenario: Operar marca Ver
- **WHEN** se marca «Intrusión · atender»
- **THEN** «Intrusión · ver» queda marcado y no se puede desmarcar mientras atender siga marcado

### Requirement: Explicación de cada permiso

Cada permiso de la matriz SHALL tener una ayuda (al pasar el mouse o al tocar) que dice qué habilita, en qué pantallas, y, si es delicado, por qué.

#### Scenario: Ayuda de crear enlaces
- **WHEN** el administrador pasa el mouse por «Monitores · crear enlaces de pantalla»
- **THEN** la ayuda dice que un enlace abre una vista sin usuario y sin vencimiento hasta que se revoque

### Requirement: Módulos de la instalación a la vista

Cada módulo de la matriz SHALL indicar si está activo en esta instalación, según el modo y las funciones (Intrusión, Recepción y Gestión de alarmas, OmniVision, Filas, Rostro). Un módulo apagado se puede asignar igual, se ve atenuado y dice «apagado en esta instalación».

#### Scenario: Instalación en modo Filas
- **WHEN** se edita un rol en una instalación en modo Filas
- **THEN** LPR y Rostro figuran como apagados en esta instalación, y Filas como activo

### Requirement: Plantillas de rol

Al crear un rol, el sistema SHALL ofrecer plantillas con su descripción: Supervisor, Operador de monitoreo, Guardia de garita, Técnico, Administración del barrio y Auditor (sólo ver). Elegir una plantilla crea un rol editable con esos permisos. Las plantillas no SHALL incluir Accesos ni Mantenimiento.

#### Scenario: Crear un operador de monitoreo
- **WHEN** el administrador elige la plantilla Operador de monitoreo y le pone nombre
- **THEN** se crea un rol con ver y atender en Gestión de alarmas, Intrusión, Alarm Hub (ver y tratar), Video (vivo y grabaciones) y Monitores (ver), sin nada de Administración

### Requirement: Roles de sistema protegidos

El rol Administrador SHALL tener siempre todo, y no SHALL poder editarse ni borrarse. Un rol en uso no SHALL poder borrarse; el sistema dice cuántos usuarios lo tienen. Un administrador no SHALL poder quitarse a sí mismo el acceso a Accesos si es el último que lo tiene.

#### Scenario: Último administrador
- **WHEN** el único usuario con Accesos intenta cambiarse a un rol sin Accesos
- **THEN** el sistema lo rechaza y explica que quedaría la instalación sin nadie que administre los accesos

### Requirement: Auditoría de accesos

Crear, editar, duplicar o borrar un rol, y crear, editar o borrar un usuario del sistema, o cambiarle el rol, SHALL quedar en Auditoría. Cada entrada al panel, correcta o fallida, también SHALL quedar registrada. El registro guarda quién lo hizo, cuándo, a qué rol o usuario, y qué permisos se agregaron o se sacaron.

#### Scenario: Se le agrega Mantenimiento a un rol
- **WHEN** un administrador agrega Mantenimiento al rol Supervisor
- **THEN** Auditoría muestra quién, cuándo, el rol Supervisor y «+ Mantenimiento»

### Requirement: Usuarios con su alcance a la vista

En Ajustes → Accesos → Usuarios, cada usuario del sistema SHALL mostrar:
- su rol y un resumen de lo que puede, por módulo;
- su última entrada al panel, o «sin entradas registradas» si no entró desde que se registran.

La tabla SHALL poder filtrarse por rol.

#### Scenario: Filtrar por rol
- **WHEN** se filtra por el rol Guardia de garita
- **THEN** la tabla muestra sólo los usuarios con ese rol, con su resumen por módulo
