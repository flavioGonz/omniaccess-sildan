# Spec Delta

## ADDED Requirements

### Requirement: Alarmas de centrales en el monitor de intrusión
Las alarmas de una central (robo, pánico, incendio, sabotaje, coacción) SHALL entrar a la Gestión de alarmas y al Monitor Intrusión como las de las cámaras de intrusión, con la central, la zona, el área y una captura de cada cámara asociada, y SHALL disparar las mismas reglas de aviso y la alerta global.

#### Scenario: Robo en una zona con cámara
- **WHEN** la central reporta robo en la zona 3, asociada a la cámara «Fondo»
- **THEN** la Gestión de alarmas muestra la alarma de la central con «Zona 3 · Fondo» y la captura de esa cámara, y el operador la gestiona (tomar, real, falsa) como cualquier otra
