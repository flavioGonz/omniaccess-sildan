# Design

## Context

- Las cámaras de intrusión reportan por ISAPI a `server.js` (:10000) y terminan en `Detection` / `IntrusionEvent`; la Gestión de alarmas lee eso y anota en `AlarmaGestion`. La salud de equipos va en `DeviceHealthSample` / `DeviceAlert`.
- Hoy no hay ningún receptor de centrales. Las AX PRO / AX Hybrid PRO reportan a un «centro receptor» (ARC) configurable desde su web, la app o ISAPI (`/ISAPI/SecurityCP/ReportCenterCfg/<ID>`), con protocolos ADM-CID, SIA-DCS, \*ADM-CID, \*SIA-DCS, ISUP o CSV-IP, por TCP o UDP (el manual recomienda UDP, como la norma), con cuenta, reintentos, «polling» (supervisión, 10 s a 45 días) y prueba periódica.
- Las centrales van a llegar **por internet** (decisión de Nico, 21/10): el receptor queda expuesto.

## Goals / Non-Goals

**Goals**
- Ser un receptor DC-09 correcto: cualquier central que hable DC-09 se adopta sin código nuevo.
- Que una alarma de central llegue al operador por el mismo camino que una de cámara, con zona, área y cámaras.
- Que adoptar una AX sea: elegir el modelo, apretar «Vincular», ver «En línea».
- Probar todo sin equipo (simulador) y no romper nada de lo que ya corre.

**Non-Goals**
- Reemplazar la app del fabricante para programar la central.
- Protocolos propietarios (ISUP) o telefónicos.

## Decisions

### D1. Proceso propio, no `server.js`
El receptor es `alarm-receiver.js` bajo PM2. `server.js` necesita OK de Nico para cada reinicio y concentra los webhooks de cámaras; un receptor con sockets largos y otro puerto no tiene por qué compartir su suerte. Comunica eventos a la app como el resto: escribe en la base y emite por el socket (`global.io` vía POST interno a `server.js` en loopback, el mismo puente que usan los workers).

*Alternativa descartada*: escuchar dentro de Next (no hay ciclo de vida para un socket UDP y se reinicia con cada build).

### D2. `lib-dc09.js` puro y probado
Parser y armador de tramas sin dependencias de base: CRC-16 (polinomio 0x8005, tabla ARC, como define DC-09), largo en hex de 4, id con o sin `*`, secuencia, `R`/`L`/`#cuenta`, datos `[…]`, extendidos `[X…]`, hora `_HH:MM:SS,MM-DD-YYYY` (GMT). AES-CBC con IV en cero; el bloque cifrado es desde el relleno hasta la hora inclusive, rellenado con caracteres aleatorios + `|` como pide la norma. Respuestas: `ACK` (mismo seq/receptor/línea/cuenta, datos vacíos, cifrado si el mensaje vino cifrado), `NAK` (con la hora del receptor, para que la central corrija) y `DUH` (id que no se soporta). El simulador y las pruebas usan el mismo módulo, así que lo que arma el simulador es lo que el receptor espera.

### D3. Seguridad del puerto expuesto
- Cifrado **obligatorio por defecto**: un mensaje sin `*` de una cuenta con clave → `NAK` y queda registrado como rechazado. Una central sin cifrado sólo si se marca «LAN/VPN» en su ficha.
- Cuenta desconocida → se responde `NAK` (no `ACK`: no se le confirma nada a quien no está dado de alta) y se anota en un registro de «intentos» con IP, limitado (no se guarda el cuerpo de un spammer más de N por minuto).
- Ventana de hora ±20 s (cifrados) / ±40 s según la norma: fuera de ventana, `NAK` con hora. Anti-repetición: se descarta un mensaje con la misma cuenta+seq+hora ya recibido (contesta `ACK` de nuevo para que la central no reintente, sin duplicar el evento).
- Límites: tamaño máximo de trama, conexiones TCP por IP, tiempo de inactividad del socket.
- La clave AES se guarda cifrada con la clave del servidor (`OMNI_CLAVE_DATOS`, nueva), nunca en claro ni en logs.

