# Spec Delta

## Purpose
El envío manual de un clip de grabación por WhatsApp desde la ventana de video del panel: a quién puede ir, qué ve el operador mientras tanto, y cómo queda registrado.

## ADDED Requirements

### Requirement: Enviar por WhatsApp desde el diálogo del clip
El diálogo previo a descargar un clip SHALL ofrecer, además de Descargar, la acción "Enviar por WhatsApp" con la misma ventana antes/después que el operador eligió para ese clip, y SHALL requerir una sesión con permiso sobre el video del panel (un enlace de pantalla no puede enviar).

#### Scenario: Envío con la ventana elegida
- **WHEN** el operador ajusta la ventana a 15 s antes y 5 s después y elige Enviar por WhatsApp
- **THEN** el clip enviado cubre exactamente esa ventana alrededor del instante marcado, con una leyenda que indica cámara, fecha y hora, y matrícula si el clip se abrió desde una lectura.

#### Scenario: Sin permiso
- **WHEN** quien intenta enviar no tiene sesión con permiso sobre esa pantalla, o es un enlace de pantalla
- **THEN** el envío se rechaza y no se produce ningún clip.

### Requirement: Los destinatarios son conocidos por el sistema
El sistema SHALL permitir elegir como destinatarios únicamente los destinatarios de WhatsApp del Centro de Notificaciones (propuestos ya tildados los habilitados) y los usuarios o residentes del barrio con teléfono registrado, y SHALL rechazar cualquier número que no sea uno de ellos.

#### Scenario: Destinatarios propuestos
- **WHEN** se abre el envío
- **THEN** aparecen tildados los destinatarios de WhatsApp habilitados del Centro de Notificaciones, y se puede sumar un usuario o residente buscándolo por nombre, lote o teléfono.

#### Scenario: Número desconocido
- **WHEN** se intenta enviar a un número que no corresponde a ningún destinatario ni usuario registrado
- **THEN** el envío se rechaza con el motivo y no se produce el clip.

### Requirement: El operador ve el estado real del envío
Mientras el clip se produce y se envía, el diálogo SHALL mostrar el estado en curso ("Armando el clip…", "Enviando a N…") y al terminar SHALL informar el resultado por destinatario, con el error concreto si falló; el proceso SHALL tener un tope de tiempo pasado el cual se informa como fallido.

#### Scenario: Envío exitoso
- **WHEN** el clip se produce y el motor de mensajería acepta el envío a todos los destinatarios
- **THEN** el diálogo muestra "Enviado a <nombres>" con la hora y permite cerrar o enviar a otro.

#### Scenario: Fallo o tope de tiempo
- **WHEN** el clip no se puede producir, un destinatario falla o se supera el tope de tiempo
- **THEN** el diálogo muestra el motivo concreto y qué destinatarios sí lo recibieron, y nada se da por enviado sin confirmación del motor.

### Requirement: El envío manual queda registrado
Cada envío manual SHALL quedar en la bandeja de despachos como un despacho de tipo clip, con cámara, instante, ventana, destinatarios, quién lo envió y el resultado, sin mezclarse con las alertas automáticas.

#### Scenario: Fila en despachos
- **WHEN** un operador envía un clip desde el playback
- **THEN** la bandeja de despachos muestra una fila de tipo clip con su nombre de usuario, la cámara, la hora del instante y el estado del envío.
