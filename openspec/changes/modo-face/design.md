# Design

## Contexto medido

Antes de diseñar, los números del 4/11 en el servidor (regla del motor: primero el número):

- Corriendo: `omni-lpr` (matrículas) y `omni-vision` (analíticas, relectura, intrusión). No hay motor de rostros.
- `AccessEvent`: 73k eventos, todos `PLATE`; 0 `FACE`. `User.cara`: 1 cargada.
- `ObjetoVisto` + `HuellaObjeto`: 73k objetos con huella en 7 días — la búsqueda de parecidos de OmniVision ya compara vectores por lotes **sin índice vectorial** y anda bien. Ese es el patrón a copiar para rostros.

La conclusión de diseño sale de ahí: **el reconocimiento facial es la búsqueda de parecidos de OmniVision aplicada a caras**, con un padrón fijo (los rostros enrolados) en vez del registro de todo lo visto.

## La cadena

```
cámara facial (RTSP) → OmniVision detecta persona → recorta el rostro →
omni-face: huella del rostro → comparar contra HuellaRostro (padrón enrolado) →
¿mejor coseno ≥ umbral? → sí: AccessEvent(FACE, userId, confianza, foto)
                          → no: AccessEvent(FACE, desconocido)
```

Cada flecha puede romperse sola y se mide igual que la cadena de matrículas (cuadros sanos, ráfagas, GPU viva, motor en GPU). El reconocimiento reusa la detección de persona que OmniVision ya hace para siluetas/intrusión; lo nuevo es el recorte de rostro y la huella.

## Decisiones

### El motor `omni-face` es análogo a `omni-lpr`, no parte de `omni-vision`

Se separa en su propio contenedor por la misma razón que el lector de matrículas: aísla el modelo y su memoria de GPU, se recrea sin tocar `omni-vision`, y su concurrencia se topea aparte (`MAX_EN_VUELO`, que en matrículas tuvo que bajar a 1 porque la concurrencia envenenaba el contexto CUDA). Config capturada a mano como `omni-lpr` (imagen, `--gpus all`, volumen de modelos, `restart: unless-stopped`), documentada para poder recrearlo —nunca `systemctl restart docker`.

Modelo a elegir en implementación según la GPU: una familia tipo ArcFace/InsightFace (detección + embedding de 512 dim). El embedding se guarda cuantizado a int8 + escala, como `HuellaObjeto`, para comparar por lotes.

### La comparación reusa el patrón de `vision-parecidos`, no un índice vectorial

`HuellaObjeto` ya se compara por coseno sobre lotes sin pgvector y rinde en 73k vectores. El padrón de rostros es mucho más chico (los usuarios enrolados, no todo lo visto), así que la comparación es barata. Se reusa `deInt8`/`comparar` de `lib/vision-parecidos`. Si el padrón creciera a miles, se evalúa un índice; hoy no hace falta.

### Datos

- `HuellaRostro { id, userId, foto, vector (bytes int8), escala, calidad, creadoEn }` — una por foto de cara enrolada. `userId` indexado.
- `AccessEvent` **no cambia de forma**: ya tiene `accessType` (`FACE`), `userId`, `decision`, `snapshotPath`, `details`. El acceso facial escribe ahí, con la confianza en `details` como ya hace LPR.
- Tipo de dispositivo: `FACE_CAMERA` nuevo, o un flag `modoFacial` sobre una cámara. Se decide por cómo encaja con `lib/modo-camara.ts` (que ya distingue modos de cámara); preferible un modo, para no multiplicar tipos.

### Umbral y «desconocido»

El umbral de coseno es una constante con nombre y comentario (como los de `franja.ts`), configurable en Ajustes. Por debajo, **no hay identidad**: el acceso queda desconocido. Nunca se asigna el “más parecido” sin pasar el umbral —el error de identidad es caro—. La franja dudosa (apenas por debajo) no inventa identidad; la resuelve una persona mirando la foto, con el mismo botón de corrección manual que ya existe para matrículas (`PlateManualButton` tiene su espejo para rostros).

### Doble verificación

Espejo de la relectura de matrículas: si la cámara facial ya trae un match (una terminal), OmniVision puede re-identificar el rostro del recorte y marcar si coincide —el mismo criterio de `verificacion-lpr` (coincide/difiere), reusando `MarcaVerificacion`.

## Privacidad

Las fotos de cara y las huellas de rostro son datos sensibles. Van detrás de un permiso propio, no se versionan, no salen al navegador salvo en la ficha del usuario (donde ya se muestra `cara`). El enrolamiento es explícito (un operador carga la foto); no se enrola a nadie automáticamente desde el video.

## Lo que NO se hace en este change

- No se tocan las terminales faciales Hikvision (`FACE_TERMINAL`): ya escriben FACE por hardware.
- No se agrega lista de vigilancia por rostro: alcanza el rol del usuario (BLACKLISTED/WHITELISTED) que el padrón ya usa.
- No se decide el modelo exacto ni se compila nada: esto es planificación.
