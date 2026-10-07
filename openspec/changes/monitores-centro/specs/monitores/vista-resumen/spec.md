# Spec Delta

## Purpose
La vista Resumen del barrio es la pantalla del supervisor: los números del día de un vistazo, sin fotos grandes ni mapa.

## ADDED Requirements

### Requirement: KPI del día
La vista SHALL mostrar, en tarjetas grandes: vehículos adentro ahora, entradas y salidas del día, denegados del día, visitas activas (pases de hoy que ya entraron y no salieron), cámaras en línea / caídas, alarmas de intrusión pendientes y confirmadas sin resolver. Cada número MUST llevar la hora de su última actualización y, al pasar el mouse o en una línea debajo, de dónde sale.

#### Scenario: Una cámara se cae
- **WHEN** la salud de dispositivos marca una cámara como caída
- **THEN** la tarjeta "Cámaras" pasa a mostrar "N en línea · 1 caída" en ámbar y nombra la caída

### Requirement: Pulso del día
La vista SHALL mostrar las lecturas por hora del día en una tira de barras (misma fuente que el pulso del historial) con la hora actual marcada.

#### Scenario: Día sin lecturas
- **WHEN** no hubo lecturas hoy
- **THEN** la tira dice "Sin lecturas hoy" en vez de dibujarse vacía

### Requirement: Últimos eventos
La vista SHALL listar los últimos 8 eventos del barrio (accesos y detecciones mezclados por hora) con hora, qué, dónde y resultado, actualizados en vivo.

#### Scenario: Llega un evento
- **WHEN** llega un acceso nuevo
- **THEN** entra arriba de la lista y el más viejo sale
