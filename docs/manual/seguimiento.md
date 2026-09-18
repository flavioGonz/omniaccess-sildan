# Qué es el seguimiento

Las cámaras de entrada y salida leen la matrícula ellas mismas y abren la barrera. Dentro del
barrio no hay nada de eso: hay cámaras comunes, que ven pero no leen.

El seguimiento las convierte en lectores. Un contenedor llamado **Omni-LPR**, que corre sobre la
placa de video del servidor, recibe cuadros de esas cámaras por RTSP, encuentra la matrícula y la
registra. Con eso el sistema puede dibujar por dónde anduvo un vehículo adentro del barrio.

> Todo esto corre por fuera del camino de la barrera. Si el contenedor se cae, si la placa se
> satura o si una cámara deja de responder, el control de acceso sigue funcionando igual. El
> seguimiento es información, no decisión.

## Las dos clases de cámara

| | Cámara LPR | Cámara Interior |
|---|---|---|
| Para qué | entrada y salida | seguimiento adentro |
| Quién lee la matrícula | la cámara, de fábrica | el contenedor Omni-LPR |
| Cómo llega el dato | la cámara avisa por red | la pasarela le saca cuadros |
| Abre barrera | sí | no |
| Qué deja registrado | un acceso y un avistamiento | solo un avistamiento |

Esa diferencia explica por qué los avistamientos no aparecen mezclados con los accesos: una
lectura interior no decide nada, y ponerla entre las entradas y salidas falsearía el registro.
Tienen su propia vista en el historial.

# Cómo funciona por dentro

Conviene entenderlo porque casi todos los problemas de lectura se resuelven en uno de estos
cuatro pasos.

## 1. Alguien decide cuándo leer

Leer todos los cuadros todo el tiempo no se puede: son veinticinco por segundo y por cámara.
Hace falta algo que diga *ahora*. Hay tres formas, y cuál se puede usar depende de la cámara.

### Cámaras con analítica propia (AcuSense y similares)

Distinguen una persona de un auto dentro del propio equipo. Se les configura una regla con
objetivo *vehículo* y el sistema se queda escuchando su flujo de avisos. La placa de video queda
en reposo hasta que pasa un auto de verdad.

| Modo | Cómo dispara | Cuándo conviene |
|---|---|---|
| **Al cruzar una línea** | En el instante en que un vehículo cruza una raya dibujada sobre el cuadro | **La mejor para una calle.** La lectura queda centrada en el paso, y un auto estacionado dentro del encuadre deja de disparar |
| **Al entrar en una zona** | Mientras haya un vehículo dentro del área marcada | Para un sector entero: una playa de estacionamiento, una rotonda. Ojo: un auto quieto adentro vuelve a disparar |

### Cámaras que solo entregan RTSP

Son la mayoría de las cámaras comunes, y las que van a aparecer cuando se sumen equipos de otras
marcas o más viejos. No tienen analítica: dan video y nada más.

| Modo | Cómo dispara | Qué implica |
|---|---|---|
| **Por cambio de imagen** | Lo decide el servidor mirando si la imagen cambió respecto del cuadro anterior | Funciona con **cualquier** cámara. A cambio trabaja más, y se despierta también con una sombra, una rama o un peatón |

No es un modo de segunda: es el modo pensado para ese caso, y anda. Pero exige más cuidado en dos
cosas, porque no hay nadie filtrando antes:

- **La zona de interés tiene que ser ajustada.** Todo lo que quede adentro puede despertarlo.
- **La sensibilidad de escena hay que buscarla.** Muy baja, se dispara con cualquier cosa; muy
  alta, se pierde un auto rápido.

> El calibrador ya sabe cuál de los tres puede usar cada cámara: los modos que el equipo no
> soporta aparecen apagados y dicen por qué. No hay que averiguarlo a mano.

> Si una cámara con analítica deja de avisar durante quince minutos, el sistema vuelve solo al
> cambio de imagen y lo deja anotado. Prefiere seguir leyendo algo antes que quedarse mudo.

## 2. Se recorta la zona de interés

La cámara entrega un cuadro grande, y casi siempre la mitad es pared, vereda o cielo. La **zona
de interés** marca por dónde pasan los autos, y el sistema recorta ahí antes de leer.

Esto es lo que más mueve la aguja, y por dos motivos a la vez: la matrícula llega con más
detalle, y ocupa una porción mayor de lo que el lector mira. Los dos suman.

## 3. El lector mira el recorte, no el cuadro entero

Acá hay algo que conviene entender porque va contra la intuición. El lector **achica cualquier
imagen** a un tamaño fijo antes de buscar la matrícula. Entonces lo que decide si la ve no son
los píxeles de la foto, sino qué porción del encuadre ocupa la chapa.

