## ADDED Requirements

### Requirement: Visita sin lote en seguimiento
El guardia SHALL poder registrar una visita sin lote que queda en seguimiento con una cuenta atrás
configurable (por defecto 10 minutos) hasta que se le asigne lote o se cierre.

#### Scenario: Alta desde la tablet
- **WHEN** el guardia toca «Visita sin lote» y confirma la matrícula
- **THEN** se crea la visita sin lote con `seguimientoVence = ahora + 10 min`
- **AND** aparece arriba de todo en la tablet y en la franja del monitor LPR con la cuenta atrás

#### Scenario: Asignar lote
- **WHEN** el guardia elige un lote en una visita en seguimiento
- **THEN** el seguimiento termina, se guarda quién y cuándo, y la visita sigue con el tiempo de su tipo
- **AND** desaparece de la franja del monitor

#### Scenario: Prórroga
- **WHEN** el guardia toca «+5 min»
- **THEN** la cuenta atrás suma 5 minutos (desde ahora si ya había vencido) y queda registrado

#### Scenario: Vence sin lote
- **WHEN** la cuenta atrás llega a cero sin lote asignado
- **THEN** la tarjeta pasa a rojo en la tablet y en el monitor, suena una vez, y se crea el aviso `SIN_LOTE_VENCIDA`
- **AND** la visita no se cierra sola

#### Scenario: Sale antes de asignar lote
- **WHEN** la cámara de Salida lee la matrícula de una visita en seguimiento
- **THEN** la visita se cierra como «salió sin lote»