### D4. Modelo de datos
- `DeviceType.ALARM_HUB`; el `Device` guarda nombre, marca, modelo, IP/credenciales ISAPI (para AX) como cualquier equipo.
- `CentralAlarma` (1:1 con `Device`): `cuenta` (única), `protocolo` (SIA-DCS | ADM-CID), `cifrado` (bool), `claveCifrada`, `transporte` preferido, `supervisionSeg`, `ultimoMensajeAt`, `ultimoNullAt`, `ipOrigen`, `estado` (ESPERANDO | EN_LINEA | SIN_SUPERVISION).
- `ZonaCentral`: `centralId`, `zona`, `particion`, `nombre`, `areaId` (de DEVICE_AREAS), `camaras` (ids), `tipo` (de la central si se sabe).
- `MensajeCentral`: crudo (sin la clave), `seq`, `id`, `cuenta`, `ts` de la central y del receptor, `respuesta` (ACK/NAK/DUH), y el evento traducido: `codigo`, `categoria` (ALARMA | RESTAURACION | ARMADO | DESARMADO | FALLA | PRUEBA | SUPERVISION | OTRO), `zona`, `particion`, `usuario`.

### D5. Traducción de eventos
Tabla única Contact ID ↔ SIA ↔ categoría (`lib-dc09-codigos.js`): p. ej. CID 130 / SIA BA = robo (ALARMA), 120 / PA = pánico, 110 / FA = incendio, 137 / TA = sabotaje, 121 / HA = coacción, 401–409 / OP-CL = desarmado/armado, 602 / RP = prueba periódica, 301 / AT = falla AC, 302 / YT = batería baja. El calificador de Contact ID (1 = nuevo, 3 = restauración) decide ALARMA vs RESTAURACION.

### D6. Al flujo de alarmas
Una ALARMA crea una `Detection` con `type = "CENTRAL"`, `eventType` = categoría fina (ROBO, PANICO, INCENDIO, SABOTAJE, COACCION), `deviceId` = la central, `label` = «Zona 3 · Puerta cocina», y en `details` la zona, partición, usuario y las cámaras asociadas. Así la Gestión de alarmas, el Monitor Intrusión, los avisos (Telegram/WhatsApp por regla) y la alerta global ya la toman. La RESTAURACION no resuelve la alarma (lo decide el operador), pero se muestra en la ficha. La foto: un cuadro de cada cámara asociada en el momento (mismo mecanismo de captura de intrusión).

### D7. Driver Hikvision AX
`lib/centrales/hikvision-ax.ts`, sobre `authenticatedRequest`:
- `vincular`: `GET /ISAPI/SecurityCP/ReportCenterCfg/capabilities` → elegir un centro libre → `PUT /ISAPI/SecurityCP/ReportCenterCfg/<ID>` con protocolo `*SIA-DCS` (o `*ADM-CID`), dirección y puerto públicos de OmniAccess, cuenta, clave, UDP, polling y prueba periódica. Los nombres exactos de campos se toman de las capacidades del equipo (no se hardcodean hasta tener uno).
- `zonas` y `estado`: `GET /ISAPI/SecurityCP/status/...` (zonas, particiones/subsistemas).
- `armar` / `desarmar`: `PUT /ISAPI/SecurityCP/control/arm|disarm/<particion>` (modos ausente / presente).
- Login: el AX PRO exige cuenta de rol Administrador (no Instalador); se valida al dar de alta y se dice en la pantalla.
**Riesgo**: sin equipo, las rutas de estado/control y los campos de ReportCenterCfg se implementan detrás de las capacidades y se marcan «sin probar con equipo» hasta la primera AX.

### D8. Dirección pública del receptor
Ajuste nuevo `ALARMAS_DESTINO` (dominio o IP pública y puerto) en Configuración, separado de `EVENT_HOST_*` (que es la IP vista desde la red de las cámaras). Es lo que se escribe en la AX y lo que se muestra para una Genérica.

## Risks / Trade-offs

- **Puerto expuesto a internet** → cifrado obligatorio, NAK a cuentas desconocidas, límites por IP; revisar el NAT/firewall de cada sitio con Nico antes de abrirlo en producción.
- **Campos AX sin probar** → todo lo que escribe en la central va detrás de las capacidades y con «Probar» antes de «Guardar»; la primera AX real valida.
- **Duplicados por reintento** de la central → anti-repetición por cuenta+seq+hora.
- **Reloj del servidor** → la ventana de hora depende de NTP en el CT; el NAK manda la hora para que la central se corrija.

## Migration Plan

1. Migración Prisma (enum + tres tablas) con `migrate deploy` en el lab.
2. `alarm-receiver` en PM2 (lab), puerto 10010 TCP+UDP; abrir en el firewall del lab sólo cuando haya una central para probar.
3. Rollback: `pm2 delete alarm-receiver`; la migración es aditiva (no toca tablas existentes).

## Open Questions

- Puerto y dominio públicos definitivos (y si cada barrio tendrá su receptor o uno central de IES).
- Qué categorías avisan por Telegram/WhatsApp por defecto (propuesta: ALARMA y SUPERVISION).
- Armar/desarmar: ¿sólo administradores o también el operador de guardia con su PIN?