Mandarle una panorámica de la calle entera, por más resolución que tenga, es peor que mandarle
pedazos. Medido sobre el mismo cuadro, con un auto cuya patente se lee perfecto a ojo:

| Lo que se le manda | Resultado |
|---|---|
| la calle entera, 1600 × 670 | no ve nada |
| la mitad izquierda, 720 × 468 | la lee, 87% |
| recortado al auto, 352 × 234 | la lee, 91% |

Por eso el sistema parte el cuadro en pedazos con un poco de solape y lee cada uno por separado.
Y por eso **cerrar la zona de interés ayuda dos veces**: la matrícula llega con más detalle, y
ocupa más de lo que el lector mira.

## 4. Se juntan varios cuadros, no uno

Una lectura suelta es una apuesta. Cada aviso abre una **ráfaga**: se juntan varios cuadros,
incluidos los de justo antes del aviso —que suelen ser los mejores, porque el vehículo recién
entra en cuadro— y se leen todos.

Después se vota carácter por carácter. Si tres cuadros dicen `SCV4478` y uno dice `SCV447B`, gana
el 8. Eso es lo que corrige las confusiones típicas del lector: el 0 con la O, el 8 con la B.

Una lectura se da por buena si coinciden **al menos dos cuadros**, o si una sola viene muy
segura. Lo que aparece una vez y no se repite se descarta: casi siempre es un invento.

## 5. Se guarda un avistamiento, y se arma el trayecto

Del paso entero queda **un** registro, no uno por cuadro. Los avistamientos de la misma matrícula
cercanos en el tiempo se agrupan en un trayecto, que es lo que el mapa dibuja.

# Dar de alta una cámara interior

» Dispositivos LPR → Nuevo → tipo **Cámara Interior (seguimiento)**

## Paso 1 · La URL del canal

Cada cámara, o cada canal del grabador, es un dispositivo aparte. Siempre el flujo principal.

| Marca | Cómo se arma |
|---|---|
| Hikvision y NVR | `rtsp://usuario:clave@IP:554/Streaming/Channels/101` |
| Dahua | `rtsp://usuario:clave@IP:554/cam/realmonitor?channel=1&subtype=0` |

En Hikvision, `101` es el canal 1 en flujo principal y `201` el canal 2. El segundo dígito es el
flujo: 1 principal, 2 secundario.

> ⚠ Si la clave tiene paréntesis, arroba o signos raros, hay que escribirlos codificados o la
> cámara rechaza la conexión. El sistema lo hace solo al guardar; si armás la URL a mano, tenelo
> en cuenta.

## Paso 2 · Probarla

El botón **Probar** saca un cuadro real y te dice si el lector ve la matrícula. Es la forma más
rápida de saber si la cámara sirve para esto antes de seguir configurando.

Que no lea en la prueba no siempre es un problema: si no pasaba ningún auto, no hay nada que
leer. Probá de nuevo con un vehículo en el encuadre.

## Paso 3 · Calibrarla

» Dispositivos LPR → la cámara → **Calibrar**

| Ajuste | Qué hace | Cuándo tocarlo |
|---|---|---|
| Zona de interés | Marca por dónde pasan los autos | Siempre. Es el ajuste que más rinde |
| Línea de pasada | La raya que el auto cruza al pasar | Si la cámara la soporta, es el mejor disparo |
| Quién decide cuándo leer | Línea, zona o cambio de imagen | La primera que la cámara permita |
| Confianza mínima | Por debajo de eso la lectura se descarta | Subilo si aparecen matrículas inventadas |
| Sensibilidad de escena | Cuánto tiene que cambiar la imagen | Solo en modo escena |
| Cuadros por segundo | Ritmo de muestreo | Rara vez |

La zona de interés se dibuja sobre un cuadro en vivo de la cámara. Dejá afuera la vereda, la
pared y el cielo: lo que quede adentro es lo único que el lector va a mirar.

## Paso 4 · Ubicarla en el mapa

» Mapa → arrastrar la cámara hasta donde está instalada

Sin esto el recorrido no se puede dibujar: el sistema sabe qué cámara vio la matrícula, pero no
dónde está esa cámara.

# Mirar cómo viene funcionando

» Configuración → Avanzado → **Omni-LPR · Seguimiento**

## Lo primero que hay que mirar

| Dato | Qué significa | Qué hacer si está mal |
|---|---|---|
| **Lector: GPU / CPU** | Si está usando la placa de video o cayó al procesador | En CPU va veinte veces más lento. Reiniciar el lector |
| **Pasarela** | Cuántas cámaras están enganchadas y cómo disparan | Si dice 0, revisar que las cámaras estén activas |
| **Lecturas** | Cuántas matrículas se registraron en el período | Si es 0 con tránsito, mirar la efectividad |
| **Efectividad** | De cada cien disparos, cuántos terminaron en una lectura | Debajo del 30% la zona está mal puesta |

