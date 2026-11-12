# Design

## Context

Ver `proposal.md` para el porqué. Lo que hay hoy y condiciona el cómo:

- La foto de una cámara se toma en `POST /api/vision/objetos/fotos?camara=<id>`: pide `frame.jpeg` a go2rtc, primero del stream principal (`lpr_<id>_hd`) y si no del secundario; para un canal de grabador (`nvrch-<nvr>-<ch>`) antes registra el stream con `registrarCanalNvr`. Guarda con `guardarFoto(bytes, "CAMARA", deviceId)` (JPEG, lado mayor 1920) en `FotoEntrenamiento`.
- Esa ruta pide sesión con permiso (`puedeCambiar`). No hay forma de llamarla desde un proceso.
- Los ciclos periódicos de visión viven en `vision-worker.js`, cada uno en su módulo CommonJS (`vision-zonas.js`, `vision-vocab-indice.js`…) con un `iniciar({ prisma, log, … })`. Los procesos llaman a la aplicación por `APP_INTERNAL_URL`, y las rutas pensadas para procesos usan `src/lib/token-interno.ts`.
- `tests/permisos-api.test.ts` exige que toda ruta que cambia algo esté clasificada en `src/lib/permisos-api.ts`.
- En el lab, el stream principal de las cámaras del NVR 02 no sale (12/11, sin resolver): ahí la foto cae al secundario, con menos resolución.

## Goals / Non-Goals

**Goals:**

- Un solo camino para tomar la foto de una cámara, lo llame una persona o el reloj.
- Que una programación mal pensada (muchas cámaras, cada 5 minutos) no pueda llenar el disco, la cola ni cargar los grabadores.
- Que el criterio de «repetida» salga de una medición sobre cámaras reales, no de un número puesto a ojo.

**Non-Goals:**

- Proponer cajas sobre las fotos nuevas con el modelo ya entrenado (pre-etiquetado). Es el paso natural siguiente y va en otro cambio.
- Capturar por evento (cuando hay movimiento o una detección). Para eso ya existe traer del registro de detecciones.
- Grabar video o ráfagas.
- Tocar la captura de muestras de las analíticas entrenables (`vision-zonas.js`), que es otro conjunto.

## Decisions

### El reloj está en `vision-worker`; la foto la toma la aplicación

Un módulo nuevo `vision-capturas.js` se despierta una vez por minuto, busca las programaciones a las que les toca y, por cada una, llama a una ruta interna de la aplicación (`POST /api/vision/objetos/capturas/<id>/vuelta`, con token interno). La ruta hace todo lo demás.

- *Por qué:* tomar el cuadro (principal antes que secundario, registrar el canal del grabador, guardar con el tope de tamaño) ya está escrito en la aplicación, en TypeScript. Repetirlo en el proceso sería tener dos caminos que se van a separar — el día que cambie cómo se elige el stream, uno de los dos queda viejo.
- *Alternativa descartada:* que el proceso pida el cuadro a go2rtc y escriba en el bucket por su cuenta. Más directo, pero duplica la lógica y las constantes (`LADO_MAX`, calidad, clave en el bucket).
- *Alternativa descartada:* un `setInterval` dentro de Next. No hay un lugar que viva una sola vez: con más de un proceso de la aplicación se tomarían fotos dobles.

La toma del cuadro sale de la ruta actual a una función compartida (`cuadroDeCamara(id)` en `src/lib/detector-propio-servidor.ts`); «Sacar foto ahora» y la vuelta programada llaman a la misma.

### Datos

