---
name: omniaccess-motor
description: Cómo MEDIR el motor de seguimiento de OmniAccess antes de opinar de él — cuadros, ráfagas, correlaciones de la franja, GPU — y qué significa cada constante de franja.ts y tracking-worker.js. Usar SIEMPRE que se diga que el motor "no lee", "se frena", marca estacionamientos que no existen, o antes de tocar cualquier umbral.
---

# Medir el motor antes de opinar

Todo hallazgo que valió algo en este proyecto salió de un número, y todas las conclusiones
apuradas salieron mal. La lista es corta y vale tenerla presente:

- "El motor no lee" resultó ser **cuadros HEVC roto**: 94 KB donde el resto pesaba 1 MB.
- "El estacionamiento anda mal" resultó ser **una correlación de 0,39** con la calle vacía:
  el criterio comparaba un recorte consigo mismo y la calle vacía también se parece a sí
  misma.
- "Se frena" resultó ser **`cudaErrorIllegalAddress` con diez conexiones simultáneas** al
  lector.
- "Hay contextos de CUDA zombies" resultó ser **falso**: esos PID reaparecen después de un
  reinicio limpio porque son del lector que está corriendo.

De ahí la regla: **primero el número, después la conclusión, y recién después el código.**

## La cadena, para saber dónde mirar

```
cámara RTSP → go2rtc → ffmpeg (cuadros JPEG) → baldosas → omni-lpr (GPU) →
votación entre cuadros → compuerta (zona/línea) → avistamiento → franja (ocupación)
```

Cada flecha puede romperse sola y todas se ven igual desde el panel ("no hay lecturas").
Las mediciones de abajo sirven para saber **cuál** flecha.

## Las mediciones

### ¿Llegan cuadros, y son sanos?

Un cuadro roto no es "no había matrícula": es "no hubo imagen", y son problemas distintos.

```bash
cd /opt/OmniAccess
ls -l --block-size=K /datos/track | tail -20
```

Lo que se busca es la **dispersión de tamaños**. Si la mediana es 1 MB y hay cuadros de
90 KB, esos están rotos (HEVC partido). El worker ya los descarta con `sinCuadrosRotos()`
usando la mediana por cámara — `CUADRO_MIN_BYTES=4096`, `CUADRO_FACTOR=4`,
`CUADRO_MUESTRAS=12` — y lo dice en el log:

```bash
grep -i "rota\|rotos" logs/tracking-worker-out.log | tail -20
```

### ¿Se abren ráfagas, y dan lectura?

```bash
grep -E "rafaga abierta|rafaga sin matricula|sin cuota" logs/tracking-worker-out.log | tail -40
```

Tres lecturas distintas del mismo log:

- **No hay "rafaga abierta"** → el disparo no ocurre. Es la sensibilidad de escena, la zona
  o la regla de la cámara. No es el lector.
- **Hay ráfagas y todas "sin matricula"** → se mira y no se lee. Ahí sí es el lector, el
  encuadre o la distancia.
- **"sin cuota"** → el presupuesto (`PRESUPUESTO_POR_MIN=90` inferencias por cámara por
  minuto) frenó el disparo. La tasa queda intacta y el conteo baja: no es una falla.

Y el mismo dato agregado, por cámara y por minuto, está en `TrackingCamaraMuestra`
(disparos / lecturas / descartes / fueraDeLinea / frenados). El denominador de la tasa de
seguimiento es **la ráfaga**, no el evento: una ráfaga seca no escribe ninguna fila, así
que contar avistamientos da un numerador sin denominador.

### ¿El lector está en GPU, y está vivo?

```bash
docker inspect omni-lpr --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'
docker logs omni-lpr 2>&1 | grep -i ExecutionProvider | tail -3
nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw --format=csv
```

Si cayó a CPU **no lo dice ninguna métrica**: hay que preguntárselo al log, y hay que
mirar las líneas del arranque, no las últimas — el aviso queda atrás enseguida.

Ojo con dos cosas: `RestartCount: 0` con `Exited (128)` significa que Docker intentó y no
pudo, no que no intentó. Y `MAX_EN_VUELO` está en **1** a propósito: la concurrencia
envenenaba el contexto de CUDA.

### ¿La franja distingue ocupado de vacío?

Esta es la medición que cambió el criterio del estacionamiento. `src/lib/franja.ts`:

- La geometría son cuatro esquinas (`a,b,c,d`) y la celda *i* va de `lerp(a,b)` a
  `lerp(d,c)`, así las celdas se achican con la perspectiva.
- `huellaDeCelda` promedia un parche por muestra. **Muestrear un solo píxel dejó la franja
  inservible** — daba 0,39 / 0,28 / 0,085 sin que nada se moviera.
- `correlacion` es NCC contra la huella del vacío aprendido.

Los umbrales, y qué significa cada uno:

| Constante | Valor | Qué decide |
|---|---|---|
| `CORRELACION_MIN` | 0,50 | Debajo de esto la celda **no** se parece al vacío → ocupada |
| `TEXTURA_FACTOR` | 1,9 | Respaldo: cuánta más textura que el vacío hace sospechar |
| `TEXTURA_PISO` | 4 | **Sin esto el respaldo se disparaba solo**, porque era la razón entre dos desvíos minúsculos |
| `CUADRO_PISO` | 8 | Contraste mínimo del cuadro; debajo, el cuadro no se usa |
| `MUESTRAS_LARGO/ANCHO` | 12 / 5 | Cuántas muestras por celda |
| `VUELTAS_OCUPAR` | 2 | Vueltas seguidas para declarar ocupado |
| `VUELTAS_LIBERAR` | 3 | Vueltas seguidas para declarar libre (más, porque irse es más caro de equivocar) |
| `MEZCLA_VACIO` | 0,04 | Cuánto del cuadro actual se mezcla al vacío aprendido |

**Para tocar cualquiera de estos hay que tener antes el número medido**, con la calle vacía
y con la calle ocupada. Un umbral movido sin las dos mediciones es una adivinanza con
aspecto de ajuste.

### El sujeto de la pregunta

La estadía colgaba de la **chapa**, y una lectura sólo prueba que una chapa cruzó el
cuadro: no dice nada sobre si el vehículo está quieto. Con ese criterio, treinta horas de
Calle 22 dieron **siete estadías para AAU9032** — un auto que no se movió nunca — y en
Calle 21 el mismo auto figuró como tres (SDM1707, SDH1707, 5DH177) porque el OCR lo leyó
distinto cada vez.

La franja cambia el sujeto: la estadía es **del lugar**. "¿Está ocupado este polígono?" se
puede contestar con píxeles porque el polígono no se mueve y su aspecto vacío se puede
aprender. La chapa pasa a **nombrar** al ocupante, no a probarlo.

Si alguien propone volver a colgar la estadía de la chapa, esto es la respuesta.

## Lo que NO hay que hacer

- **No concluir sin medir.** Si el número no está, decir qué habría que medir.
- **No tocar un umbral para que un caso funcione.** Los umbrales tienen un porqué escrito
  al lado; si el caso no entra, primero hay que entender por qué.
- **No mirar la GPU para saber si lee.** Una GPU al 95% con cero lecturas es justamente el
  tercer modo de falla que el vigía aprendió a detectar (`MOTOR_ROTO_MIN=3`): contesta y
  falla todo.
- **No pedirle al lector más de una inferencia a la vez.** Ver `MAX_EN_VUELO`.