La efectividad es la medida honesta. Muchos disparos y pocas lecturas quiere decir que el sistema
se está despertando para nada: o la zona abarca de más, o la cámara mira donde las matrículas
quedan de costado.

## Rendimiento

Las cuatro líneas muestran cómo vino trabajando el equipo, no cómo está justo ahora. Que la placa
esté al 10% en este instante no dice nada; que haya estado al 90% durante una hora, sí.

- **GPU** — debería estar baja y con picos cortos. Alta y sostenida quiere decir demasiadas
  cámaras o zonas demasiado abiertas.
- **CPU del lector** — si sube mientras la GPU queda en cero, el lector cayó al procesador.
- **Memoria** — plana. Si crece sin parar durante días, avisá.
- **Temperatura** — en rango normal, bien por debajo del límite de la placa.

## Lecturas por hora

El gráfico de barras dice cuándo hubo movimiento. Sirve para dos cosas: confirmar que las horas
de más tránsito tienen más lecturas, y notar un hueco raro —una cámara que se cayó a las tres de
la mañana se ve enseguida.

Debajo está el par que importa: cuántas se aceptaron y cuántas se descartaron por no coincidir
entre cuadros. Descartes altos no son necesariamente malos; significa que el filtro está
trabajando y no dejando pasar inventos.

# Cuando algo no anda

| Síntoma | Causa habitual | Qué hacer |
|---|---|---|
| El lector dice CPU | El contenedor arrancó sin ver la placa | Reiniciar el lector; si sigue, es la instalación del contenedor |
| 0 cámaras enganchadas | Ninguna cámara interior activa, o el seguimiento apagado | Modos → LPR, y revisar las cámaras en Dispositivos LPR |
| Dispara mucho, lee poco | Zona demasiado abierta, o mal ángulo | Cerrar la zona en el calibrador |
| No dispara nunca | La regla de la cámara quedó apagada | En el calibrador, volver a aplicar *avisa la cámara* |
| Lee una matrícula parecida | El lector confunde caracteres a esa distancia | Cerrar la zona, o acercar la cámara. Contrastar con un auto de patente conocida |
| Un auto estacionado se relee | Está adentro de la zona y entra en cada ráfaga | Correr la zona para dejarlo afuera |

## Encender y apagar todo el seguimiento

» Configuración → Modos → LPR

Es un interruptor. Apagado, no corre nada: ni el lector ni la pasarela, y el control de acceso
queda exactamente igual. Sirve para descartarlo cuando se está diagnosticando otra cosa.


# El lector por dentro

No hace falta para operar, pero sirve cuando algo no cierra.

El lector es un contenedor llamado **Omni-LPR** que corre sobre la placa de video. Habla dos
idiomas: una API REST, que es la que usa el sistema, y **MCP**, que permite que un asistente de
IA le consulte directamente. La documentación viva de su API está en `/api/v1/apidoc/swagger`
sobre el puerto del contenedor.

## Los modelos

Trabaja en dos etapas, y cada una tiene su modelo. Se pueden cambiar sin tocar el contenedor.

| Etapa | Qué hace | Opciones |
|---|---|---|
| Detector | Encuentra dónde está la chapa | Seis tamaños, de 256 a 640 píxeles de entrada |
| OCR | Lee los caracteres de la chapa ya recortada | Dos: uno chico y rápido, uno grande y preciso |

El detector que trae por defecto es el de **384 píxeles**, el más chico. Eso explica por qué una
imagen amplia no devolvía nada: todo se achica a ese tamaño antes de buscar. Medido sobre el
mismo cuadro:

| Detector | Resultado |
|---|---|
| 384 (el de fábrica) | no encuentra nada |
| 512 | la encuentra, 41% |
| 640 | la encuentra, 68% |

La diferencia de tiempo entre el de 384 y el de 640, una vez cargado, es de 15 a 24 milésimas.
No hay motivo para usar el chico, así que el sistema usa el de 640.

## La lectura en dos pasos

El detector devuelve además **el recuadro** donde está la chapa. Con eso el sistema hace algo
más: recorta la matrícula sola y la vuelve a leer con el modelo de OCR grande. Leer una imagen
de cincuenta por veinticinco píxeles con el modelo bueno cuesta casi nada, y es justo donde se
decide si dice B o D.

> ⚠ Ninguna de estas dos mejoras arregla un caso: si la matrícula se ve mal en **todos** los
> cuadros, todos se van a equivocar igual y la votación no lo puede saber. Antes de dar por buena
> la tasa de acierto de una cámara, conviene contrastarla contra un vehículo de patente conocida.
