# Spec Delta

## Purpose

Que OmniAccess reconozca rostros con sus propias cámaras de video —como ya lee matrículas— y escriba el acceso con la persona identificada, sin depender de una terminal facial por puerta. El reconocimiento compara el rostro detectado contra un padrón de huellas de caras enroladas; por debajo del umbral no hay identidad.

## ADDED Requirements

### Requirement: Motor de huellas de rostro

OmniAccess SHALL correr un motor de rostros (`omni-face`) como contenedor anexo, que dado un recorte de imagen con una cara devuelve su **huella** (un vector) y la calidad de la detección. El motor SHALL compartir la GPU con `omni-lpr` y `omni-vision` con un tope de inferencias en vuelo configurable, para no competir con la lectura de matrículas. El motor no decide identidad: sólo calcula la huella.

#### Scenario: Huella de un rostro
- **WHEN** se le manda al motor un recorte con una cara nítida
- **THEN** devuelve el vector de la huella y una calidad por encima del piso

#### Scenario: Sin cara utilizable
- **WHEN** el recorte no tiene una cara, o está demasiado chica o borrosa
- **THEN** no devuelve huella y lo dice (no se inventa un vector)

#### Scenario: Presupuesto de GPU
- **WHEN** hay más pedidos que el tope de inferencias en vuelo
- **THEN** se encolan y el motor nunca corre más que el tope a la vez

### Requirement: Enrolamiento de rostros de un usuario

A un `User` se le SHALL poder cargar una o varias fotos de cara. De cada foto se SHALL guardar su huella (`HuellaRostro`) junto a la foto. Cargar y borrar fotos de cara SHALL pedir un permiso propio. Las huellas y las fotos de cara son datos sensibles y SHALL NO salir del servidor salvo en la ficha del usuario, donde ya se muestran.

#### Scenario: Cargar una cara
- **WHEN** un usuario con el permiso carga una foto de cara nítida de un residente
- **THEN** se guarda la foto y su huella, y el residente pasa a ser reconocible

#### Scenario: Foto sin cara
- **WHEN** la foto no tiene una cara utilizable
- **THEN** no se enrola y se dice por qué

#### Scenario: Sin permiso
- **WHEN** un usuario sin el permiso intenta cargar o borrar una cara
- **THEN** recibe el rechazo con el permiso que falta y el padrón no cambia

### Requirement: Reconocimiento sobre cámaras de video

Una cámara marcada como facial (tipo `FACE_CAMERA` o una cámara con modo facial) SHALL ser analizada por OmniVision: cuando detecta una persona, le saca el rostro, calcula su huella y la compara contra el padrón de huellas enroladas. Si la mejor coincidencia supera el **umbral** (configurable), SHALL escribir un `AccessEvent` de tipo `FACE` con el `userId` reconocido, la confianza y la foto del momento. Por debajo del umbral, el acceso SHALL quedar como persona **desconocida**, sin `userId`.

#### Scenario: Rostro reconocido
- **WHEN** una cámara facial ve a un residente enrolado y la coincidencia supera el umbral
- **THEN** se escribe un acceso `FACE` con su `userId`, la confianza y la foto, y el Monitor Face lo muestra con su nombre y Lote

#### Scenario: Rostro no reconocido
- **WHEN** la cara detectada no coincide con nadie por encima del umbral
- **THEN** el acceso queda como desconocido (sin `userId`) y no se le asigna una identidad

#### Scenario: Dudoso cerca del umbral
- **WHEN** la coincidencia está apenas por debajo del umbral
- **THEN** no se asigna identidad automáticamente; el acceso queda desconocido (lo puede resolver una persona mirando la foto)

### Requirement: Reuso del acceso facial en todo lo existente

Un acceso `FACE` reconocido SHALL comportarse como cualquier acceso en el resto del sistema, sin lógica aparte: la permanencia se calcula por `userId`, el padrón lo clasifica por el rol del usuario (residente/VIP/lista negra) y el Monitor y el cajón Investigar lo muestran. En Investigar, el recorrido de una persona SHALL armarse por `userId` (sus pasadas), con el mismo grafo tipo git y el mismo calendario de actividad que la matrícula.

#### Scenario: Persona en lista negra
- **WHEN** se reconoce por rostro a una persona cuyo usuario está en lista negra
- **THEN** el acceso sale resaltado y a la pila de avisos, igual que una matrícula en lista negra

#### Scenario: Investigar una persona
- **WHEN** se investiga un acceso facial
- **THEN** el cajón muestra el recorrido de esa persona (sus accesos por `userId`), su comportamiento y las detecciones relacionadas, como con una matrícula
