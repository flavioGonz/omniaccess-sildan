# Spec Delta

## Purpose

Una vista de pantalla para los accesos por reconocimiento facial de las terminales: quién entra y quién sale por cara, si se le abrió y por qué no, con la misma lógica y el mismo criterio de colores que el Control LPR.

## ADDED Requirements

### Requirement: Vista Face en Monitores

El catálogo de vistas de pantalla SHALL incluir **Monitor Face** (`/monitor/face`). `/admin/monitores` SHALL ofrecerla como las demás: abrirla, emitir un enlace de pantalla y sumarla a una rotación. Con sesión, SHALL pedir el permiso `rostros`. Un enlace de pantalla de la vista Face SHALL abrir sólo esa vista y sus datos.

#### Scenario: La vista aparece
- **WHEN** un usuario con `monitores.config` abre `/admin/monitores`
- **THEN** entre las vistas está Monitor Face, con para quién es y qué muestra

#### Scenario: Instalación sin terminales faciales
- **WHEN** se abre Monitor Face en una instalación sin terminales faciales
- **THEN** la vista dice que no hay terminales faciales dadas de alta, en lugar de una pantalla vacía

### Requirement: Sólo terminales faciales

La vista SHALL mostrar únicamente los accesos registrados por terminales faciales (tipo de equipo terminal facial, credencial de rostro). Las lecturas de matrícula, de tarjeta y las detecciones de las cámaras de OmniVision no SHALL aparecer.

#### Scenario: Acceso por tarjeta en la misma terminal
- **WHEN** una terminal facial registra un acceso con tarjeta
- **THEN** no aparece en Monitor Face

### Requirement: El último acceso en grande

La vista SHALL mostrar el último acceso en grande, con:
- la foto que tomó la terminal y, si la persona está en el padrón, su foto cargada, lado a lado;
- su nombre y su unidad;
- la terminal y el sentido (entrada o salida);
- la hora;
- si se permitió o se denegó, y por qué. Un rostro que no se reconoce figura como «Desconocido».

#### Scenario: Foto del padrón faltante
- **WHEN** la persona reconocida no tiene foto en el padrón
- **THEN** se ve sólo la foto tomada, sin un hueco vacío

### Requirement: El color de la pared dice cómo fue el acceso

El fondo de la pared SHALL seguir el criterio común de colores de las paredes: verde si se permitió, rojo si se denegó a un desconocido o a alguien en lista negra, y ámbar si se denegó por otro motivo (horario, vencido). Pasados unos segundos sin accesos nuevos, SHALL volver a calma.

#### Scenario: Permitido
- **WHEN** la terminal reconoce a un residente y abre
- **THEN** se ve su foto tomada junto a la del padrón, su nombre y unidad, «Permitido», y la pared en verde

#### Scenario: Desconocido
- **WHEN** la terminal no reconoce el rostro y niega
- **THEN** se ve la foto tomada, «Desconocido», «Denegado», y la pared en rojo

### Requirement: Tira, contadores y atención

Debajo del último acceso SHALL verse la tira de los **diez anteriores** (foto, nombre o «Desconocido», hora, permitido o denegado), los **contadores del día** (permitidos, denegados, desconocidos) y una fila de **atención** con los denegados y desconocidos de la última hora. Los accesos nuevos SHALL llegar en vivo, sin recargar. La vista SHALL poder sonar con un acceso denegado, con los mismos modos que el Control LPR (sin sonido, en cada denegado, sólo desconocidos).

#### Scenario: Llega un acceso
- **WHEN** una terminal registra un acceso nuevo
- **THEN** pasa a ser el acceso grande, el anterior pasa a la tira y los contadores se actualizan sin recargar

#### Scenario: Atención
- **WHEN** hubo tres desconocidos en la última hora
- **THEN** la fila de atención los muestra con su foto y su hora
