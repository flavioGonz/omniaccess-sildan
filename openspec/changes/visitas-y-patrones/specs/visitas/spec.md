# Spec Delta

## Purpose

Registra quién está de visita en el barrio, a qué lote fue y cuánto tiempo tiene, desde que entra hasta que sale, para que la guardia sepa en todo momento quién está adentro y quién se pasó de su tiempo.

## ADDED Requirements

### Requirement: Tipos de visita con tiempo configurable
El sistema SHALL tener una lista configurable de tipos de visita, cada uno con nombre y tiempo permitido en minutos. Por defecto MUST incluir Delivery (15 min), Servicio (120 min), Obra (480 min) y Visita (180 min). Un tipo en uso no se puede borrar, sólo desactivar.

#### Scenario: Cambiar el tiempo del delivery
- **WHEN** un administrador cambia Delivery a 20 minutos
- **THEN** las visitas de Delivery que se registren desde ese momento vencen a los 20 minutos y las ya abiertas conservan su vencimiento

### Requirement: Registro de una visita por la guardia
La guardia SHALL poder registrar una visita desde su consola eligiendo tipo y lote (de la lista de lotes del barrio), con matrícula, nombre y empresa opcionales. La visita MUST guardar quién la registró, la hora de entrada y el vencimiento calculado con el tiempo del tipo.

#### Scenario: Delivery que para en la garita
- **WHEN** el guardia registra Delivery, Lote 42, matrícula ABC123
- **THEN** queda una visita en curso con entrada ahora, vencimiento en 15 minutos y el nombre del guardia

#### Scenario: Moto sin matrícula visible
- **WHEN** el guardia registra un Delivery sin matrícula
- **THEN** la visita se crea igual y sólo puede cerrarla el guardia o el fin del día

### Requirement: Visita abierta por invitación
Cuando se lee en una cámara de entrada una matrícula de una invitación vigente, el sistema SHALL abrir una visita de tipo Visita con el lote y el anfitrión de la invitación y el vencimiento en el fin de la vigencia del pase, salvo que esa matrícula ya tenga una visita en curso.

#### Scenario: Invitado que entra
- **WHEN** entra la matrícula de un invitado cuyo pase vale hasta las 18:00
- **THEN** se abre su visita con su lote, vence a las 18:00 y figura como "por invitación"

### Requirement: Cierre de la visita
Una visita en curso SHALL cerrarse sola cuando una cámara de salida lee su matrícula, guardando la hora de salida y la lectura que la cerró. El guardia SHALL poder cerrarla a mano. Las visitas que sigan abiertas a la hora de corte del día MUST cerrarse como "sin salida registrada", sin generar aviso.

#### Scenario: Salida leída
- **WHEN** la cámara de Salida lee ABC123 con una visita en curso
- **THEN** la visita queda cerrada con su duración y "cerrada por la cámara de Salida"

#### Scenario: Fin del día
- **WHEN** llega la hora de corte y una visita sin matrícula sigue abierta
- **THEN** se cierra como "sin salida registrada" y no avisa a nadie

### Requirement: Extender una visita
El guardia SHALL poder extender una visita en curso o vencida sumando minutos a su vencimiento; la extensión MUST quedar registrada con quién la hizo y desaparece el aviso de excedida si lo había.

#### Scenario: El delivery se demora
- **WHEN** el guardia extiende 10 minutos una visita de Delivery vencida hace 2 minutos
- **THEN** la visita vuelve a estar en curso con 8 minutos restantes y su aviso de excedida queda atendido

### Requirement: Visitas en el barrio a la vista
El monitor LPR y la consola del guardia SHALL mostrar las visitas en curso con matrícula o nombre, tipo, lote y cuenta atrás (en ámbar en el último 20 % del tiempo y en rojo excedida), ordenadas por lo que vence antes. En modo ABIERTO el monitor SHALL mostrar además las matrículas no registradas que entraron hoy sin salida leída, con el tiempo que llevan marcado como estimado.

#### Scenario: Delivery excedido en el monitor
- **WHEN** una visita de Delivery pasa sus 15 minutos sin salida
- **THEN** en "En el barrio ahora" aparece en rojo con el tiempo excedido, sin recargar la pantalla

#### Scenario: No registrado en barrio abierto
- **WHEN** entró una matrícula no registrada hace 40 minutos y no se la vio salir
- **THEN** aparece como "no registrada · ~40 min (estimado)" sin cuenta atrás
