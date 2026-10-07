# Spec Delta

## Purpose
Cómo una alerta de LPR, intrusión o aforo enviada por WhatsApp o Telegram lleva un clip de video del evento en lugar de la foto, con qué retardo, y qué pasa —y qué se registra— cuando no hay clip.

## ADDED Requirements

### Requirement: La alerta lleva el clip del evento cuando el ajuste está activo
Cuando el ajuste "Clip animado en alertas" está activo, cada alerta por WhatsApp o Telegram SHALL adjuntar el clip del instante del evento, con la ventana de alerta configurada (segundos antes y después, con valores por defecto y topes propios), y el texto de la alerta como leyenda del video.

#### Scenario: Evento LPR con cámara en un NVR
- **WHEN** una regla LPR activa dispara por una lectura de una cámara mapeada a un NVR y el clip animado está activo
- **THEN** el destinatario recibe un único mensaje con el video del evento (ventana de alerta) y el texto de la alerta como leyenda.

#### Scenario: Evento de intrusión con cámara sin NVR pero con anillo
- **WHEN** una regla de intrusión activa dispara por una cámara sin NVR que tiene anillo local
- **THEN** el destinatario recibe el video tomado del anillo, con el mismo texto de alerta.

### Requirement: La alerta espera lo justo para que exista el video
El sistema SHALL demorar el envío de la alerta con clip únicamente el tiempo necesario para que exista el tramo posterior del video (segundos después más el margen del origen), y SHALL enviarla sin demora adicional cuando el clip animado está apagado.

#### Scenario: Retardo acotado
- **WHEN** la ventana de alerta es de 5 s después y el clip animado está activo
- **THEN** la alerta se envía dentro de los 5 s más el margen de grabación configurado, más el tiempo de corte; nunca espera la ventana de playback.

#### Scenario: Clip animado apagado
- **WHEN** el ajuste está desactivado
- **THEN** la alerta sale de inmediato con la foto, como hasta ahora, sin intentar producir ningún clip.

### Requirement: Sin clip, va la foto y se registra por qué
Si el clip no se puede producir o enviar, el sistema SHALL enviar la alerta con la foto del evento (o sólo texto si tampoco hay foto) dentro del mismo despacho, SHALL registrar en el despacho el motivo por el que no hubo video, y SHALL mostrar ese motivo en la bandeja de despachos.

#### Scenario: Cámara sin fuente de video
- **WHEN** la cámara del evento no está en ningún NVR ni tiene anillo
- **THEN** la alerta sale con la foto, y el despacho queda como enviado con la nota "sin video: la cámara no está en ningún grabador".

#### Scenario: El motor de WhatsApp rechaza el video
- **WHEN** el video se produjo pero el motor de mensajería devuelve error al enviarlo (por URL y por contenido directo)
- **THEN** la alerta sale con la foto en el mismo despacho y la nota indica el error del motor.

### Requirement: El interruptor describe lo que hace y a qué cámaras alcanza
El control "Clip animado en alertas" SHALL describir la ventana de alerta vigente y el respaldo con foto, y SHALL mostrar, para las cámaras alcanzadas por reglas activas, cuáles tienen fuente de video (NVR o anillo) y cuáles no, de modo que un ajuste activo nunca aparente cubrir cámaras que no cubre.

#### Scenario: Cámara con regla activa y sin fuente
- **WHEN** una regla activa alcanza una cámara que no está en ningún NVR y no tiene anillo
- **THEN** el control la lista como "sin video (va con foto)" aunque el interruptor esté activo.

#### Scenario: Ventana de alerta configurable
- **WHEN** el administrador cambia los segundos antes/después de la alerta en Ajustes → Video del evento
- **THEN** el control refleja la nueva ventana y las alertas siguientes la usan sin reiniciar procesos.

### Requirement: La foto de la alerta lleva el logo de OmniAccess
La foto que acompaña una alerta por WhatsApp SHALL llevar el logo de OmniAccess abajo a la derecha mientras el ajuste «Logo en lo que sale por WhatsApp» esté activo; apagado, la foto sale como la entrega la cámara.

#### Scenario: Alerta con foto
- **WHEN** una alerta sale por WhatsApp con la foto del evento y el ajuste está activo
- **THEN** la imagen recibida tiene el logo en la esquina inferior derecha, legible sobre fondo claro u oscuro.
