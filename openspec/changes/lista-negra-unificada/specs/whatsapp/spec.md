# Spec Delta

## ADDED Requirements

### Requirement: Comando de lista negra del bot sobre la lista única
El comando `lista negra <matrícula> [motivo]` (y `quitar lista negra <matrícula>`) del bot de
WhatsApp, disponible sólo para personal autorizado, SHALL escribir la misma lista de vigilancia
que la pantalla: el alta crea o reactiva la entrada `BLACKLISTED` con el motivo y el número que la
cargó, y la baja la desactiva. El bot SHALL responder con el estado real que quedó.

#### Scenario: Alta por el bot con motivo
- **WHEN** personal autorizado escribe `lista negra ABC1234 auto sospechoso`
- **THEN** la entrada aparece en `/admin/users` → Lista de vigilancia como `BLACKLISTED`, motivo
  "auto sospechoso", cargada por el número del remitente, y el bot confirma "ABC1234 quedó en lista
  negra".

#### Scenario: La matrícula ya es VIP
- **WHEN** personal autorizado pide poner en lista negra una matrícula que está activa como VIP
- **THEN** el bot no la pisa en silencio: avisa que está como VIP y pide confirmar con
  `lista negra ABC1234 confirmar [motivo]`.

#### Scenario: Baja por el bot
- **WHEN** personal autorizado escribe `quitar lista negra ABC1234`
- **THEN** la entrada queda desactivada (no borrada) y las lectoras se actualizan; el bot confirma e
  informa si alguna cámara no respondió.
