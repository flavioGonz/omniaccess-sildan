# Design

## Context

- **Modos y capas** (`lib/module-definitions.ts`): Matrículas, Rostro y Filas son modos exclusivos; Guardia es una capa (`exclusive: false`) que convive con cualquiera.
- **Funciones** (`lib/funciones.ts`): hoy cuelgan todas de un módulo (`modulo: ModuleId`) y se guardan en `Setting` como `"true"`/`"false"`. `funcionActiva` cachea 10 s en el servidor y `useFuncion` sirve al navegador.
- **El menú** (`admin/layout.tsx`) decide Intrusión y Gestión de alarmas por modo: `MODULE_LPR && !MODULE_QUEUE` y `!MODULE_QUEUE`. Las alertas globales `AlertaIntrusionGlobal` y `AlertaCentralGlobal` se montan siempre.
- **alarm-receiver.js** (PM2) abre TCP/UDP DC-09 y TCP CMS al arrancar, sin mirar ningún ajuste. Por cada evento ALARMA crea la `Detection` CENTRAL, saca un cuadro de cada cámara de la zona (`lpr_<id>` en go2rtc) y avisa por el socket.
- **Cámaras**: `ZonaCentral.camaras` guarda ids de equipo. El Monitor CCTV ya nombra los canales de NVR que no son equipo como `nvrch-<nvr>-<ch>`, con stream `lpr_nvrch-<nvr>-<ch>`. Un canal toma el área de su NVR (`leerArbolAreas`: `equipoArea`).
- **Grabación**: `components/video/VerGrabacion` reproduce desde `instanteMs` por `deviceId`, o por `nvrId` + `canal`, con el «antes» de `FICHA_CLIP_ANTES_SEG`. Las vistas de pared ya pueden pedir `/api/nvr/`, `/api/clip/` y `/go2rtc` con enlace de pantalla (`middleware.ts`: `MEDIOS`).
- **Procedimiento**: `CENTRALES_PROCEDIMIENTO` es `{ "1": string[], …, "5": string[] }`. Los pasos tildados se guardan en `AlarmaGestion` (`PASO_PROC` / `PASO_PROC_NO`, con `detalle` = texto del paso). `tratarEvento` no mira los pasos.

## Goals / Non-Goals

**Goals:**
- Un único mecanismo de funciones, con funciones de módulo y funciones de instalación, sin un segundo sistema paralelo.
- Que apagar una función saque **todo** lo suyo: menú, alertas, vistas, rutas y receptor. Ningún botón huérfano.
- Video en vivo al instante y grabación del momento, reutilizando las piezas de video que ya existen (`Vivo`, `vivoDe`, `VerGrabacion`).
- Que el servidor sea quien impide tratar sin los pasos obligatorios.

**Non-Goals:**
- Dejar de guardar los eventos de cámara con Intrusión apagada: eso pide tocar `server.js`, y la regla vigente es no tocarlo sin OK de Nico.
- El clip automático guardado con el caso y las directivas por cuenta: siguen en `centro-de-monitoreo`.
- Restringir el video de los enlaces de pantalla por abonado: el alcance de video de las vistas de pared no cambia.
- Procedimientos por central o por zona: van con las directivas de `centro-de-monitoreo`.

## Decisions

### 1. Funciones de instalación dentro de `lib/funciones.ts`
`Funcion` gana `alcance: "modulo" | "instalacion"`, y `modulo` pasa a ser opcional (obligatorio si `alcance === "modulo"`). Las ids nuevas son `FUNC_INTRUSION`, `FUNC_ALARMAS_RECEPCION` y `FUNC_ALARMAS_GESTION` (con `requiere: "FUNC_ALARMAS_RECEPCION"`).

- **Por qué:** `getFunciones`, `funcionActiva`, `toggleFuncion`, `useFuncion`, `fijarFuncion` y la caché ya existen y se prueban; `dependenciaCumplida` ya resuelve el «requiere».
- **Descartado:** nuevos módulos-capa (`MODULE_INTRUSION`, …). Los módulos piden clave de operación y recargan la aplicación; además tienen bucket y lógica de exclusión que no aplican. Una capa también ocupa una tarjeta de módulo, y estas son interruptores.

### 2. Estado por defecto dinámico + escritura en el despliegue
`porDefecto` de las de alarmas es `false` y el de Intrusión es `true`. El despliegue corre un script idempotente (`scripts/funciones-instalacion.js`) que, si la clave no existe en `Setting`, escribe:

- `FUNC_ALARMAS_RECEPCION` y `FUNC_ALARMAS_GESTION` = `true` si hay al menos una `CentralAlarma`;
- `FUNC_INTRUSION` = `true`.

