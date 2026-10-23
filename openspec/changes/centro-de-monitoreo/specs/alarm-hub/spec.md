# Spec Delta

## MODIFIED Requirements

### Requirement: Tratar un evento de central
Un evento de central SHALL tratarse dentro de su **caso** (capacidad `centro-monitoreo`): el caso se toma, se pone en espera o se trata; tratarlo pide las señales, un cierre del catálogo y un texto de al menos 8 letras. Aceptar la cámara de la zona en el Monitor de Intrusión o marcar la alarma desde la Gestión de alarmas MUST NOT terminarlo.

#### Scenario: Abrir desde la Gestión de alarmas
- **WHEN** el operador elige una alarma de central en la Gestión de alarmas y toca «Abrir ficha»
- **THEN** se abre el caso al que pertenece esa alarma, con todas sus señales

#### Scenario: Ventana global
- **WHEN** se abre un caso P1 que nadie más tiene
- **THEN** su ficha salta con sonido en cualquier pantalla del panel, como hoy la del evento

### Requirement: Eventos del sistema por el mismo camino
Los eventos que genera OmniAccess (no abrió, no cerró, abrió fuera de horario, no llegó la restitución, falta de test, emboscada) SHALL registrarse como mensajes de la central con transporte `sistema` y SHALL entrar a la cola por el mismo camino que los que manda la central.

#### Scenario: Falta de test
- **WHEN** una central supera dos períodos sin mensajes
- **THEN** además de la alerta de salud, aparece en el registro un mensaje `sistema` «Falta de test» y un caso en la cola, que se repite cada período mientras siga faltando
