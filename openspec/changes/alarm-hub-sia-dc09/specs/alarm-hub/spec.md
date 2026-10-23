# Spec Delta

## ADDED Requirements

### Requirement: Recepción SIA DC-09
El servidor SHALL escuchar mensajes SIA DC-09 por TCP y UDP en un puerto configurable y SHALL aceptar los identificadores `SIA-DCS`, `ADM-CID`, `*SIA-DCS`, `*ADM-CID` y `NULL`. Cada mensaje SHALL validarse (CRC, largo, cuenta, hora) y contestarse con `ACK`, `NAK` o `DUH` según la norma.

#### Scenario: Alarma válida cifrada
- **WHEN** una central dada de alta con cuenta `1234` y clave AES manda `*SIA-DCS` con CRC correcto, hora dentro de la ventana y datos `#1234|Nri1/BA003`
- **THEN** el receptor contesta `ACK` cifrado con la misma secuencia, receptor, línea y cuenta, guarda el mensaje y genera un evento de categoría ALARMA (robo) en la zona 3

#### Scenario: CRC incorrecto
- **WHEN** llega una trama cuyo CRC no coincide
- **THEN** el receptor contesta `NAK` con su hora y no genera ningún evento

#### Scenario: Hora fuera de ventana
- **WHEN** un mensaje cifrado trae una hora con más de 20 s de diferencia con el receptor
- **THEN** el receptor contesta `NAK` con su hora y el mensaje queda registrado como rechazado

#### Scenario: Identificador no soportado
- **WHEN** llega un mensaje con un identificador que el receptor no maneja
- **THEN** el receptor contesta `DUH`

### Requirement: Seguridad del receptor expuesto
Una cuenta con clave SHALL rechazar los mensajes sin cifrar salvo que la central esté marcada «LAN/VPN». Una cuenta desconocida SHALL recibir `NAK` y quedar en el registro de intentos con su IP. Un mensaje repetido (misma cuenta, secuencia y hora) SHALL contestarse con `ACK` sin generar un segundo evento. La clave AES MUST NOT aparecer en claro en la base, en los logs ni en las respuestas de la API.

#### Scenario: Central sin cifrar en internet
- **WHEN** una central con cifrado obligatorio manda `SIA-DCS` sin asterisco
- **THEN** el receptor contesta `NAK` y no genera evento

#### Scenario: Reintento de la central
- **WHEN** la central reenvía el mismo mensaje porque no le llegó el `ACK`
- **THEN** el receptor contesta `ACK` otra vez y la Gestión de alarmas muestra una sola alarma

### Requirement: Alta y adopción del Alarm Hub
«Nuevo dispositivo» SHALL ofrecer el tipo Alarm Hub con los modelos Hikvision AX PRO, Hikvision AX Hybrid PRO y Genérica DC-09. Al darla de alta, OmniAccess SHALL asignar una cuenta única y generar la clave AES. La ficha SHALL mostrar el estado de la adopción: Esperando la central, En línea o Sin supervisión.

#### Scenario: Adopción de una AX PRO
- **WHEN** se da de alta una AX PRO con IP y credenciales de administrador y se aprieta «Vincular»
- **THEN** OmniAccess escribe en la central el centro receptor (dirección pública, puerto, cuenta, protocolo cifrado, clave, supervisión) y la ficha queda en «Esperando la central» hasta el primer mensaje, después «En línea»

#### Scenario: Adopción de una central genérica
- **WHEN** se da de alta una Genérica DC-09
- **THEN** la ficha muestra dirección, puerto, cuenta, protocolo y clave para cargarlos en la central, y pasa a «En línea» con el primer mensaje

### Requirement: Supervisión
Cada central SHALL tener un período de supervisión. Si pasa ese período (con un margen) sin ningún mensaje, OmniAccess SHALL marcarla «Sin supervisión» y generar una alerta de salud del equipo; con el próximo mensaje SHALL volver a «En línea».

#### Scenario: Central que deja de reportar
- **WHEN** una central con supervisión de 60 s no manda nada en 3 minutos
- **THEN** la ficha y la salud de Dispositivos la muestran «Sin supervisión» y se genera la alerta

### Requirement: Zonas de la central
Cada central SHALL tener zonas con número, partición, nombre, área de Dispositivos y cámaras asociadas. En una AX las zonas SHALL poder leerse de la central; en una Genérica SHALL cargarse a mano o crearse al recibir un evento de una zona desconocida.

#### Scenario: Zona aprendida
- **WHEN** llega un evento de la zona 7 que la central no tenía cargada
- **THEN** se crea la zona 7 sin nombre y el evento se muestra como «Zona 7»

### Requirement: Estado y armado desde OmniAccess (AX)
Para una AX, la ficha y el monitor SHALL mostrar el estado de particiones y zonas leído de la central, y quien tenga el permiso de control de centrales SHALL poder armar (ausente / presente) y desarmar con confirmación. Cada orden SHALL quedar en Auditoría.

#### Scenario: Desarmar
- **WHEN** un usuario con el permiso desarma la partición 1 y confirma
- **THEN** OmniAccess manda la orden a la central, muestra el estado nuevo leído de la central y anota quién y cuándo en Auditoría
