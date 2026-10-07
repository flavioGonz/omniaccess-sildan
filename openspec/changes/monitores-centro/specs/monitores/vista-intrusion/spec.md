# Spec Delta

## Purpose
La vista Intrusión pone las cámaras de intrusión en la pared: calma cuando no pasa nada y una sola cosa cuando pasa. Comparte con el monitor del panel el overlay de canal en alarma, para que una alarma se vea igual en el panel y en la pared.

## ADDED Requirements

### Requirement: Mosaico de cámaras de intrusión
La vista SHALL mostrar todas las cámaras de intrusión en un mosaico que use la pantalla entera (sin barras vacías), cada una con su nombre, su línea y su zona dibujadas sobre el cuadro, el estado de armado de cada regla (armada / desarmada ahora) y la última detección con "hace cuánto".

#### Scenario: Cuatro cámaras en 16:9
- **WHEN** hay cuatro cámaras de intrusión y la pantalla es 16:9
- **THEN** se ven en 2×2 ocupando todo el alto disponible debajo del encabezado

### Requirement: Alarma pendiente o confirmada
Cuando una cámara tiene una alarma pendiente o confirmada, su canal SHALL mostrar el mismo overlay rojo animado del monitor del panel (INTRUSIÓN DETECTADA / CONFIRMADA, tipo de evento, hace cuánto) sin botones de acción, y SHALL crecer hasta ocupar al menos la mitad de la pantalla mientras las demás se reordenan al costado. Con varias en alarma, la más reciente ocupa el lugar grande.

#### Scenario: Llega un cruce de línea
- **WHEN** llega una detección de cruce de línea de Perimetral 22
- **THEN** antes de 1 s el canal de Perimetral 22 toma el overlay rojo y pasa al lugar grande; cuando la alarma se acepta o resuelve en el panel, vuelve a su lugar

### Requirement: Franja de últimas detecciones
La vista SHALL mostrar una franja con las últimas 12 detecciones (foto, cámara, tipo, hora, estado: pendiente / real / falsa) que se actualiza en vivo.

#### Scenario: Detección clasificada como falsa
- **WHEN** en el panel una detección se marca como falsa
- **THEN** en la franja esa detección pasa a "Falsa" sin recargar

### Requirement: Sonido configurable
La vista SHALL poder emitir un tono al llegar una alarma, configurable por vista desde Monitores (apagado / una vez / repetir hasta que se acepte) y silenciable desde la propia pantalla. Si el navegador bloquea el audio hasta un gesto, la vista MUST indicarlo ("tocá la pantalla para habilitar el sonido") en vez de callar sin aviso.

#### Scenario: Audio bloqueado
- **WHEN** la vista se abre y el navegador no permite audio sin gesto
- **THEN** aparece un aviso discreto y, tras el primer clic, el aviso desaparece y el sonido queda habilitado
