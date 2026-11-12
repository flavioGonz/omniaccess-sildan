# Proposal

## Why

En OmniVision › Entrenar › Objetos, las fotos de las cámaras entran de a una: se elige la cámara y se toca «Sacar foto ahora». La misma pantalla recomienda que 70 de cada 100 fotos sean de las cámaras donde va a correr el modelo, «de día y de noche, mañana, tarde, lluvia» — y eso hoy exige que alguien esté sentado tocando el botón a las tres de la mañana. Nico (12/11): «podemos dejar una forma de sacar capturas de las escenas cada x tiempo, para entrenar los objetos también con las escenas actuales?».

Lo que falta es que el conjunto se junte solo, y que lo haga sin llenarse de la misma foto: una cámara fija cada cinco minutos entrega cientos de cuadros iguales, que no enseñan nada y entierran la cola de «Sin dibujar».

## What Changes

- **Programar capturas.** En la pantalla de Objetos, junto a «Sacar foto ahora», una programación: qué cámaras (equipos y canales de NVR, las mismas del selector de hoy), cada cuánto (de 5 minutos a 24 horas), en qué franja horaria si se quiere (por ejemplo sólo de noche) y hasta cuándo. Puede haber varias a la vez.
- **Las fotos entran a «Sin dibujar»** como fotos de cámara, con el cuadro del stream principal igual que la captura a mano, y marcadas como tomadas por una programación. Cuentan como «de cámaras» en la mezcla del conjunto.
- **No guarda repetidas.** Si la escena no cambió respecto de la última foto guardada de esa cámara, el cuadro se saltea y se cuenta como salteado. El cambio de luz (día a noche) sí es un cambio.
- **Se frena sola.** Cada programación termina al llegar a su tope de fotos o a su fecha; y todas esperan cuando la cola de «Sin dibujar» pasa de un máximo, y siguen cuando se dibuja o se descarta. Nunca borra nada por su cuenta.
- **Se ve qué está haciendo.** Por programación: cuándo es la próxima, cuántas guardó, cuántas salteó por repetidas, y qué cámaras no están dando cuadro y por qué. Se puede pausar, reanudar, editar, borrar y pedir una vuelta ya.
- **Descartar en bloque.** Las fotos de una programación que quedaron sin dibujar se pueden descartar juntas (con confirmación); las ya dibujadas no se tocan. Borrar la programación no borra sus fotos.

No hay cambios **BREAKING**: «Sacar foto ahora», subir, pegar y traer del registro siguen igual.

## Capabilities

### New Capabilities

- `capturas-programadas`: tomar solas, cada cierto tiempo, fotos de las cámaras para el conjunto de entrenamiento del detector propio — qué se programa, qué se guarda y qué se saltea, cuándo se frena y qué se muestra.

### Modified Capabilities

Ninguna. `openspec/specs/` está vacío y ningún cambio abierto define el conjunto de entrenamiento.

## Impact

- **Base:** migración aditiva — tabla nueva `CapturaProgramada` y una columna opcional en `FotoEntrenamiento` que dice de qué programación salió. Sin borrar ni renombrar nada.
- **Proceso de visión (`vision-worker`):** un reloj nuevo (`vision-capturas.js`, al lado de `vision-zonas.js`) que una vez por minuto mira qué programación toca. No usa la GPU.
- **Aplicación:** la toma del cuadro de una cámara sale de `api/vision/objetos/fotos` a una función compartida; rutas nuevas para las programaciones y una ruta interna (token interno) que el reloj llama para tomar una vuelta. `src/lib/permisos-api.ts` clasifica las rutas nuevas.
- **Pantalla:** `SoltarFotos` (donde está «Sacar foto ahora») suma el acceso; componente nuevo para la lista y el formulario de programaciones; la foto en «Sin dibujar» dice que es programada.
- **go2rtc y grabadores:** cada foto abre el stream principal de una cámara por unos segundos, de a una cámara por vez. Con el mínimo de 5 minutos, veinte cámaras son como mucho cuatro aperturas por minuto.
- **Disco:** cada foto pesa entre 300 y 600 KB (lado mayor 1920, como hoy). Con los topes por defecto, una programación ocupa unos 100 MB como máximo.
- **Instancias:** se desarrolla y valida en el lab. A San Nicolás pasa cuando Nico lo diga.
