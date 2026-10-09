# Spec Delta

## Purpose

Encontrar en el video lo que se busca sin mirar horas de grabación: describir un objeto o una persona con palabras, o mostrar una imagen, y obtener los momentos y cámaras donde aparece, como lo hacen AcuSeek y AcuSearch en los NVR que los traen.

## ADDED Requirements

### Requirement: Índice de lo que se vio
Para las cámaras elegidas, el sistema SHALL guardar cada objeto detectado con su cámara, su instante, su clase, su caja, un recorte de la imagen y un descriptor visual que permita buscarlo, con una retención configurable.

#### Scenario: Cámara indexada
- **WHEN** pasa una camioneta frente a una cámara indexada
- **THEN** queda en el índice con su recorte y su instante

#### Scenario: Retención
- **WHEN** un objeto indexado supera la retención configurada
- **THEN** se borran su recorte y su registro

### Requirement: Búsqueda por texto
El sistema SHALL buscar en el índice por una descripción en español ("camioneta blanca", "persona con mochila roja"), filtrando por cámaras y rango de tiempo, y SHALL devolver los resultados ordenados por parecido, con su recorte, cámara e instante.

#### Scenario: Camioneta blanca
- **WHEN** se busca "camioneta blanca" en las últimas 24 h
- **THEN** aparecen los recortes de camionetas blancas con cámara y hora, de más a menos parecido

### Requirement: Búsqueda por imagen
El sistema SHALL buscar en el índice objetos parecidos a una imagen dada, sea un recorte de un resultado anterior o una imagen subida.

#### Scenario: Más como este
- **WHEN** en un resultado se toca "buscar parecidos"
- **THEN** aparecen otros momentos del mismo tipo de objeto, también de otras cámaras

### Requirement: Del resultado a la grabación
Cada resultado SHALL abrir la grabación de esa cámara parada en ese instante, con la caja del objeto marcada en el recorte.

#### Scenario: Abrir resultado
- **WHEN** se toca un resultado
- **THEN** se abre el visor en Grabación en el instante del resultado

### Requirement: Objetos dejados
En las zonas marcadas para eso, el sistema SHALL avisar cuando un objeto de las clases bolso, mochila, valija o caja aparece y queda quieto más del tiempo configurado, y SHALL permitir buscar después dónde y cuándo apareció.

#### Scenario: Mochila olvidada
- **WHEN** una mochila queda quieta 10 minutos en la zona de la garita
- **THEN** se genera un aviso "objeto dejado" con su recorte y el momento en que apareció

### Requirement: Una sola búsqueda, varias fuentes
La pantalla de búsqueda SHALL consultar también los NVR con AcuSeek activado, mostrando de qué fuente vino cada resultado, y SHALL decir qué cámaras no están cubiertas por ninguna fuente.

#### Scenario: NVR con AcuSeek
- **WHEN** se busca en un rango donde hay un NVR con AcuSeek y cámaras indexadas por el detector
- **THEN** los resultados de las dos fuentes aparecen juntos, cada uno con su origen

### Requirement: Búsquedas con registro
Toda búsqueda SHALL quedar registrada con quién la hizo, qué buscó y cuándo, y sólo SHALL poder hacerla quien tenga el permiso de búsqueda.

#### Scenario: Auditoría
- **WHEN** un usuario busca "persona con campera roja"
- **THEN** la búsqueda queda en el registro con su nombre y la hora
