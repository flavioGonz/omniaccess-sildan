# Tasks

## 1. Protocolo (sin base, probado)

- [x] 1.1 `lib-dc09.js`: parser y armador de tramas (CRC-16 ARC, largo, id con o sin `*`, seq, R/L/#cuenta, datos y extendidos, hora GMT), AES-CBC 128/192/256 con IV cero y relleno de la norma, y armado de `ACK` / `NAK` / `DUH`. Verificar: pruebas con tramas de ejemplo de la norma y de ioBroker.sia (CRC, cifrado ida y vuelta, ACK cifrado).
- [x] 1.2 `lib-dc09-codigos.js`: tabla Contact ID ↔ SIA ↔ categoría y calificador nuevo / restauración. Verificar: pruebas de los códigos de D5.
- [x] 1.3 `scripts/simular-central.js`: manda alarmas, restauraciones, armado, desarmado, prueba y `NULL`, cifrado o no, TCP o UDP, y muestra la respuesta. Verificar: contra un eco local el ACK coincide con la secuencia.

## 2. Base

- [x] 2.1 Migración: `DeviceType.ALARM_HUB`, `CentralAlarma`, `ZonaCentral`, `MensajeCentral` (aditiva) y ajuste `ALARMAS_DESTINO`; `OMNI_CLAVE_DATOS` en `.env` del lab (nunca versionado) para cifrar las claves AES. Verificar: `prisma migrate deploy` + `generate` en el lab sin tocar tablas existentes.

## 3. Receptor

- [x] 3.1 `alarm-receiver.js` (PM2): TCP y UDP en `ALARMAS_PUERTO` (10010), validación, seguridad de D3 (cifrado obligatorio, cuenta desconocida → NAK, ventana de hora, anti-repetición, límites por IP), registro en `MensajeCentral`, estado de la central. Verificar: simulador → ACK; CRC roto → NAK; sin cifrar → NAK; repetido → un solo evento.
- [x] 3.2 Al flujo de alarmas: ALARMA → `Detection` `type=CENTRAL` con zona, área, cámaras y captura de cada cámara asociada; emitir por el socket como una detección de intrusión. Verificar: la alarma del simulador aparece en `/admin/alarmas` y en `/admin/monitor-intrusion`, y dispara una regla de aviso de prueba (sin mandar al grupo de la guardia).
- [x] 3.3 Supervisión: tarea que pasa a «Sin supervisión» y crea `DeviceAlert`; vuelve con el próximo mensaje. Verificar: con supervisión de 30 s y el simulador detenido, la ficha cambia en ≤ 2 períodos.

## 4. Drivers

- [x] 4.1 `src/lib/centrales/` con la interfaz (`vincular`, `zonas`, `estado`, `armar`, `desarmar`, opcionales) y `generica-dc09`. Verificar: tipos y registro por marca/modelo.
- [x] 4.2 `hikvision-ax`: login con cuenta de administrador, capacidades de `ReportCenterCfg`, escribir el centro receptor, leer zonas y particiones, armar / desarmar. Verificar: sin equipo, con respuestas grabadas; marcado «sin probar con equipo» hasta la primera AX.

## 5. Pantallas

- [x] 5.1 `CajonDispositivo`: Alarm Hub en «¿Qué vas a agregar?» con los tres modelos; pasos Equipo → Conexión (sólo AX) → Receptor (cuenta, clave, protocolo, LAN/VPN) → Zonas → Vincular / Esperar. Verificar: alta de una Genérica y de una AX (simulada) en el lab.
- [x] 5.2 Ficha de la central: estado de adopción y supervisión, último mensaje, zonas con área y cámaras, historial de mensajes, «Probar recepción» (instrucciones + espera del próximo mensaje); en AX, estado y armar / desarmar con permiso `centrales-control` y Auditoría. Verificar: con el simulador.
- [x] 5.3 Configuración: `ALARMAS_DESTINO` (dirección pública y puerto) con la explicación de NAT/firewall. Verificar: se guarda y se muestra en la adopción.

## 6. Verificación

- [ ] 6.1 Lab: build DONE_0, `pm2 list` con `alarm-receiver` online, simulador de punta a punta (ACK, alarma en Gestión de alarmas y Monitor Intrusión, supervisión), HTTP 200 de `/admin/devices`, `/admin/alarmas` y `/admin/monitor-intrusion`.
- [ ] 6.2 Con la primera AX real: vincular, alarma de prueba, armar / desarmar; corregir campos del driver y sacar la marca «sin probar».

## Estado (22/10, lab62)

- 21/10 (lab57), con el simulador: ACK cifrado con la misma secuencia (TCP y UDP, SIA y Contact ID), NAK por cuenta desconocida, sin cifrar, hora fuera de ventana y clave equivocada; reintento = ACK sin segundo evento; ALARMA → Detection CENTRAL; falla de corriente → alerta y cierre; supervisión → «Sin supervisión» y vuelta a «En línea». La central de prueba no mandó Telegram.
- 22/10 (lab61): 3.2 — con la central sin marca de prueba, un robo en la zona 5 disparó una regla INTRUSION/CENTRAL de la central (canal webhook sin URL, así no salió nada) y armó el aviso «Alarma de central · Central de prueba (simulador) · Zona 5»; después se borraron la regla, el despacho y la detección. El texto del aviso ahora dice el tipo («Robo · central de alarma») sin el «· —» de la clase.
- 22/10: 4.2 — la AX entra con sesión (sessionLogin + WebSession, X-Userlevel administrador), como la integración de Home Assistant que se usa con equipos reales; rutas de armado y campos de estado de ahí. Pruebas con una AX simulada en tests/centrales-ax.test.ts. El centro receptor (ReportCenterCfg) sigue sin una respuesta de equipo real: se lee antes de escribir.
- 5.2: «Probar recepción» en la ficha. Retención: NULL confirmados 7 días, el resto 90.
- Falta: 6.1 mirar las pantallas con sesión (Nico); 6.2 la primera AX real.
