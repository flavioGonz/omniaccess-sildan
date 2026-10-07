# Spec Delta

## Purpose
La vista Salud del sistema dice si OmniAccess y lo que lo rodea están vivos, componente por componente, para que una falla se vea en la pared antes de que un residente llame.

## ADDED Requirements

### Requirement: Componentes vigilados
La vista SHALL mostrar una tarjeta por componente: cada cámara y lectora (desde la salud de dispositivos), cada NVR, el bot de WhatsApp, el almacenamiento (MinIO), la base de datos, el servidor de eventos (socket) y los workers de seguimiento y despacho. Cada tarjeta MUST mostrar nombre, estado (verde en línea / ámbar degradado / rojo caído / gris sin dato), "hace cuánto respondió" y, si está caído, desde cuándo.

#### Scenario: NVR sin respuesta
- **WHEN** un NVR deja de responder al chequeo de salud
- **THEN** su tarjeta pasa a rojo con "sin respuesta desde HH:MM" antes de 2 min

### Requirement: Resumen arriba
La vista SHALL encabezar con un resumen: "Todo en línea" en verde o "N componentes con problemas" en rojo, con la lista de los que fallan primero.

#### Scenario: Todo bien
- **WHEN** todos los componentes están en línea
- **THEN** el encabezado dice "Todo en línea" y las tarjetas se ordenan por tipo

### Requirement: Fuente protegida
La información de salud SHALL servirse sólo a sesiones del panel y a enlaces de pantalla de esta vista; la API de estado del sistema MUST dejar de ser pública.

#### Scenario: Pedido sin credenciales
- **WHEN** se pide la API de estado del sistema sin sesión ni token de pantalla
- **THEN** responde 401
