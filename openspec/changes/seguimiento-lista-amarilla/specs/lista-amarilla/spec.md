# Spec Delta

## Purpose

Dar seguimiento a los vehículos de la Lista Amarilla: que quien recibe el aviso sepa cuánto se la vio, que la ficha junte lo que se va sabiendo, y que cada ficha se revise cada tanto en vez de quedar olvidada.

## ADDED Requirements

### Requirement: El aviso lleva el contexto de la matrícula

Cuando una cámara lee una matrícula activa de la Lista Amarilla, el aviso SHALL incluir, además del motivo, una línea de contexto con: cuántas lecturas tuvo en los últimos 7 días (contando la actual), en cuántos días distintos, y cuándo y en qué cámara fue la lectura anterior. La línea SHALL aparecer en el aviso del Monitor LPR, en Control LPR, en el Telegram a la guardia y en los datos que reciben las reglas de Notificaciones. Las lecturas marcadas «sin vehículo» SHALL NOT contarse.

#### Scenario: Primera vez
- **WHEN** se lee una matrícula amarilla que no tiene ninguna lectura anterior
- **THEN** el contexto dice que es la primera vez que se la ve

#### Scenario: Ya pasó varias veces
- **WHEN** se lee una matrícula amarilla que tuvo 4 lecturas en 3 días distintos de la última semana, ninguna hoy, la última ayer a las 22:14 en «Portón Sur»
- **THEN** el contexto dice que es la 5.ª lectura en 7 días, en 4 días distintos, y que la anterior fue ayer a las 22:14 en «Portón Sur»

#### Scenario: Vista hace mucho
- **WHEN** la única lectura anterior es de hace más de 7 días
- **THEN** el contexto dice que es la primera lectura en 7 días y cuándo fue la anterior, con su fecha

#### Scenario: El contexto no se pudo calcular
- **WHEN** falla la consulta del contexto
- **THEN** el aviso sale igual, con el motivo y sin la línea de contexto, y la falla queda en el registro del servidor

#### Scenario: La lista negra no cambia
- **WHEN** se lee una matrícula en alerta máxima
- **THEN** su aviso es el de siempre, sin línea de contexto

### Requirement: La ficha muestra el seguimiento

La ficha de una entrada de la Lista Amarilla SHALL mostrar un resumen de su actividad, sumando todas sus matrículas: lecturas en los últimos 7 y 30 días, días con actividad en los últimos 30, primera y última vez que se la vio, la franja horaria en la que más aparece y las cámaras por las que pasa, ordenadas por cantidad. Desde la ficha SHALL poder abrirse, por cada matrícula, el cajón «Investigar» con su actividad y su recorrido, sin salir de la pantalla de Usuarios.

#### Scenario: Con actividad
- **WHEN** se abre la ficha de un vehículo amarillo con lecturas
- **THEN** se ven las cifras del resumen y las cámaras, y «Investigar» abre el recorrido de la matrícula elegida

#### Scenario: Nunca se la vio
- **WHEN** se abre una ficha cuyas matrículas no tienen ninguna lectura
- **THEN** el resumen dice que ninguna cámara la vio todavía, sin cifras en cero que parezcan datos

#### Scenario: El resumen no carga
- **WHEN** falla la lectura del resumen
- **THEN** la ficha muestra el error con un botón para reintentar, y el resto de la ficha se puede usar igual

### Requirement: Fecha de revisión

Toda entrada de la Lista Amarilla SHALL tener una fecha de revisión. Al crearse —desde la pestaña, desde la carga rápida del monitor o desde el bot— nace a 30 días, y quien administra SHALL poder renovarla por otros 30.

#### Scenario: Alta
- **WHEN** se carga un vehículo en la Lista Amarilla
- **THEN** su revisión queda a 30 días

#### Scenario: Renovar
- **WHEN** quien administra renueva una entrada
- **THEN** la revisión pasa a 30 días desde ese momento y la renovación queda en la bitácora con quién la hizo

#### Scenario: Entradas que ya existían
- **WHEN** se instala este cambio en una instancia con entradas amarillas activas
- **THEN** todas quedan con revisión a 30 días desde la instalación y ninguna aparece vencida

