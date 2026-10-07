# Spec Delta

## ADDED Requirements

### Requirement: Overlay de canal en alarma compartido
El overlay de un canal en alarma (pendiente o confirmada) SHALL ser una sola pieza usada por el monitor de intrusión del panel y por la vista de pantalla Intrusión, con los mismos estados y textos; en el panel con el botón "Ver evento" y en la pantalla sin acciones.

#### Scenario: Mismo estado en dos lugares
- **WHEN** una cámara está en "INTRUSIÓN CONFIRMADA · sin resolver" en el panel
- **THEN** la vista de pantalla Intrusión muestra el mismo rótulo, tipo de evento y hace cuánto, sin botón

### Requirement: Alerta global también en las vistas de pantalla
La alerta obligatoria de intrusión confirmada SHALL imponerse también sobre cualquier vista de pantalla (`/monitor/*`), en modo sólo lectura: se ve el overlay rojo respirando con cámara, tipo y hace cuánto, sin botones de real / falsa, y se retira sola cuando la alarma se resuelve en el panel.

#### Scenario: Alarma con la vista Mapa en la pared
- **WHEN** hay una intrusión confirmada sin resolver y la pared muestra `/monitor/mapa`
- **THEN** el overlay rojo cubre la vista hasta que la alarma se resuelva desde el panel
