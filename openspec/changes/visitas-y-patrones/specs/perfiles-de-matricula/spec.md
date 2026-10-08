# Spec Delta

## Purpose

Resume el comportamiento de cada matrícula a partir de sus lecturas —cada cuánto viene, cuánto se queda, a qué hora y qué días— para que la guardia sepa si lo que ve es habitual o no, y para que los avisos se basen en patrones y no en lecturas sueltas.

## ADDED Requirements

### Requirement: Perfil por matrícula
El sistema SHALL mantener para cada matrícula leída un perfil con primera y última vez, días distintos vistos, lecturas de entrada y de salida, y permanencia habitual (mediana y percentil 90 de sus visitas con entrada y salida leídas). El perfil MUST recalcularse al menos cada 15 minutos sin bloquear el procesamiento de lecturas.

#### Scenario: Habitual con salidas leídas
- **WHEN** una matrícula tiene 6 visitas con entrada y salida leídas de entre 7 y 9 horas
- **THEN** su perfil muestra una permanencia habitual cercana a 8 h y un p90 de alrededor de 9 h

### Requirement: Tránsito de calle separado
Una matrícula vista sólo por cámaras de salida y nunca por una de entrada SHALL marcarse como "pasa por la calle" y MUST NOT contar para rutinas, permanencias ni avisos de permanencia.

#### Scenario: Ómnibus que pasa todos los días
- **WHEN** una matrícula se lee 40 veces en Salida y ninguna en Entrada
- **THEN** su perfil dice "pasa por la calle" y no aparece como habitual con rutina

### Requirement: Rutina detectada
El sistema SHALL detectar una rutina cuando una matrícula entra al barrio en al menos N días distintos (por defecto 4) con una variación de la hora de llegada menor a M minutos (por defecto 30), y MUST describirla con los días de la semana, la hora típica, la variación y la permanencia habitual.

#### Scenario: Llegada de lunes a viernes
- **WHEN** una matrícula entró lunes a viernes durante dos semanas entre las 06:48 y las 06:53
- **THEN** su rutina se describe "lun a vie · 06:50 ±2 min" con su permanencia habitual

### Requirement: Clase de la matrícula
Cada perfil SHALL tener una clase: Residente (está en el padrón), Habitual con rutina, Frecuente (4 o más días sin rutina), Ocasional (2 a 3 días) o Primera vez.

#### Scenario: Primera lectura
- **WHEN** se lee por primera vez una matrícula que no está en el padrón
- **THEN** su clase es Primera vez

### Requirement: Perfil visible en la ficha
La ficha de una lectura en el monitor y en el panel SHALL mostrar el perfil de la matrícula: clase, días vistos, frecuencia, permanencia habitual y la rutina dibujada como una franja de días de la semana por horas del día.

#### Scenario: Ficha de un habitual
- **WHEN** el operador abre la ficha de una lectura de una matrícula con rutina
- **THEN** ve "Habitual con rutina", cuántos días vino, su permanencia típica y la franja con sus llegadas marcadas
