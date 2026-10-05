# Spec Delta

## Purpose

Define las acciones que un guardia realiza sobre una detección de matrícula —cargar/corregir
la matrícula y consultar "Matrículas Requeridas" del Min. del Interior— y exige que funcionen
de forma equivalente en navegador, PWA y dentro de la APK (WebView Android).

## ADDED Requirements

### Requirement: Cargar o corregir la matrícula de una detección
El guardia DEBE poder cargar o corregir a mano la matrícula de una detección (incluidas las
NO_LEIDA) desde cualquier cliente soportado —navegador, PWA y APK (WebView)— y al confirmar,
el sistema DEBE re-evaluar el acceso (residente, decisión GRANT/DENY y watchlist) y mostrar el
resultado.

#### Scenario: Abrir y escribir en la APK
- **WHEN** el guardia toca "Cargar matrícula" en la APK (WebView)
- **THEN** se abre el formulario, el teclado del dispositivo aparece y el guardia puede
  escribir la matrícula sin recurrir a un navegador externo

#### Scenario: Guardar y re-evaluar
- **WHEN** el guardia ingresa una matrícula válida y confirma
- **THEN** el sistema re-evalúa el acceso y muestra si es residente, la decisión y cualquier
  coincidencia de watchlist

#### Scenario: Entrada vacía
- **WHEN** el guardia confirma sin ingresar matrícula
- **THEN** el sistema no guarda y pide ingresar una matrícula

### Requirement: Consulta a Min. Interior con humano en el medio
El guardia DEBE poder consultar "Matrículas Requeridas" del Min. del Interior para una
matrícula desde cualquier cliente soportado —navegador, PWA y APK (WebView)—, resolviendo el
captcha manualmente. El sistema NO DEBE automatizar ni resolver el captcha por software, y NO
DEBE delegar la consulta a un navegador externo.

#### Scenario: Cargar el captcha en la APK
- **WHEN** el guardia abre la consulta de Min. Interior en la APK (WebView)
- **THEN** el captcha se carga dentro de la aplicación y el guardia puede verlo e ingresar el
  código

#### Scenario: Resultado de la consulta
- **WHEN** el guardia ingresa el código del captcha y envía
- **THEN** el sistema muestra el estado de la matrícula (REQUERIDA / NO / resultado desconocido)

#### Scenario: Captcha siempre humano
- **WHEN** se realiza cualquier consulta a Min. Interior
- **THEN** el captcha es resuelto por la persona y nunca por software automático
