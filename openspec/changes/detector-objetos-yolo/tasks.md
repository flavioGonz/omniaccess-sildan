# Tasks

## 0. Decisión previa (Nico)

- [x] 0.1 Decidir el modelo de producción: RF-DETR (Apache-2.0, sin costo) o YOLO26 con Licencia Enterprise de Ultralytics. Queda anotado en `claude/vision.md` y en el setting `VISION_MODELO`. Sin licencia comprada, YOLO26/YOLOE-26 sólo se usan para pruebas internas.
  - 9/10: Nico no paga licencias → **RF-DETR** (Nano/Small/Medium, Apache-2.0); XL/2XL (PML 1.0) y YOLO26/YOLOE-26 (AGPL) quedan fuera, también para pruebas.

## 1. Base: datos e infraestructura (fase 0, sin efecto visible)

- [ ] 1.1 Instalar `postgresql-17-pgvector` en el CT 200 y `CREATE EXTENSION vector`; verificar con `select extversion from pg_extension where extname='vector'`.
- [ ] 1.2 Migración Prisma: columnas nulables en `Detection` (`verificacion`, `verifClase`, `verifConfianza`, `verifCajas`, `verifAt`), tablas `ObjetoVisto` (con `vector(768)` e índice HNSW) y `ObjetoDejado`; `migrate deploy` + `prisma generate`; verificar que el build compila y que las pantallas actuales no cambian.
- [ ] 1.3 Bucket MinIO `objetos` creado si falta, con la regla de retención en la tarea programada de limpieza (Procesos y tareas); verificar subiendo y borrando un recorte de prueba.
- [ ] 1.4 Settings con valores por defecto apagados: `VISION_ENABLED`, `VISION_MODOS` (intrusion/lpr/face/filas/busqueda), `VISION_MODELO`, `VISION_UMBRAL`, `VISION_PRESUPUESTO_MIN`, `VISION_CAMARAS_INDICE`, `VISION_RETENCION_DIAS=7`; verificar que se leen con sus defaults.

## 2. Contenedor `omni-vision`

- [x] 2.1 Imagen Docker sobre la base CUDA 13 + cuDNN 9 de omni-lpr con FastAPI, onnxruntime-gpu/TensorRT, el detector configurado y SigLIP multilingüe; `docker run --gpus all` en el CT 200 sin compose roto (dejar `docker-compose.vision.yml` versionado y sin secretos).
  - 9/10: `services/omni-vision/` (Dockerfile en dos etapas + `run.sh`, igual que omni-lpr, sin compose). Corriendo en el CT 200 en 127.0.0.1:8010, `unless-stopped`, 2 CPU, 3 GB RAM, VRAM topada a 1,5 GB. **SigLIP todavía no**: entra con la fase 3 (búsqueda).
- [ ] 2.2 Endpoints `POST /detectar`, `POST /describir`, `POST /texto`, `GET /salud` (modelo, versión, licencia, VRAM, cola), una inferencia en vuelo; verificar con 3 imágenes de prueba (persona, auto, calle vacía) y anotar latencias.
  - 9/10: `/detectar` y `/salud` andando y verificados (persona en Salida 0,88, auto en LPR Interior 0,81, perimetrales vacías sin objetos; ~30 ms de inferencia en la 3050). Faltan `/describir` y `/texto` (con SigLIP, fase 3).
  - 9/10 (tarde): `/detectar` suma `tarea=segmentar|pose`, `atributos=1` (SigLIP 2 con frases precalculadas) y `sesion=` (ByteTrack por grupo). Siguen faltando `/describir` y `/texto` en vivo (vector libre y frase libre) para la búsqueda.
- [ ] 2.3 Medición con omni-lpr trabajando: VRAM total, latencia de lectura de matrículas antes/después y ningún `cudaError` en 30 min; resultado en `claude/vision.md`. Elegir Nano o Small con ese número.
  - 9/10: medición de 30 s en reposo y con omni-vision sin pausa (`herramientas/medir.py`): omni-lpr 29 → 42 ms por cuadro, la web sin cambio, GPU 72 %, VRAM total 2,9 GB. Falta la de 30 min sin `cudaError`.

## 3. `vision-worker` (PM2) y cliente

