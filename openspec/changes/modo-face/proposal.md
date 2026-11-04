# Proposal

## Why

OmniAccess ya lee matrículas con un motor propio (`omni-lpr`) y corre analíticas de video con `omni-vision` (siluetas, búsqueda de parecidos, intrusión, doble verificación). El **reconocimiento facial, en cambio, no está andando**. Medido en el servidor el 4/11:

- **0 eventos `FACE`** jamás (59.604 accesos, todos `PLATE`);
- **ningún contenedor de rostros** (sólo `omni-lpr` y `omni-vision`);
- **ninguna cámara de tipo facial** dada de alta (sólo `CAMERA`, `LPR_CAMERA`, `LPR_INTERIOR`, `NVR`, `ALARM_HUB`);
- **una sola persona con rostro cargado** (`User.cara`), de prueba.

Sin embargo, todo el resto del sistema ya está preparado para FACE: `AccessEvent.accessType` contempla `FACE`, la permanencia se calcula por `userId`, el padrón clasifica por usuario (residente/VIP/lista negra) y el **Monitor Face** (`monitor-face`, del change `pared-vms`) ya muestra accesos faciales de terminales Hikvision (`FACE_TERMINAL`). Lo que falta es el **motor**: que OmniAccess reconozca rostros con cámaras comunes —como ya relee matrículas— y escriba el acceso con la persona identificada, sin depender de una terminal Hikvision por puerta.

Este change planifica ese motor. No toca las terminales faciales (que ya escriben `FACE_TERMINAL` por su cuenta): agrega el reconocimiento **por OmniVision** sobre cámaras de video, que es lo que encaja con las analíticas ya hechas.

## What Changes

- **Un motor de rostros propio**, un contenedor anexo a OmniAccess (`omni-face`), igual que `omni-lpr`: expone un endpoint de inferencia que, dado un recorte de persona, devuelve un vector de rostro (embedding). No decide; sólo calcula la huella.
- **Enrolamiento de rostros**: a cada `User` se le puede cargar una o varias fotos de cara; de cada una se guarda su huella (`HuellaRostro`). Es el padrón contra el que se compara.
- **Reconocimiento sobre cámaras de video**: una cámara marcada como facial (o una analítica de OmniVision) detecta una persona, OmniVision le saca el rostro, lo compara contra el padrón de huellas y, si hay match por encima del umbral, escribe un `AccessEvent` de tipo `FACE` con el `userId` reconocido, la confianza y la foto. Sin match, queda como persona desconocida (no se inventa identidad).
- **Reutiliza, no duplica**: el acceso FACE cae en el mismo monitor (el Lote y el nombre ya salen grandes y centrados), el mismo cálculo de permanencia por `userId`, el mismo padrón y la misma lista de vigilancia por rol. El cajón Investigar muestra el recorrido **por persona** (en vez de por chapa). La doble verificación tiene su espejo: re-identificar el rostro del recorte, como ya se relee la matrícula.
- **Umbral y privacidad explícitos**: el umbral de match es configurable; por debajo no hay identidad. El enrolamiento y las huellas de rostro son datos sensibles: quedan detrás de permiso y no salen del servidor.

Fuera de alcance de este change: las terminales faciales Hikvision (ya resueltas como `FACE_TERMINAL`), una lista de vigilancia **por rostro** (hoy alcanza el rol del usuario), y el modelo exacto a usar (se decide en `design.md` según la GPU disponible, que ya comparte `omni-lpr` y `omni-vision`).

## Capabilities

### New Capabilities

- `face-omnivision`: el reconocimiento facial propio de OmniAccess — el motor de huellas de rostro (`omni-face`), el enrolamiento de caras de usuarios, y el reconocimiento sobre cámaras de video que escribe accesos `FACE` con la persona identificada. Complementa a `monitor-face` (la pantalla) y a `FACE_TERMINAL` (las terminales Hikvision).

### Modified Capabilities

Ninguna: `openspec/specs/` todavía no tiene especificaciones archivadas.

## Impact

- **Infraestructura**: un contenedor Docker nuevo (`omni-face`) que comparte la GPU con `omni-lpr` y `omni-vision`. Hay que medir el presupuesto de GPU como se hizo con el lector de matrículas (`MAX_EN_VUELO`): el reconocimiento compite por la misma placa que la lectura de matrículas.
- **Base**: modelos nuevos `HuellaRostro` (la huella de una foto de un usuario) y, para la comparación en vivo, el reuso del patrón de `HuellaObjeto` (vector int8 + escala, sin índice vectorial: comparación por lotes). Migraciones aditivas (`prisma migrate deploy`, sólo `//` en el schema).
- **API**: endpoints de enrolamiento (cargar/borrar fotos de cara de un usuario) y el worker de reconocimiento (en `omni-vision`/`vision-worker`, no una ruta pública). Un tipo de dispositivo `FACE_CAMERA` o un modo facial sobre una cámara existente.
- **Datos sensibles**: huellas de rostro y fotos de cara. Permiso propio, sin exponerlas al navegador salvo donde ya se muestran (la ficha del usuario).
- **Relacionado**: el detector de objetos (`detector-objetos-yolo`) puede dar la detección de persona que alimenta el recorte de rostro; AcuSeek/AcuSearch quedan como la vía del NVR, no de OmniVision.