```prisma
/// Una programación de capturas para el conjunto de entrenamiento (openspec capturas-programadas-entrenamiento).
model CapturaProgramada {
  id        String    @id @default(cuid())
  nombre    String
  /// Ids de equipo o de canal de grabador («nvrch-<nvr>-<ch>»), como FotoEntrenamiento.deviceId
  camaras   String[]
  cadaMin   Int       @default(30)
  /// { desde: "HH:MM", hasta: "HH:MM" } o null = todo el día. Hora de Uruguay.
  horario   Json?
  tope      Int       @default(200)
  hasta     DateTime?
  activa    Boolean   @default(true)
  /// Pedido de «Tomar ahora»: el reloj la toma en su próxima vuelta
  forzarAt  DateTime?
  proximaAt DateTime  @default(now())
  guardadas Int       @default(0)
  salteadas Int       @default(0)
  /// Por cámara: { [id]: { huella, ultimaAt, fallos, error, errorDesde } }
  estado    Json      @default("{}")
  /// Por qué terminó: "tope" | "fecha" | null
  terminada String?
  creadaPor String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

Y en `FotoEntrenamiento`: `programaId String?` con índice `(programaId, revisada)`. Sin relación con borrado en cascada: borrar la programación deja las fotos (la columna queda apuntando a un id que ya no existe, y la pantalla lo trata como «programada»).

El `origen` de la foto sigue siendo `"CAMARA"`: es lo que mira la mezcla del conjunto (`CamarasOSubidas`), y una foto programada es una foto de cámara. Lo que distingue es `programaId`.

- *Alternativa descartada:* un origen nuevo `"PROGRAMADA"`. Obligaba a tocar cada lugar que suma por origen para que la cuente como cámara.

Los contadores van en columnas y no se calculan contando fotos, porque descartar fotos no debe devolverle cupo a la programación: el tope es «cuántas tomó», no «cuántas quedan».

### La regla de cuándo toca es una función pura

`src/lib/capturas-programadas.ts`: `queHacer(programa, { ahora, sinDibujar })` devuelve `tomar | esperar-cola | fuera-de-franja | pausada | terminada(motivo)` y la próxima hora. La usan la ruta interna, la pantalla (para decir el estado) y los tests. El reloj del proceso sólo pregunta «¿cuáles tienen `proximaAt <= ahora` o `forzarAt`?».

La franja horaria se evalúa en `America/Montevideo`, como el horario de las analíticas.

### «Repetida»: huella chica del cuadro, umbral medido

De cada cuadro se guarda una huella: la imagen en gris a 32×18, como 576 números. Dos cuadros son «la misma escena» si la diferencia absoluta media entre huellas queda por debajo de un umbral, y además ninguna celda de una grilla de 4×3 supera un segundo umbral (para que un objeto chico que aparece en una esquina no se pierda en el promedio).

La huella de la última foto **guardada** de cada cámara vive en `estado`; se compara contra esa, no contra el último cuadro visto: así un cambio lento (una sombra que avanza) termina sumando y se guarda.

**Los dos umbrales no se eligen ahora.** Antes de fijarlos se mide en el lab, sobre cámaras reales: la diferencia entre cuadros consecutivos de una escena quieta (de día y de noche, que tiene más ruido) y la diferencia cuando entra un vehículo o una persona. El umbral va entre las dos distribuciones y queda como constante con nombre y con la medición escrita al lado. Si las distribuciones se pisan, se avisa antes de seguir.

- *Alternativa descartada:* comparar los vectores SigLIP de omni-vision. Distingue mejor el contenido, pero usa la GPU y deja de andar mientras el entrenador tiene parado omni-vision — justo cuando más se quieren fotos nuevas.
- *Alternativa descartada:* no deduplicar y confiar en el tope. Doscientas fotos iguales de una calle vacía agotan la programación sin enseñar nada.

### Frenos

| Constante | Valor | Qué evita |
|---|---|---|
| `CADA_MIN_MINIMO` | 5 | Abrir el stream principal de un grabador más seguido de lo que tiene sentido |
| `CADA_MIN_MAXIMO` | 1440 | — |
| `TOPE_DEFECTO` / `TOPE_MAXIMO` | 200 / 1000 | Disco y cola por programación |
| `DIAS_DEFECTO` | 7 | Una programación olvidada |
| `COLA_MAXIMA` | 500 | Que «Sin dibujar» se vuelva inmanejable; con la cola llena todas esperan |
| `CAMARAS_MAXIMO` | 30 | Una vuelta que no termina antes de la siguiente |

Las cámaras de una vuelta se toman **de a una**, en fila. Si una vuelta sigue corriendo cuando el reloj vuelve a mirar, esa programación se saltea (marca `enVueltaDesde` en `estado`, que vence a los 10 minutos por si el proceso murió en el medio).

### Rutas y permisos

- `GET/POST /api/vision/objetos/capturas` y `PUT/DELETE /api/vision/objetos/capturas/<id>`: listar, crear, editar (incluye pausar/reanudar y «tomar ahora»), borrar. `DELETE …/<id>/fotos` descarta las sin dibujar de esa programación. Mismos permisos que el resto del conjunto (`puedeMirar` / `puedeCambiar`).
- `POST /api/vision/objetos/capturas/<id>/vuelta`: sólo token interno. Clasificada `propio` en `permisos-api.ts`.

### Pantalla

En `SoltarFotos`, junto a «Sacar foto ahora», un botón «Programar capturas» que abre un diálogo (`ui/dialog`) con la lista de programaciones y el formulario. Piezas compartidas del sistema de diseño: `Button`, `Chip` con los tonos de estado (activa = bien, esperando = aviso, pausada/terminada = quieto, cámara sin imagen = mal), `ConfirmarAccion` para borrar y descartar, y los cuatro estados (cargando, vacío, error con reintento, datos). El selector de cámaras reutiliza la lista agrupada por grabador que `SoltarFotos` ya arma.

En la grilla de fotos, la programada lleva una marca chica («Programada») junto al nombre de la cámara. Sin filtro nuevo en esta vuelta: el descarte en bloque cubre el caso de «me llenó la cola».

Que el proceso esté vivo se sabe por un latido: `vision-capturas.js` escribe la hora de su última pasada en `Setting` (`CAPTURAS_LATIDO`); si tiene más de 5 minutos y hay programaciones activas, la pantalla lo dice.

## Risks / Trade-offs

- **Carga sobre grabadores y go2rtc** al abrir el stream principal → de a una cámara, mínimo 5 minutos, máximo 30 cámaras por programación. Se mide en el lab cuánto tarda una vuelta de varias cámaras antes de dar por buenos los topes.
- **El stream principal no sale y la foto cae al secundario** (hoy, NVR 02 del lab) → la foto se guarda igual, con su tamaño real; la pantalla ya muestra el tamaño de cada foto. No se oculta: entrenar con cuadros chicos es peor, y conviene verlo.
- **El umbral de «repetida» puede descartar un objeto chico y quieto** que es justo lo que se quiere enseñar (un cono lejos) → la grilla por celdas baja el riesgo; lo salteado se cuenta a la vista, y «Sacar foto ahora» sigue existiendo para forzar una.
- **Privacidad:** son fotos de las mismas cámaras que ya se graban y quedan en el mismo bucket que las demás fotos de entrenamiento; no sale nada de la instancia.
- **Si `vision-worker` no corre, no hay capturas** → latido visible en la pantalla.

## Migration Plan

1. Migración aditiva (`prisma migrate deploy`): tabla `CapturaProgramada`, columna `FotoEntrenamiento.programaId` con su índice.
2. Desplegar la aplicación y reiniciar `omniaccess-web` y el proceso de visión.
3. Vuelta atrás: revertir el código. La tabla y la columna pueden quedar: nada viejo las lee.

## Open Questions

- ¿Conviene que la pantalla muestre cuántas fotos hay por franja del día (mañana, tarde, noche) para ver qué falta cubrir? No cambia este cambio: se puede sumar después sobre los mismos datos.
