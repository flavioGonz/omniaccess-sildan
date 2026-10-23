# Proposal

## Why

Los barrios y clientes de IES tienen centrales de alarma (AX PRO, AX Hybrid PRO y de otras marcas) que hoy reportan sólo a la app del fabricante o a una central de monitoreo de terceros. OmniAccess ve las cámaras y las LPR pero no se entera de que una central entró en alarma, se armó, se desarmó o perdió la comunicación: el operador mira dos pantallas y la intrusión de la central no cruza con el video. SIA DC-09 es el protocolo estándar con el que las centrales reportan a un receptor por IP; si OmniAccess es ese receptor, cualquier central que hable DC-09 entra al mismo flujo de alarmas que las cámaras de intrusión.

Todavía no hay ninguna central instalada: el receptor se construye y se prueba contra un simulador DC-09, y se valida con la primera AX real.

## What Changes

- **Receptor DC-09** (`alarm-receiver`, proceso PM2 nuevo, aparte de `server.js`): escucha TCP y UDP en un puerto configurable (por defecto 10010), acepta `SIA-DCS`, `ADM-CID`, sus variantes cifradas `*SIA-DCS` / `*ADM-CID` (AES-128/192/256 CBC, clave por cuenta) y `NULL` (supervisión). Valida CRC, largo, hora (±20 s/40 s según la norma) y cuenta; contesta `ACK`, `NAK` (con la hora del receptor) o `DUH`. Guarda cada mensaje crudo y lo traduce a un evento común.
- **Tipo de equipo «Alarm Hub»** (`DeviceType.ALARM_HUB`, familia intrusión): aparece en «Nuevo dispositivo» junto a LPR, Intrusión y NVR. Modelos: Hikvision AX PRO, Hikvision AX Hybrid PRO y «Genérica DC-09».
- **Adopción en tres pasos** desde el alta: (a) elegir modelo — OmniAccess asigna un número de cuenta libre y genera la clave AES; (b) vincular — en Hikvision, OmniAccess escribe el centro receptor en la central por ISAPI; en Genérica muestra los valores para cargarlos a mano; (c) esperar el primer mensaje — la ficha pasa de «Esperando la central» a «En línea» con el primer `NULL` o prueba.
- **Zonas y particiones**: cada central tiene sus zonas (número, nombre, área de Dispositivos, cámaras asociadas para verificación). En AX se leen por ISAPI; en Genérica se cargan a mano o se aprenden de los eventos.
- **Eventos al flujo existente**: robo, pánico, incendio, sabotaje y coacción entran como alarma a la Gestión de alarmas y al Monitor Intrusión (con la zona, el área y las cámaras asociadas); armado, desarmado, restauraciones, pruebas y fallas de batería/AC quedan en el historial de la central; la pérdida de supervisión es una alerta de salud del equipo.
- **Estado y control (AX)**: leer estado de particiones y zonas, y armar / desarmar desde la ficha y el monitor, con permiso nuevo y confirmación.
- **Driver por fabricante** (`lib/centrales/`): `hikvision-ax` (escribir el centro receptor, leer zonas y estado, armar / desarmar) y `generica-dc09` (sólo recibe). Sumar otra marca es escribir su driver.
- **Simulador** (`scripts/simular-central.js`): manda mensajes DC-09 reales (con y sin cifrado, TCP y UDP, `NULL`, alarmas Contact ID y SIA) para probar sin equipo.

## Capabilities

### New Capabilities
- `alarm-hub`: recepción DC-09, alta y adopción del Alarm Hub, zonas, supervisión, eventos al flujo de alarmas, y el driver Hikvision AX (configurar el centro receptor, estado, armar / desarmar).

### Modified Capabilities
- `monitor-intrusion`: las alarmas de una central entran al monitor y a la Gestión de alarmas como las de las cámaras, con su zona y las cámaras asociadas.

## Impact

- **Código**: `alarm-receiver.js` (nuevo, raíz), `lib-dc09.js` (parser, CRC, AES, ACK/NAK; compartido con el simulador y las pruebas), `src/lib/centrales/` (drivers), `src/app/api/centrales/*`, `src/components/devices/` (alta Alarm Hub en `CajonDispositivo`, ficha de la central), `src/lib/permisos.ts` (permiso `centrales-control` para armar / desarmar), `ecosystem.config.json` (proceso nuevo).
- **Base**: migración con `DeviceType.ALARM_HUB` y las tablas `CentralAlarma` (cuenta, protocolo, clave cifrada, supervisión, último mensaje), `ZonaCentral` y `MensajeCentral` (crudo + evento traducido).
- **Red**: un puerto TCP+UDP abierto hacia internet en el servidor (y su NAT/firewall), porque las centrales llegan por internet. Con eso, el cifrado AES queda **obligatorio por defecto** (se puede desactivar por central sólo en LAN/VPN).
- **PM2**: proceso nuevo `alarm-receiver`; reiniciar `omniaccess-web` tras el build. `server.js` no se toca.
- **Verificación**: simulador → ACK y evento en Gestión de alarmas en el lab; `/admin/devices` (alta Alarm Hub) y `/admin/monitor-intrusion` con HTTP 200.

## Out of scope

- Otros protocolos de central: ISUP/EHome de Hikvision, CSV-IP, SIA por línea telefónica, Contact ID por módem.
- Video de verificación que manda la central (Intruder Verification as a Service): se usan las cámaras de OmniAccess asociadas a la zona.
- Reenviar los eventos a una central de monitoreo de terceros (OmniAccess como repetidor).
- Programar la central más allá del centro receptor (zonas, usuarios, códigos, sirenas): eso sigue en la app del fabricante.
- Pasar a San Nicolás: todo en el lab hasta que Nico lo pida.
