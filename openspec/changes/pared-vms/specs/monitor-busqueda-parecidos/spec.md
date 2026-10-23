# Spec Delta

## Purpose

Que el operario de una pared de video pueda buscar en el registro de OmniVision lo que se parece a algo que está viendo en un canal o a una foto que le mandan al celular, sin dejar la pared ni entrar al panel.

## ADDED Requirements

### Requirement: Se elige primero qué se busca

La pared de Cámaras SHALL ofrecer «Buscar parecidos» en su barra y en la ficha de un canal. Antes de pedir la imagen SHALL preguntar qué se busca, con cuatro opciones: **Objeto**, **Persona**, **Vehículo** y **Animal**. La clase elegida SHALL acotar tanto lo que se marca en la imagen como los resultados.

#### Scenario: Buscar una persona
- **WHEN** el operario toca «Buscar parecidos» y elige Persona
- **THEN** sólo se le ofrecen personas para marcar y los resultados son sólo personas

#### Scenario: Cambiar de clase
- **WHEN** después de ver los resultados de Vehículo el operario elige Persona sobre la misma imagen
- **THEN** se vuelven a marcar las personas de esa imagen sin pedirla de nuevo

### Requirement: Buscar desde el cuadro de un canal

Con un canal elegido (la ficha abierta, o tocando un canal mientras la búsqueda espera imagen), la pared SHALL congelar el cuadro actual de ese canal y marcar sobre él lo que OmniVision reconoce de la clase elegida. El operario SHALL poder tocar uno de los marcados o dibujar él mismo el recuadro. La búsqueda SHALL hacerse con el recorte elegido, no con el cuadro entero.

#### Scenario: Tocar un vehículo de la escena
- **WHEN** el operario elige Vehículo con un canal abierto y toca uno de los dos autos marcados
- **THEN** se buscan los vehículos parecidos a ese auto

#### Scenario: Nada reconocido
- **WHEN** OmniVision no reconoce nada de la clase elegida en el cuadro
- **THEN** la pared lo dice y deja dibujar el recuadro a mano

#### Scenario: Canal sin imagen
- **WHEN** el canal elegido no entrega cuadro (sin señal)
- **THEN** la pared dice que ese canal no tiene imagen y ofrece la foto desde el celular

### Requirement: Buscar con una foto del celular por QR

La pared SHALL mostrar un QR que abre, en el celular, una página para sacar o elegir una foto y subirla, sin usuario ni contraseña. La foto subida SHALL aparecer sola en la pared que mostró el QR, y desde ahí se sigue igual que con el cuadro de un canal (marcar, elegir, buscar). Cada QR SHALL servir para una sola foto y vencer a los 10 minutos.

#### Scenario: Foto que llega
- **WHEN** alguien escanea el QR de la pared, saca una foto y la sube
- **THEN** a los pocos segundos la pared muestra esa foto con lo que reconoce marcado

#### Scenario: QR usado o vencido
- **WHEN** se escanea un QR que ya recibió su foto o que tiene más de 10 minutos
- **THEN** el celular dice que el código venció y que pidan uno nuevo en la pared

#### Scenario: Archivo que no es una foto
- **WHEN** se sube un archivo que no es JPG, PNG ni WebP, o que pesa más de 12 MB
- **THEN** el celular lo rechaza con el motivo y el QR sigue sirviendo

#### Scenario: La foto no queda guardada
- **WHEN** pasan 10 minutos desde que llegó una foto
- **THEN** la foto ya no está en el servidor

### Requirement: Resultados en la pared

Los resultados SHALL mostrarse en la pared, sin salir de ella, ordenados por parecido, cada uno con su foto, cámara, área y hora. SHALL poder acotarse por período (24 horas, 7 días, 30 días) y por área. Tocar un resultado SHALL abrir su foto grande, y, si la cámara tiene grabación, «Ver el momento».

#### Scenario: Acotar por área
- **WHEN** el operario elige el área «Perímetro norte»
- **THEN** sólo quedan los resultados de cámaras de esa área y de sus áreas internas

#### Scenario: Sin parecidos
- **WHEN** la búsqueda no encuentra nada parecido en el período
- **THEN** la pared dice que no hubo parecidos y ofrece ampliar el período

### Requirement: Cualquier pantalla puede buscar

La búsqueda de parecidos SHALL funcionar tanto con la sesión de un usuario como con un enlace de pantalla de la vista Cámaras o de una Rotación, sin pedir usuario. El enlace de pantalla SHALL seguir sin poder guardar ni cambiar nada: la búsqueda sólo lee.

#### Scenario: Pared con enlace de pantalla
- **WHEN** una pared abierta con un enlace de pantalla de Cámaras busca parecidos
- **THEN** la búsqueda funciona y muestra sus resultados

#### Scenario: Enlace de otra vista
- **WHEN** un enlace de pantalla de la vista LPR pide la búsqueda de parecidos
- **THEN** recibe 403