> 9/10: `vision-worker` ya existe como **registro de detecciones** (muestreo con compuerta de cambio de escena, una fila por pista en `ObjetoVisto`, recortes en el bucket `objetos`, retención 7 días, obedece a los interruptores) y se ve en `/admin/vision/detecciones`. Todavía no tiene la cola con prioridades ni la cesión a omni-lpr de 3.1: hoy es el único cliente continuo y usa 3-4 % de GPU.

- [ ] 3.1 `lib/vision/cliente.ts`: pedidos al contenedor con timeout, cola con prioridades (verificación > acceso > muestreo), cesión a omni-lpr consultando su estado y presupuesto por minuto; prueba con un contenedor simulado que la verificación nunca se descarta y el muestreo sí.
- [ ] 3.2 `vision-worker.js` en PM2 (`ecosystem` actualizado), apagado si `VISION_ENABLED=false`; métricas por minuto (pedidos, latencia, descartados) visibles en Procesos y tareas; verificar alta, parada y reinicio desde esa pantalla.
- [ ] 3.3 Estado en Salud y en la topología (nodo `omni-vision`), en rojo si `/salud` falla; el vigía reinicia el contenedor tras 3 fallos; verificar apagando el contenedor a mano.

## 4. Verificación de intrusión (fase 1)

- [ ] 4.1 Tomar las `Detection` analíticas sin veredicto, obtener captura + cuadros ±1 s (NVR), detectar y decidir con la geometría de línea/zona (`lib/vision/verificar.ts`); pruebas unitarias del criterio con cajas sintéticas: dentro/fuera de la línea, animal solo, sin cuadros.
- [ ] 4.2 Guardar el veredicto en `Detection` y emitir `detection_verified`; verificar con un cruce real que en < 3 s la detección tiene veredicto.
- [ ] 4.3 Ficha de detección (panel y pared) con cajas sobre la captura y rótulo del veredicto; filtro por veredicto en las listas del monitor de intrusión, el cajón de Detecciones del monitor LPR y la pared; verificar en `/admin/monitor-intrusion`, `/admin/monitor-lpr` y `/monitor/intrusion`.
- [ ] 4.4 Resumen por cámara: matriz detector (confirma/no/animal) × operador (real/falsa) del período, en la ficha de la cámara; verificar contra un conteo SQL.
- [ ] 4.5 Doc `claude/vision.md` con cómo funciona la verificación y la matriz de las dos primeras semanas.

## 5. Acceso: LPR, Face y Filas (fase 2)

- [ ] 5.1 Al llegar una lectura (enganche de `/api/notifications/event` y `paso-por-acceso.ts`), encolar el análisis de su foto y completar tipo/color estimados; verificar en el monitor LPR que una lectura "unknown" muestra el tipo estimado rotulado.
- [ ] 5.2 Conteo de motos y "vehículo sin lectura" por muestreo de las cámaras de acceso (±10 s sin lectura); verificar con el registro de una noche contra el video.
- [ ] 5.3 "Posible colado" (dos vehículos, una lectura) y "acompañado" en Face; verificar con eventos reales o grabados.
- [ ] 5.4 Conteo de personas en zona dibujada para Filas, con la misma pantalla de calibración de zonas; verificar que el módulo de Filas recibe el número.
- [ ] 5.5 Confirmar que ninguna decisión de barrera cambió: misma tasa de GRANT/DENY antes y después en un día comparable.
- [ ] 5.6 Lectura "primero el vehículo": omni-vision recorta cada vehículo y omni-lpr lee el recorte. Medido el 9/10 sobre 80 capturas de barrera (`herramientas/comparar_lpr.py`): coincide con la cámara 70 % exacta / 85 % a un carácter, contra 42 % / 55 % leyendo la foto entera; y lee 26 de los 40 NO_LEIDA de la cámara. Aplicarlo en `tracking-worker` y como segunda lectura de los NO_LEIDA, sin tocar la decisión de barrera.
  - [x] 5.6a Segunda lectura de los NO_LEIDA de los accesos (9/10, Nico eligió esta): `vision-relectura.js` dentro de vision-worker, tabla `Relectura`, sugerencia «¿ABC1234?» en el monitor LPR (de quién es, si está en lista negra) y «Cargar matrícula» la trae escrita para que el guardia la confirme; `/admin/vision/relecturas` con los números (coinciden con una lectura ±6 h, qué cargó el guardia). Analítica «relectura» en el laboratorio.
  - [ ] 5.6b En `tracking-worker` (seguimiento por las cámaras interiores): pendiente, después de ver los números de 5.6a.