- **Por qué:** una instalación nueva arranca limpia y una existente no cambia de comportamiento.
- **Descartado:** calcular el defecto en `getFunciones` contando centrales en cada lectura. Agrega una consulta en un camino caliente y hace que el defecto cambie solo al dar de alta la primera central.

### 3. Dónde se aplica cada función
Un helper de servidor, `exigirFuncion(id)`, devuelve 404 con `{ error: "función apagada" }` y lo usan todas las rutas de cada función:

- **Intrusión:** `/api/monitor/intrusion*`, `/api/monitor/alarmas`.
- **Recepción:** `/api/centrales*` salvo la consulta de estado.
- **Gestión:** `/api/centrales/eventos*`, `/api/monitor/centrales`.

En el cliente:

- `admin/layout.tsx` usa `useFuncion` para el menú y para montar `AlertaIntrusionGlobal` y `AlertaCentralGlobal`.
- El catálogo `VISTAS` gana `funcion?: FuncionId` y Monitores lo filtra.
- `/monitor/[vista]` muestra «Esta vista está apagada en la instalación» y reintenta cada 60 s.

Las reglas de notificación: `server.js` ya manda los eventos de cámara a `POST /api/notifications/event` (`notificarPorReglas`), del lado de Next. Esa ruta descarta los de módulo INTRUSION que no son de central (`CENTRAL`, `CENTRAL_ESCALADO`) cuando `FUNC_INTRUSION` está apagada, y contesta 200 con `{ omitido: "función apagada" }` para que `server.js` no lo registre como error. Así no se toca `server.js`.

### 4. Receptor que abre y cierra sus puertos
`alarm-receiver.js` lee `FUNC_ALARMAS_RECEPCION` y `FUNC_ALARMAS_GESTION` de `Setting` cada 15 s.

- **Recepción** decide `listen`/`close` de TCP, UDP y CMS: se cierran sin matar el proceso y se reabren al prender.
- **Gestión** decide si `despues()` crea la `Detection` CENTRAL y las fotos. Con Gestión apagada sigue registrando `MensajeCentral` y llama a `avisarPorReglas`.

- **Por qué cerrar el puerto en lugar de NAK:** una central que recibe NAK reintenta el mismo evento para siempre y traba la cola. Con el puerto cerrado registra falla de comunicación, que es la verdad.
- **Por qué sondear:** reaccionar al cambio desde el panel con el socket obligaría a que `server.js` reenvíe un evento nuevo, y `server.js` no se toca.

### 5. Cámaras: una sola función de resolución
`lib/centrales/camaras.ts` exporta `camarasDeZona(central, zona) → { camaras: CamRef[], origen: "zona" | "area" | "abonado" | "ninguna", area?: string }` y `camarasDelAbonado(central)`, con `CamRef = { id, nombre, stream, deviceId | null, nvrId | null, ch | null }`.

- **Ids de cámara:** un id de equipo, o `nvrch-<nvr>-<ch>`.
- **Stream:** `lpr_<id>`.
- **Grabación:** un equipo usa `resolveForCamera` (su NVR y canal, o la propia cámara); un canal usa su NVR y canal.
- **Cámaras del área:** equipos cámara cuyo `equipoArea` es el área, más los canales de los NVR de esa área, hasta 4 y en orden por nombre.

La usan `alarm-receiver.js` (las fotos del momento y el payload del socket), `/api/centrales/eventos/[id]`, `/api/monitor/centrales` y el editor de zonas. `alarm-receiver.js` es CommonJS: la lógica se escribe en `lib-centrales-camaras.js` (CommonJS, como `lib-dc09-codigos.js`) y el TS la importa con un envoltorio tipado.

- **Descartado:** resolver en cada pantalla. Hoy ya hay tres lugares que leen `zona.camaras` a su manera.

### 6. `CentralAlarma.camaras String[]` y canales en `ZonaCentral.camaras`
La migración es aditiva: `ALTER TABLE "CentralAlarma" ADD COLUMN "camaras" TEXT[] NOT NULL DEFAULT '{}'`. `ZonaCentral.camaras` no cambia de tipo: los canales entran como `nvrch-…`. El selector de cámaras (hoy `getDevices()` filtrado) pasa a listar equipos más canales de NVR, con la misma fuente que el Monitor CCTV.

### 7. Video en la ficha y en la pared con las piezas existentes
Una pieza nueva, `components/centrales/VerificacionVideo.tsx`, recibe `{ camaras: CamRef[], otras: CamRef[], instanteMs, soloLectura }` y dibuja:

- la grilla en vivo (`Vivo` + `vivoDe`, con caída a `Foto` a los 12 s);
- en cada cámara, «Ver el momento», que abre `VerGrabacion` en la solapa de grabación con `instanteMs`, o el aviso «sin grabador» si no hay grabador;
- la tira «Otras cámaras del abonado».

