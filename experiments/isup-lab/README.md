# ISUP/EHome Experiment Lab

Este es un entorno aislado para investigar el protocolo **ISUP (EHome)** de Hikvision sin comprometer la estabilidad de OmniAccess.

## Cómo usar el Sniffer

1. **Inicia el servidor de prueba:**
   ```bash
   node experiments/isup-lab/isup-sniffer.js
   ```

2. **Configura una Cámara Hikvision:**
   - Ve a la interfaz web de la cámara.
   - Navega a: **Red** -> **Configuración avanzada** -> **Acceso a plataforma**.
   - Tipo de acceso: Selecciona **EHome** o **ISUP**.
   - Versión: Selecciona la más alta disponible (ej. 5.0).
   - Dirección del servidor: Pon la IP de este servidor.
   - Puerto del servidor: **7660**.
   - ID del dispositivo: Deja el que viene por defecto o inventa uno.

3. **Observa los resultados:**
   - Si la cámara logra contactar con el servidor, verás paquetes entrando en hexadecimal.
   - Estos paquetes suelen ser de "Registro" o "Heartbeat".

## Objetivos del Experimento
- [ ] Confirmar que las cámaras envían paquetes de registro.
- [ ] Analizar la estructura de los paquetes XML que vienen dentro del tráfico UDP.
- [ ] Investigar cómo responder para completar el registro y abrir un canal TCP de control.