## 6. Índice y búsqueda (fase 3)

> 9/10: la tabla de lo visto existe (`ObjetoVisto`, sin vector todavía: falta pgvector y la mitad de texto de SigLIP en vivo). 6.1 está hecha salvo el vector. También corre la lectura de texto (RapidOCR, Apache-2.0), que no estaba planificada: base de "empresa por rotulado" y "matrícula sin lectora".

- [ ] 6.1 Muestreo por cambio de escena de las cámaras de `VISION_CAMARAS_INDICE`, detección, recorte ≤ 256 px a MinIO, vector SigLIP y `ObjetoVisto` con deduplicación; verificar que una calle vacía no genera filas y que un auto que pasa genera una.
- [ ] 6.2 `POST /api/vision/buscar` (texto o imagen, cámaras, rango) con orden por distancia coseno, permiso `buscar` y registro en `AccionSistema`; prueba con un set de 30 frases reales anotadas (acierto en los 10 primeros ≥ 70 %).
- [ ] 6.3 Pantalla `/admin/buscar` (estilo del sistema: buscador, filtros, grilla de recortes con cámara/hora/fuente, "buscar parecidos", abrir grabación con `VerGrabacion`); `/admin/acuseek` redirige; los NVR con AcuSeek se consultan como otra fuente; verificar las dos fuentes en una búsqueda.
- [ ] 6.4 Objetos dejados en zonas marcadas (clase bolso/mochila/valija/caja quieta > N min) con aviso a la guardia y recorte; verificar con una mochila de prueba.
- [ ] 6.5 Retención: la limpieza diaria borra recortes y filas vencidas; verificar con datos de prueba fechados.

## 7. Opciones de regla (fase 4)

- [ ] 7.1 En la regla de notificación de intrusión: "avisar igual" (defecto), "no avisar afuera si no confirma" y "esperar veredicto hasta N s"; el despacho registra el motivo cuando no sale; verificar los tres casos con detecciones sintéticas.

## 7b. Analíticas de reglas y rotulado (9/10, pedido de Nico)

- [x] 7b.1 Reglas por cámara (Setting `VISION_REGLAS`, `src/lib/vision-reglas.ts`): conteo por línea, sentido contrario, permanencia y aglomeración, aplicadas en vision-worker (`vision-reglas.js`) sobre el pie de cada pista; tabla `EventoVision` (migración `20261010000000_vision_reglas`). Probado el motor con recorridos simulados.
- [x] 7b.2 Avisos a la guardia (`AvisoGuardia` VISION_SENTIDO / VISION_PERMANENCIA / VISION_AGLOMERACION) por `/internal/emit`, sin tocar server.js.
- [x] 7b.3 Pantalla `/admin/vision/reglas`: dibujar sobre el cuadro del mismo stream (`/api/vision/cuadro`), números de hoy y eventos con foto.
- [x] 7b.4 Empresa por rotulado: cuadro del stream principal por vehículo, OCR al cerrar la pista, `ObjetoVisto.textos`, empresa cruzada con el catálogo al mostrar (Detecciones).
- [ ] 7b.5 Medir con reglas reales una semana: cruces perdidos por pista cortada a ~2 s (contar a mano 15 min de video contra el conteo) y falsos de aglomeración.

## 8. Ajustes y verificación final

- [ ] 8.1 Ajustes → Módulos → Visión: activar por modo, modelo y licencia, umbral, presupuesto, cámaras del índice, retención, estado del contenedor y GPU; verificar que apagar un modo oculta sus resultados en todas las pantallas.
- [ ] 8.2 Build `BUILD_EXIT=0`, `pm2 restart omniaccess-web` y alta de `vision-worker`, y HTTP 200 con sesión en `/admin/monitor-intrusion`, `/monitor/intrusion`, `/admin/monitor-lpr`, `/admin/buscar`, `/admin/settings?seccion=vision` y `/monitor/salud`.
