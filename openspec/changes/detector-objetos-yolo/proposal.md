# Proposal

## Why

Hoy toda la inteligencia de video de OmniAccess viene de afuera o de un solo propósito:
los cruces y zonas los decide la cámara (AcuSense), las matrículas las lee omni-lpr y la
búsqueda por texto sólo existe en los NVR con AcuSeek. Eso tiene tres costos medidos:

- **Falsas alarmas.** El 9/10 a las 10:04 iban 63 marcadas falsas sobre 83 detecciones del
  día (76 %), casi todas de la LPR Interior: gente caminando la calle, un perro, sombras. Cada
  una pidió una decisión humana.
- **Lo que no se ve.** La cámara de Salida cuenta "Motorbike 0" (las motos no existen si no
  paran), un vehículo que pasa sin que se lea su chapa no deja rastro, y la cámara de Entrada
  casi no lee de noche.
- **Buscar es imposible sin AcuSeek.** "¿Cuándo pasó una camioneta blanca?" o "¿dónde quedó
  la mochila roja?" se contesta mirando horas de grabación, salvo en un NVR VPro con licencia.

Un detector de objetos propio —la familia YOLO en su última versión, YOLO26 (enero 2026), u
otro con el mismo contrato— corriendo como contenedor al lado de omni-lpr, en la misma GPU,
resuelve las tres con una sola pieza: mira el cuadro, dice qué hay y dónde, y guarda lo
suficiente para buscarlo después.

## What Changes

- **Nuevo contenedor `omni-vision`** (Docker, GPU, como omni-lpr): detecta objetos en un
  cuadro (persona, vehículo por tipo, moto, bicicleta, animal, mochila/bolso/valija…) y
  devuelve cajas, clases y confianza. Contrato HTTP propio, independiente del modelo.
- **Nuevo proceso PM2 `vision-worker`**: toma los cuadros (de la captura del evento, de
  go2rtc o del NVR), le pide al contenedor, aplica las reglas de cada modo y escribe
  resultados. Con presupuesto de GPU y prioridad: omni-lpr primero.
- **Intrusión con doble verificación**: cada detección de cámara (cruce, zona) se verifica con
  el detector en los cuadros de ese instante. Queda marcada *confirmada por el detector* /
  *no confirmada* / *sin dato*, con las cajas dibujadas en la ficha. Configurable por regla:
  sólo marcar (por defecto), no mandar WhatsApp si no confirma, o pedir decisión igual.
  **Nunca se acepta ni se descarta sola**: decide una persona.
- **LPR enriquecido**: tipo y color de vehículo cuando la cámara no lo da, conteo de motos,
  "vehículo sin lectura" (pasó un vehículo y ninguna lectora leyó), dos vehículos con una sola
  lectura (colado).
- **Face**: presencia y conteo de personas en el punto de acceso (acompañantes, alguien que
  pasa detrás); el reconocimiento facial no se reemplaza.
- **Filas**: conteo de personas en una zona dibujada para cámaras sin analítica de filas.
- **Búsqueda de objetos al estilo AcuSeek/AcuSearch**: índice de lo que el detector vio
  (recortes + descriptor visual) y una pantalla de búsqueda por texto ("camioneta blanca",
  "persona con mochila roja") o por imagen, por cámaras y rango de tiempo; cada resultado abre
  la grabación en ese instante. Las búsquedas en NVR con AcuSeek se integran en la misma
  pantalla como otra fuente. Incluye **objetos dejados**: algo que apareció en una zona y
  quedó quieto más de N minutos.
- **Ajustes → Módulos → Visión**: activar por modo, modelo y tamaño, umbrales, cámaras que
  se indexan y a qué ritmo, retención de recortes, estado del contenedor y consumo de GPU.

## Capabilities

### New Capabilities
- `deteccion-objetos`: el servicio de detección (contenedor + worker), su contrato, el
  presupuesto de GPU compartida con omni-lpr, la activación por modo y su estado visible.
- `verificacion-intrusion`: la segunda opinión del detector sobre cada detección de cámara,
  cómo se muestra y qué puede cambiar (y qué no) según la configuración de la regla.
- `busqueda-objetos`: el índice de objetos vistos, la búsqueda por texto y por imagen, los
  objetos dejados y la integración con AcuSeek de los NVR.
- `analitica-acceso`: lo que el detector agrega a LPR, Face y Filas (tipo/color, motos,
  vehículo sin lectura, colado, conteo de personas).

### Modified Capabilities
- `monitor-intrusion`: la ficha de una detección muestra la verificación del detector (cajas
  y veredicto) y el filtro de la lista distingue confirmadas por el detector.

## Impact

- **Infra**: un contenedor Docker más en el CT 200 sobre la RTX 3050 compartida con omni-lpr;
  VRAM y turnos de GPU a medir antes de habilitar el índice continuo. Imagen CUDA 13 +
  cuDNN 9 + TensorRT (la misma base que omni-lpr).
- **Licencia (decisión de Nico, bloqueante para producción)**: YOLO26/YOLOE-26 de Ultralytics
  son AGPL-3.0 y Ultralytics declara que un uso como servicio requiere su Licencia Enterprise.
  El contrato del contenedor es independiente del modelo para poder usar, sin esa licencia,
  un detector Apache-2.0 equivalente (RF-DETR, D-FINE) y un descriptor visual Apache/MIT
  (SigLIP, OpenCLIP) para la búsqueda.
- **Datos**: tablas nuevas (objetos vistos, verificación por detección, objetos dejados),
  bucket MinIO `objetos` con retención propia, columna vectorial (pgvector) para la búsqueda.
- **Código**: `vision-worker.js` (PM2 nuevo), `lib/vision/*`, `/api/vision/*`, ficha de
  detección y monitores (intrusión, LPR), pantalla `/admin/buscar`, Ajustes → Visión.
  `server.js` **no se toca**: el worker toma las detecciones de la base.
- **Procesos PM2 a reiniciar**: `omniaccess-web` (pantallas), alta de `vision-worker`.
  `omniaccess-webhooks` no.
- **Páginas a verificar**: `/admin/monitor-intrusion`, `/monitor/intrusion`,
  `/admin/monitor-lpr`, `/admin/buscar`, `/admin/settings?seccion=vision`, `/monitor/salud`.

### Out of scope

- Entrenar modelos propios o afinar con imágenes del barrio (queda como fase posterior).
- Reemplazar omni-lpr para leer matrículas o el motor de reconocimiento facial.
- Aceptar, descartar o resolver alarmas automáticamente.
- Seguimiento de una misma persona entre cámaras (re-identificación) y control de PTZ.
- Inferencia en la nube: todo corre en el servidor del barrio.
- Analítica dentro de las cámaras (configurar AcuSense sigue siendo lo que es).
