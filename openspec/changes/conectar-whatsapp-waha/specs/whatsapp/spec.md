# whatsapp

Integración de WhatsApp del barrio: una sola configuración, estado de sesión visible y envío
de avisos a través del motor WAHA.

## ADDED Requirements

### Requirement: Single source of truth for WhatsApp configuration
The system SHALL resolve WhatsApp connection settings (base URL, API key, session name) from a
single configuration source (`getWhatsAppConfig()`), and the Ajustes panel SHALL read and write
that same source so the UI never diverges from what the backend uses.

#### Scenario: El panel refleja la configuración real
- **WHEN** un administrador abre Ajustes → WhatsApp
- **THEN** los campos de URL, API key y sesión muestran los valores efectivos que usa el sistema
  (hoy guardados en `OPENWA_*`), no campos vacíos.

#### Scenario: Guardar desde el panel actualiza la fuente única
- **WHEN** el administrador edita la configuración y guarda
- **THEN** el sistema persiste los valores en las claves canónicas y `getWhatsAppConfig()` los
  devuelve sin reiniciar la app.

### Requirement: Session status and QR linking are visible in Ajustes
The Ajustes panel SHALL show the live WAHA session state and, when the session is not linked,
SHALL show the pairing QR so an operator can link WhatsApp without leaving the UI.

#### Scenario: Sesión vinculada
- **WHEN** la sesión WAHA está autenticada
- **THEN** el panel muestra estado "conectada" y el número/perfil vinculado.

#### Scenario: Sesión sin vincular
- **WHEN** la sesión WAHA requiere emparejamiento
- **THEN** el panel muestra el QR en vivo y, al escanearlo, pasa a estado "conectada".

#### Scenario: Motor inalcanzable
- **WHEN** el contenedor WAHA no responde
- **THEN** el panel muestra "inalcanzable" en vez de aparentar que está desconectado por
  configuración.

### Requirement: Outbound sending respects the allowlist
When the allowlist is enabled, the system SHALL only send WhatsApp messages to numbers in
`WHATSAPP_ALLOWLIST`, and the panel SHALL let the operator view and edit that allowlist.

#### Scenario: Allowlist activa
- **WHEN** la allowlist está activada y un aviso se dirige a un número que no está en ella
- **THEN** el sistema no envía el mensaje a ese número.