La usan `FichaEventoCentral` (reemplaza `Camaras`, la foto cada 5 s) y `VistaAlarmas` (reemplaza `VideoZona`).

- **Por qué una pieza:** el mismo evento se ve igual en el panel y en la pared (el pedido de estandarizar del 23/10).

### 8. Procedimientos por clase con instantánea
Nuevo ajuste `CENTRALES_PROCEDIMIENTOS`: `{ [clase]: { pasos: { texto, obligatorio }[] } | null }`. `null` significa usar el de su prioridad. `CENTRALES_PROCEDIMIENTO` (por prioridad) pasa a admitir `{ texto, obligatorio }` además de `string`; los strings leen como no obligatorios.

- **Instantánea:** al crear la alarma, `alarm-receiver` guarda en `details.procedimiento` los pasos resueltos y el origen («Incendio» o «prioridad 1»). La ficha y el servidor usan esa instantánea. Un evento viejo sin instantánea resuelve con lo vigente.
- **Saltear:** nueva acción de gestión `PASO_PROC_SALTEO`, con `detalle` = `<paso> — <motivo>`.
- **Control en el servidor:** `tratarEvento` verifica que cada paso obligatorio de la instantánea tenga un `PASO_PROC` o un `PASO_PROC_SALTEO` vigente. Si falta alguno, devuelve 409 con la lista.

- **Por qué la instantánea:** la auditoría tiene que coincidir con lo que vio el operador (spec «Edición de procedimientos»).
- **Descartado:** versionar el ajuste. Más complejo, y no aporta sobre guardar los pasos en el evento.

### 9. La pared escucha la gestión
`/api/monitor/centrales` suma a cada pendiente:

- `procedimiento`: pasos con su estado, quién y cuándo;
- `camaras` resueltas con origen;
- `otras` (cámaras del abonado).

La vista ya relee con `alarma_gestion`, el evento que emite `registrarGestion`, así que un paso tildado se ve en menos de 2 s.

## Risks / Trade-offs

- [Un administrador apaga la recepción por error y las centrales quedan sin receptor] → El texto «si se apaga» lo dice antes de confirmar, el cambio queda auditado, y la salud de las centrales pasa a «sin supervisión» y avisa por las reglas existentes.
- [El receptor sondea la base cada 15 s] → Es una consulta liviana por clave, en un proceso aparte del web. Si la base no contesta, se mantiene el último estado conocido y nunca se cierra el puerto por un fallo de consulta (misma regla que `funcionActiva`).
- [Las cámaras del área pueden ser muchas] → Tope de 4 para la verificación; el resto queda en «otras cámaras del abonado» sólo si están en la lista del abonado.
- [Vivo de 4 cámaras más grabación en una PC de pared modesta] → La grabación reemplaza al vivo de esa cámara, no se suma; las «otras» se abren de a una.
- [Canales `nvrch-…` en `ZonaCentral.camaras` leídos por código viejo que espera ids de equipo] → Todos los lectores pasan por `camarasDeZona` en este cambio. `fotoDe` del receptor ya usa `lpr_<id>`, que funciona igual para un canal.
- [Instalaciones en modo Filas ven aparecer Intrusión y Gestión de alarmas] → Es lo pedido, y la proposal lo marca como cambio de comportamiento. Quien no lo quiera apaga la función.

## Migration Plan

1. Migración Prisma aditiva (`CentralAlarma.camaras`), con `prisma migrate deploy` desde `desplegar.sh`.
2. `scripts/funciones-instalacion.js`, idempotente: escribe las tres claves si no existen, según haya centrales. `desplegar.sh` lo corre después de la migración.
3. Compilar el web y reiniciar `alarm-receiver` (`pm2 restart alarm-receiver --update-env`).
4. Verificación en el lab:
   - apagar y prender la recepción y medir con `nc` que el puerto 10010 cierra y abre en menos de 30 s;
   - mandar un evento del simulador con cada combinación de funciones;
   - abrir la ficha y la pared, y comprobar el vivo y «Ver el momento» en una cámara de NVR;
   - tratar con un paso obligatorio sin tildar y ver el 409.
5. **Volver atrás:** prender las tres funciones restaura el comportamiento anterior sin revertir código. La columna nueva no estorba a la versión anterior.

Todo en el lab; San Nicolás sólo con el OK de Nico.

## Open Questions

- El texto exacto del procedimiento por defecto de cada clase (bomberos 104, emergencia médica 105, policía 911). Arranca vacío, con «usar el de su prioridad», y lo completa Nico en Ajustes; no cambia el diseño.
