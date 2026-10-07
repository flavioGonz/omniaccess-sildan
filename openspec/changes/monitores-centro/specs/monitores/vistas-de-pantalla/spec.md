# Spec Delta

## Purpose
Las vistas de pantalla son páginas de OmniAccess hechas para verse en un monitor de pared de un centro de monitoreo: sin menú, a pantalla completa, legibles a distancia y honestas sobre si están vivas. Esta capacidad cubre el marco común de todas ellas, el menú Monitores desde donde se abren y la rotación.

## ADDED Requirements

### Requirement: Rutas propias, sin el panel alrededor
Cada vista de pantalla SHALL servirse en una URL propia bajo `/monitor/<vista>` sin menú, barra lateral, buscador ni controles de edición del panel, con tema oscuro fijo e independiente del tema elegido en el panel.

#### Scenario: Abrir una vista
- **WHEN** se abre `/monitor/intrusion` con una sesión o un enlace de pantalla válidos
- **THEN** se muestra únicamente la vista Intrusión, con su encabezado de monitor, sin ningún elemento del layout de administración

#### Scenario: Vista inexistente
- **WHEN** se abre `/monitor/<nombre que no existe>`
- **THEN** se muestra una pantalla "Esta vista no existe" con la lista de vistas disponibles, nunca un error en blanco

### Requirement: Encabezado de monitor
Toda vista SHALL mostrar en todo momento el nombre del barrio, la hora local del barrio en formato 24 h y el nombre de la vista, en tipografía legible a 3–4 metros (cuerpo mínimo 18 px en pantallas de 1080p).

#### Scenario: Reloj del barrio
- **WHEN** la PC del monitor tiene otra zona horaria configurada
- **THEN** la hora del encabezado sigue siendo la del barrio

### Requirement: Indicador de vitalidad
Toda vista SHALL mostrar un indicador de vitalidad con tres estados: "En vivo" (socket conectado y datos frescos), "Reconectando" (socket caído menos de 60 s) y "Sin datos hace N min" (sin socket ni actualización por más de 60 s). El estado "Sin datos" MUST ser visualmente inconfundible (ámbar, ocupando el encabezado completo) para que una pantalla congelada no pueda confundirse con un barrio tranquilo.

#### Scenario: Se cae el servidor de eventos
- **WHEN** el socket de eventos deja de responder
- **THEN** antes de 60 s el encabezado pasa a "Reconectando" y, pasado el minuto, a "Sin datos hace 1 min" con la franja ámbar, y vuelve a "En vivo" solo cuando reciba datos nuevos

#### Scenario: La pestaña recupera el foco
- **WHEN** el navegador suspendió la pestaña y la vuelve a mostrar
- **THEN** la vista recarga sus datos y reconecta el socket sin intervención

### Requirement: Pantalla completa
Toda vista SHALL ofrecer un botón de pantalla completa y SHALL pedir pantalla completa en el primer clic o tecla del operador si el navegador lo permite. El botón MUST ocultarse junto con el cursor tras 5 s sin movimiento y reaparecer al mover el mouse.

#### Scenario: Primer clic
- **WHEN** el operador hace clic en cualquier parte de una vista que no está en pantalla completa
- **THEN** la vista pasa a pantalla completa y oculta el cursor a los 5 s

### Requirement: Sólo lectura
Ninguna vista de pantalla SHALL ofrecer controles que cambien el estado del sistema (aceptar alarmas, abrir barrera, editar, escribir bitácora). Si una vista reutiliza un componente del panel que tiene esos controles, MUST ocultarlos.

#### Scenario: Canal en alarma en la vista Intrusión
- **WHEN** un canal está en alarma en `/monitor/intrusion`
- **THEN** se ve el overlay de alarma sin el botón "Ver evento" ni ninguna acción de aceptar o resolver

### Requirement: Menú Monitores
El panel SHALL tener una sección "Monitores" (grupo Operación), visible para quien tenga el permiso `monitores`, con una tarjeta por vista que muestre: nombre, para quién es, qué muestra, una previsualización estática, el botón "Abrir" y los enlaces de pantalla de esa vista.

#### Scenario: Sin permiso
- **WHEN** un usuario sin el permiso `monitores` entra a `/admin/monitores`
- **THEN** se lo redirige a la pantalla de sin permiso, como con cualquier otra sección

### Requirement: Rotación
`/monitor/rotacion` SHALL alternar entre un conjunto ordenado de vistas, configurable desde Monitores (qué vistas y cada cuántos segundos, mínimo 10 s), con una transición de fundido y un indicador discreto de cuál es la siguiente. Una alarma de intrusión confirmada MUST detener la rotación en la vista Intrusión hasta que se resuelva.

#### Scenario: Rotación normal
- **WHEN** la rotación está configurada en Mapa → LPR → Resumen cada 30 s
- **THEN** cada vista se muestra 30 s en ese orden, en bucle, con fundido entre una y otra

#### Scenario: Alarma durante la rotación
- **WHEN** llega una intrusión confirmada mientras se muestra Resumen
- **THEN** la rotación salta a Intrusión y se queda ahí hasta que la alarma se resuelva en el panel

### Requirement: Retiro de los tableros viejos
Las rutas `/dashboard-lpr`, `/dashboard-acceso` y `/dashboard-mixto` SHALL redirigir a `/admin/monitores`.

#### Scenario: URL guardada
- **WHEN** alguien abre `/dashboard-lpr`
- **THEN** llega a `/admin/monitores` (o al login si no tiene sesión)
