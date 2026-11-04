# Tasks

## 1. Medir el presupuesto de GPU antes de sumar un motor

- [ ] 1.1 Medir en el lab cuánto deja libre la GPU con `omni-lpr` y `omni-vision` corriendo (`nvidia-smi`: uso, memoria), bajo carga real de matrículas. Es el número que decide si `omni-face` entra con qué tope.
  - Verificación: una planilla con uso/memoria/temperatura de la GPU en reposo y en pico, y el margen que queda.
- [ ] 1.2 Elegir el modelo de rostro (familia ArcFace/InsightFace) que entre en ese margen, con detección + embedding. Dejar escrito dim del embedding y memoria que ocupa.
  - Verificación: el modelo corre en una prueba aislada en la GPU del lab y mide latencia por rostro.

## 2. El contenedor `omni-face`

- [ ] 2.1 Armar `omni-face` (imagen con el modelo, `--gpus all`, volumen de modelos, `EXECUTION_DEVICE=cuda`, `restart: unless-stopped`, puerto local). Capturar su config a mano y documentarla, como `omni-lpr` (sin compose).
  - Verificación: `docker inspect omni-face` muestra `healthy`; `POST /huella` con un recorte de cara devuelve el vector; con un recorte sin cara, lo rechaza.
- [ ] 2.2 Tope de inferencias en vuelo (`MAX_EN_VUELO`) y encolado, como el lector de matrículas. Arrancar en 1 y subir sólo si la medición lo permite.
  - Verificación: con N pedidos simultáneos, nunca corre más que el tope (medido en el log del contenedor).

## 3. Enrolamiento

- [ ] 3.1 Modelo `HuellaRostro` y migración aditiva (`prisma migrate deploy`; sólo `//` en el schema). `userId` indexado.
  - Verificación: la migración corre en el lab y `prisma.huellaRostro.count()` da 0.
- [ ] 3.2 Permiso propio de enrolamiento y endpoints para cargar/borrar fotos de cara de un usuario; de cada foto se guarda la huella (`omni-face`) y la foto. Rechazo con el permiso que falta.
  - Verificación: con permiso, cargar una foto nítida enrola y deja la huella; una foto sin cara se rechaza; sin permiso, 403.
- [ ] 3.3 En la ficha del usuario, cargar/ver/borrar sus caras enroladas (donde ya se muestra `cara`), sin exponer huellas al navegador.
  - Verificación: en el lab, enrolar a un residente de prueba y verlo en su ficha.

## 4. Reconocimiento sobre cámaras de video

- [ ] 4.1 Un modo facial de cámara (sobre `lib/modo-camara.ts`) o el tipo `FACE_CAMERA`. Decidir por cuál y dejarlo escrito.
  - Verificación: una cámara del lab queda marcada como facial y aparece como tal en Dispositivos.
- [ ] 4.2 En el worker de OmniVision: al detectar persona en una cámara facial, recortar el rostro, pedir la huella a `omni-face` y compararla contra `HuellaRostro` (reusando `deInt8`/`comparar` de `lib/vision-parecidos`).
  - Verificación: con un residente enrolado frente a la cámara del lab, el log muestra el match y el coseno.
- [ ] 4.3 Escribir el `AccessEvent` `FACE`: con `userId` y confianza si pasa el umbral, desconocido si no. El umbral, constante con nombre y comentario, configurable en Ajustes.
  - Verificación: en el lab, un enrolado genera un acceso FACE con su `userId`; un desconocido, uno sin `userId`. Subir y bajar el umbral cambia el límite como se espera.

## 5. Que encaje con lo existente (sin lógica aparte)

- [ ] 5.1 Confirmar que el acceso FACE cae solo en el Monitor Face (`monitor-face`), con el Lote y nombre grandes y centrados, sin tocar la vista.
  - Verificación: en el lab, un acceso FACE reconocido se ve en `/monitor/face` con nombre y Lote.
- [ ] 5.2 El cajón Investigar por persona: el recorrido de un acceso FACE se arma por `userId` (sus pasadas), con el mismo grafo tipo git, calendario y comportamiento que una matrícula.
  - Verificación: investigar un acceso FACE muestra el recorrido de esa persona, no de una chapa.
- [ ] 5.3 Lista negra/VIP por rol: una persona reconocida cuyo usuario está en lista negra sale resaltada y a la pila de avisos, igual que una matrícula.
  - Verificación: enrolar a un usuario en lista negra y confirmar el resaltado y el aviso.
- [ ] 5.4 Corrección manual del espejo de `PlateManualButton` para un acceso FACE desconocido o mal asignado (confirmar/cambiar la persona), re-evaluando el acceso.
  - Verificación: corregir a mano un acceso FACE desconocido lo asocia al usuario y re-evalúa.

## 6. Doble verificación (si hay terminal)

- [ ] 6.1 Cuando una terminal ya trae match, OmniVision re-identifica el rostro del recorte y marca coincide/difiere, reusando `MarcaVerificacion` (espejo de la relectura de matrículas).
  - Verificación: con una terminal y OmniVision mirando la misma puerta, un match coincidente marca «verificado» y uno distinto, la diferencia.

## 7. Privacidad y verificación final

- [ ] 7.1 Confirmar que huellas y fotos de cara no se versionan, no salen al navegador salvo la ficha del usuario, y están detrás del permiso.
  - Verificación: revisar que ninguna ruta devuelve la huella; `git status` no trae fotos ni modelos.
- [ ] 7.2 `npx tsc --noEmit` y `npm run build` limpios; medir la GPU con el motor corriendo bajo carga de matrículas y confirmar que la lectura de matrículas no se degrada.
  - Verificación: la tasa de lecturas de matrículas antes y después de prender `omni-face` es equivalente (medido, no supuesto).
