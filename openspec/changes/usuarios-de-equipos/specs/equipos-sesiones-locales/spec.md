# Spec Delta

## Purpose

Que se pueda saber quién está conectado a cada equipo y desde dónde. Las sesiones de OmniAccess y de los grabadores se separan de las que vienen de una IP que no se conoce, y queda registro de cada una.

## ADDED Requirements

### Requirement: Lectura de sesiones abiertas
En los equipos cuya marca lo permite, el sistema SHALL leer las sesiones abiertas y guardar por cada una: la cuenta, la IP de origen y desde cuándo está. Una sesión que deja de aparecer se cierra con la hora de la lectura en la que ya no estaba.

#### Scenario: Dos sesiones en una cámara
- **WHEN** la cámara informa dos sesiones de `admin`, una desde el servidor y otra desde el grabador
- **THEN** el bloque del equipo muestra las dos, con su IP y desde qué hora

#### Scenario: Una sesión que terminó
- **WHEN** una sesión que estaba abierta no aparece en la lectura siguiente
- **THEN** queda cerrada en el registro, con su comienzo y la hora en que se la dejó de ver

### Requirement: Procedencia de cada sesión
Cada sesión SHALL quedar etiquetada según su IP de origen:

- **servidor**: el propio OmniAccess;
- **grabador**: un equipo NVR dado de alta;
- **equipo conocido**: otro equipo dado de alta;
- **desconocida**: cualquier otra IP.

#### Scenario: La sesión del grabador
- **WHEN** la IP de origen es la de un NVR dado de alta
- **THEN** la sesión figura como «grabador» con el nombre de ese NVR

### Requirement: Aviso de sesión desconocida
Cuando aparece una sesión desde una IP desconocida, el sistema SHALL registrarla en Auditoría y abrir una alerta del equipo con la cuenta y la IP. El sistema MUST NOT cortar esa sesión.

#### Scenario: Alguien entra con la admin desde una notebook
- **WHEN** se abre una sesión de `admin` desde 192.168.1.77, que no es de ningún equipo ni del servidor
- **THEN** el equipo tiene la alerta «Sesión desde una IP desconocida: admin desde 192.168.1.77», y Auditoría la registra

#### Scenario: La misma sesión sigue abierta
- **WHEN** esa sesión sigue en las lecturas siguientes
- **THEN** no se repite la alerta ni el registro

#### Scenario: IP desconocida aceptada
- **WHEN** quien tiene `dispositivos.usuarios` marca 192.168.1.77 como conocida, con un nombre («PC de la guardia»)
- **THEN** las sesiones desde esa IP dejan de avisar y figuran con ese nombre

### Requirement: Historia de sesiones
El registro de sesiones SHALL guardarse con una retención definida, y SHALL poder consultarse por equipo, por cuenta y por IP de origen.

#### Scenario: Quién entró a la cámara el fin de semana
- **WHEN** se filtran las sesiones de «Cámara Acceso 1» entre el sábado y el domingo
- **THEN** se listan las sesiones de esos días, con cuenta, IP, procedencia, comienzo y fin
