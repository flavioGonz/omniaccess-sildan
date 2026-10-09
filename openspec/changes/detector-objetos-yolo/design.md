# Design

## Context

Ver proposal.md (Why). Lo que condiciona el diseño, medido el 9/10 en el CT 200:

- **GPU**: una RTX 3050 de **6 GB**. omni-lpr ocupa ~0,5 GB y trabaja con `MAX_EN_VUELO=1`,
  porque dos inferencias simultáneas envenenaban su contexto CUDA (`cudaErrorIllegalAddress`).
  La VRAM sobra; lo que hay que cuidar es el turno.
- **CPU/RAM**: 8 núcleos, 12 GB. **Disco**: `/datos` 3,6 TB al 2 %.
- **Base**: PostgreSQL 17. La extensión `vector` (pgvector) **no está disponible**; se instala
  desde el paquete de Debian (`postgresql-17-pgvector`).
- **Cuadros**: ya existen tres caminos — la captura de cada detección (bucket `intrusion`,
  `lib-intrusion-capture`), el snapshot por ISAPI/go2rtc (`/api/snapshot`, ahora con ancho) y
  la grabación del NVR (`lib/clip-nvr.ts`).
- **Patrón a imitar**: omni-lpr es un contenedor Docker (`omni-lpr:gpu`) que expone HTTP en
  `OMNI_LPR_URL`; `tracking-worker.js` (PM2) le pide, mide y escribe en la base. Se prende con
  `OMNI_LPR_ENABLED` desde Ajustes. Lo mismo aplica acá.
- **AcuSeek**: ya hay driver (`lib/acuseek.ts`) y pantalla (`/admin/acuseek`) para los NVR VPro
  que lo traen. La búsqueda propia se suma a esa pantalla, no la reemplaza.
- **server.js** no se toca sin OK de Nico: el worker lee las detecciones de la base.

## Goals / Non-Goals

**Goals:**
- Un servicio de visión con contrato estable y modelo intercambiable.
- Verificar el 100 % de las detecciones analíticas en menos de 3 s, sin demorar la lectura de
  matrículas.
- Un índice buscable de lo visto en las cámaras elegidas, con retención propia.

**Non-Goals:**
- Analizar video continuo a 25 fps: se trabaja sobre cuadros (eventos y muestreo de 0,5–1 c/s).
- Que el detector decida alarmas o accesos (specs: verificacion-intrusion, analitica-acceso).

## Decisions

### 1. Dos piezas: contenedor `omni-vision` (Python) + `vision-worker` (Node, PM2)
El contenedor sólo hace inferencia: `POST /detectar` (imagen → objetos), `POST /describir`
(imagen o recorte → vector), `POST /texto` (frase → vector), `GET /salud` (modelo, versión,
licencia, VRAM, cola). Todo lo demás —de dónde sale el cuadro, qué significa el resultado,
qué se guarda— vive en `vision-worker.js` y en `lib/vision/*`, en el mismo lenguaje que el resto.
*Alternativa descartada*: meter la inferencia en Node (onnxruntime-node). Pierde TensorRT y el
aislamiento: un cuelgue de CUDA tiraría el worker con todo su estado.

### 2. Modelo: RF-DETR (decidido el 9/10: no se pagan licencias)
YOLO26 (Ultralytics, enero 2026) es lo último de la familia: sin NMS, nano a 40,9 mAP y
1,7 ms en T4 con TensorRT, y YOLOE-26 agrega clases por texto. **Pero es AGPL-3.0**, y
Ultralytics declara que usarlo detrás de un servicio requiere su Licencia Enterprise; los
pesos entrenados también quedan bajo AGPL. OmniAccess es software cerrado servido por red.
Por eso el contrato (decisión 1) es independiente del modelo y el contenedor arranca con
**RF-DETR (Apache-2.0)** —Nano 48,4 mAP en 2,3 ms, Small 53,0 en 3,5 ms (T4, TensorRT FP16)—,
igual o mejor que YOLO11 en el mismo tiempo. **Decisión (9/10): Nico no paga licencias.** RF-DETR queda como modelo de producción
(`rfdetr-small` por defecto; `rfdetr-nano` y `rfdetr-medium` exportados en la misma imagen).
Corre en ONNX Runtime (no PyTorch) con el pre/posproceso de rfdetr replicado y comprobado al
construir. Si aparece otro detector libre mejor, se cambia por configuración (`VISION_MODELO`).
*Alternativas*: D-FINE (Apache-2.0, similar); YOLOX (Apache, más viejo y peor).

### 3. Descriptor para buscar: SigLIP (Apache-2.0) en el mismo contenedor
La búsqueda por texto y por imagen necesita llevar frases e imágenes al mismo espacio. Un
detector de clases fijas no alcanza para "camioneta **blanca**" o "mochila **roja**". Se guarda
por cada recorte un vector de SigLIP-base (768 dimensiones) y la frase se convierte con el
mismo modelo. Las frases en español se pasan tal cual si el modelo es multilingüe
(siglip-base-patch16-256-multilingual); si no rinde, se traducen con un diccionario corto de
colores, prendas y vehículos antes de codificar.
*Alternativas*: YOLOE con prompt de texto (AGPL, y sólo sirve para las clases que se piden
al momento de detectar, no para buscar en lo ya visto); OpenCLIP (MIT), plan B equivalente.