### Requirement: Una entrada vencida sigue avisando

Una entrada activa SHALL estar **al día**, **por vencer** (faltan 5 días o menos) o **vencida**. Vencer SHALL NOT darla de baja ni dejar de avisar: es un recordatorio para quien administra.

#### Scenario: Vence
- **WHEN** pasa la fecha de revisión de una entrada activa
- **THEN** la entrada sigue activa y una lectura de su matrícula sigue generando el aviso

### Requirement: La revisión está a la vista

La tabla de la Lista Amarilla SHALL mostrar el estado de revisión de cada entrada activa y SHALL ofrecer un filtro «Para revisar» que deja las por vencer y las vencidas.

#### Scenario: Para revisar
- **WHEN** hay una entrada al día, una por vencer y una vencida, y se elige «Para revisar»
- **THEN** quedan la por vencer y la vencida, cada una con cuánto le falta o hace cuánto venció

#### Scenario: Dada de baja
- **WHEN** una entrada está dada de baja
- **THEN** no muestra estado de revisión ni entra en «Para revisar»

### Requirement: Bitácora de la ficha

Cada ficha de la Lista Amarilla SHALL llevar una bitácora en orden cronológico. Cada asiento tiene fecha y hora, quién lo hizo y un texto. Quien puede editar la ficha SHALL poder agregar notas. El sistema SHALL asentar solo el alta, cada renovación, el paso a lista negra, la baja y la reactivación. Los asientos SHALL NOT poder editarse ni borrarse. La bitácora SHALL conservarse cuando la ficha cambia: al editarla, al darla de baja y reactivarla, y al pasarla a lista negra.

#### Scenario: Nota del operador
- **WHEN** un operador escribe «se habló con el vecino del lote 14, es el jardinero» y la guarda
- **THEN** el asiento aparece arriba de la bitácora con su nombre y la hora

#### Scenario: Nota vacía
- **WHEN** se intenta guardar una nota sin texto
- **THEN** no se guarda y se dice por qué

#### Scenario: La ficha se edita
- **WHEN** a una matrícula cargada desde el monitor se le completa el nombre y se le agrega otra matrícula desde la pestaña
- **THEN** su bitácora sigue completa en la ficha resultante

#### Scenario: Sin sesión
- **WHEN** alguien sin sesión del panel pide o escribe en la bitácora
- **THEN** recibe el rechazo y no se lee ni se escribe nada

### Requirement: Pasar a lista negra desde la ficha

La ficha de una entrada de la Lista Amarilla SHALL ofrecer pasarla a lista negra en un paso. El paso SHALL pedir la misma confirmación que cargar una ficha en alerta máxima —incluido el aviso de a quién del padrón se le va a denegar el paso— y SHALL conservar matrículas, nombre, motivo, foto y bitácora. Después del paso, la entrada SHALL dejar de estar en la Lista Amarilla y SHALL comportarse como cualquier entrada de alerta máxima.

#### Scenario: Se confirma
- **WHEN** quien administra pasa a lista negra un vehículo amarillo y confirma
- **THEN** la ficha aparece en la pestaña Lista negra con sus matrículas, motivo y bitácora, las lectoras la reciben en su lista negra, y la bitácora asienta el cambio con quién lo hizo

#### Scenario: Se cancela
- **WHEN** quien administra abre la confirmación y cancela
- **THEN** la entrada sigue en la Lista Amarilla sin ningún cambio

#### Scenario: Una lectora no la recibe
- **WHEN** el paso se confirma y una lectora no acepta la matrícula
- **THEN** el cambio de nivel queda hecho y se informa qué lectora falló, como al cargar una ficha negra

### Requirement: Sólo con la función prendida

Todo lo anterior SHALL existir únicamente con la función «Lista Amarilla» (`LPR_BUSQUEDA`) prendida. Con la función apagada no SHALL aparecer el resumen, la revisión, la bitácora ni el contexto en ningún aviso, y los datos ya guardados SHALL conservarse.

#### Scenario: Se apaga la función
- **WHEN** se apaga «Lista Amarilla» en una instancia con fichas, revisiones y bitácoras
- **THEN** nada de eso se ve ni avisa, y al volver a prenderla está todo como estaba