### 4. Índice en Postgres con pgvector, recortes en MinIO
Tabla `ObjetoVisto` (cámara, instante, clase, confianza, caja, recorte en bucket `objetos`,
`vector(768)` con índice HNSW). Búsqueda = filtro por cámara y rango + orden por distancia
coseno. Se queda en la misma base: copias, permisos y retención ya resueltos.
*Alternativa*: Qdrant/FAISS aparte — otro servicio que respaldar para unos cientos de miles de
vectores que Postgres maneja bien.

### 5. Verificación: tomar la detección de la base, mirar 3 cuadros
El worker consulta cada segundo las `Detection` analíticas sin veredicto (más nuevas que 2 min).
Para cada una usa la captura guardada y, si el NVR la entrega, dos cuadros ±1 s del instante.
Confirma si en algún cuadro hay persona o vehículo (o la clase que la cámara dijo) con
confianza ≥ umbral **y** su caja toca la línea o la zona (geometría ISAPI ya normalizada en
`getAnalyticsGeometryBatch`). Animal solo → "animal". Resultado en columnas nuevas de
`Detection` (`verificacion`, `verifClase`, `verifConfianza`, `verifCajas` JSON, `verifAt`) y
aviso por socket (`detection_verified`).
Para que una regla pueda "esperar el veredicto" (spec verificacion-intrusion), el motor de
notificaciones espera hasta el tope configurado leyendo esas columnas antes de despachar; no
hace falta tocar `server.js`, que ya llama al motor por `/api/notifications/event`.

### 6. Turnos de GPU: cola única con prioridad, y cesión a omni-lpr
`vision-worker` tiene una sola cola con tres prioridades: verificación > acceso (LPR/Face) >
muestreo del índice. Una inferencia en vuelo a la vez (como omni-lpr). Antes de cada pedido
consulta `GET /salud` de omni-lpr (`en_vuelo`); si está ocupado, espera hasta 200 ms. Presupuesto
por minuto (`VISION_PRESUPUESTO_MIN`) aplicado al muestreo; la verificación nunca se descarta.
*Alternativa*: dos GPUs o MIG — no hay.

### 7. Muestreo para el índice: cambio de escena, no reloj
Por cámara indexada, un cuadro cada 2 s por go2rtc (`?w=1280`), comparado con el anterior por
diferencia de luminancia reducida; sólo los que cambian van al detector. Una calle vacía a la
madrugada no gasta GPU. Los recortes se deduplican por cámara: el mismo objeto quieto (IoU
alto, vector casi igual) no se guarda dos veces; es también lo que detecta un **objeto dejado**.

### 8. Acceso (LPR/Face): enganche en el paso de la lectura
Se reutiliza el enganche del motor de visitas (`/api/notifications/event` y
`paso-por-acceso.ts`): al llegar una lectura, se encola un análisis de su foto; tipo/color,
"posible colado" y personas presentes se escriben como detalle estimado del evento. "Vehículo
sin lectura" sale del muestreo de las cámaras de acceso: vehículo cruzando sin lectura en ±10 s.

### 9. Pantalla de búsqueda única
`/admin/buscar` reemplaza la entrada de `/admin/acuseek` (que redirige): un campo de texto,
cámaras y rango; consulta en paralelo el índice propio y los NVR con AcuSeek activado; cada
resultado dice su fuente y abre `VerGrabacion` en el instante. Permiso nuevo `buscar` y
registro en `AccionSistema`.

## Risks / Trade-offs

- [Licencia AGPL de YOLO26] → contrato independiente del modelo; RF-DETR por defecto; Ajustes
  muestra la licencia del modelo cargado.
- [CUDA compartida inestable (ya pasó con omni-lpr)] → un solo proceso de inferencia por
  contenedor, una en vuelo, cesión a omni-lpr, reinicio del contenedor por el vigía si `/salud`
  falla 3 veces. Fase 1 sin índice continuo para medir.
- [El detector también se equivoca de noche] → el veredicto es un dato, no una decisión; se
  mide con la matriz detector × operador antes de ofrecer "no avisar afuera".
- [Privacidad: un índice de personas buscable] → permiso propio, registro de cada búsqueda,
  retención corta por defecto (7 días) y sólo las cámaras elegidas.
- [Crece el disco y la base] → recortes chicos (≤ 256 px), deduplicación, retención y
  limpieza en la tarea programada (Procesos y tareas).
- [Frases en español con un descriptor entrenado en inglés] → modelo multilingüe; si no
  rinde, diccionario de traducción de atributos; se mide con un set de 30 frases reales.

## Migration Plan

1. Fase 0 (sin efecto visible): pgvector, migración Prisma, contenedor con el modelo, `vision-worker`
   apagado. Medir VRAM y latencia con omni-lpr trabajando.
2. Fase 1: verificación de intrusión **sólo marcando** (sin cambiar avisos). Dos semanas de matriz
   detector × operador.
3. Fase 2: acceso (tipo/color, motos, sin lectura, colado, personas) y Filas.
4. Fase 3: índice y búsqueda con pocas cámaras; después objetos dejados.
5. Fase 4: opciones de regla ("no avisar afuera si no confirma", "esperar veredicto").

**Volver atrás**: `VISION_ENABLED=false` apaga todo; el worker deja de encolar y las pantallas
ocultan lo del detector. Las columnas nuevas son nulables: no hace falta revertir la migración.

## Open Questions

- Qué tamaño de modelo rinde mejor en la 3050 de noche (Nano vs Small): se decide midiendo en
  la fase 0, no cambia el plan.
- Cuántas cámaras entran en el índice continuo antes de afectar a omni-lpr: se mide en la fase 3.
