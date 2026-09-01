# Configuración de Nginx para OmniAccess con SSL

## ✅ Cambios Realizados

### 1. **Problema de Matrícula Solucionado**
- El último dígito ya no se marca en rojo cuando la matrícula está completa
- La lógica de enfoque ahora solo resalta el siguiente carácter a ingresar

### 2. **Overlays de Pantalla Completa**

#### **Cámara**
- Ahora muestra un overlay de pantalla completa cuando se activa la cámara
- Video en tiempo real ocupando toda la pantalla
- Botón grande para capturar la foto
- Botón rojo para cancelar

#### **Audio**
- Overlay de pantalla completa con gradiente rojo
- Animación de ondas de audio (waveform) visual
- Ícono de micrófono animado
- Indicador claro de que está grabando

### 3. **Socket.IO con HTTPS**
- Todos los archivos actualizados para detectar automáticamente HTTP/HTTPS
- Ya no habrá errores de "Mixed Content"

## 📋 Configuración de Nginx Requerida

Para que Socket.IO funcione correctamente con HTTPS, necesitas configurar Nginx para hacer proxy del puerto 10000.

### Pasos:

1. **Copia el archivo de configuración de ejemplo:**
   ```bash
   sudo cp /opt/OmniAccess/nginx-config-example.conf /etc/nginx/sites-available/omniaccess
   ```

2. **Edita el archivo y actualiza las rutas de tus certificados SSL:**
   ```bash
   sudo nano /etc/nginx/sites-available/omniaccess
   ```
   
   Busca estas líneas y actualízalas con tus rutas reales:
   ```nginx
   ssl_certificate /path/to/your/certificate.crt;
   ssl_certificate_key /path/to/your/private.key;
   ```

3. **Habilita el sitio:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/omniaccess /etc/nginx/sites-enabled/
   ```

4. **Prueba la configuración:**
   ```bash
   sudo nginx -t
   ```

5. **Recarga Nginx:**
   ```bash
   sudo systemctl reload nginx
   ```

## 🔍 Verificación

Después de aplicar la configuración de Nginx:

1. Abre tu navegador en `https://omniaccess.infratec.com.uy/guard`
2. Abre la consola del navegador (F12)
3. Deberías ver: `🔌 Connecting to socket: https://omniaccess.infratec.com.uy:10000`
4. No deberías ver errores de "Mixed Content"
5. Los sensores deberían funcionar correctamente

## 📝 Notas Importantes

- **Puerto 10000**: Asegúrate de que el puerto 10000 esté abierto en tu firewall
- **Certificado SSL**: El certificado debe ser válido para tu dominio
- **WebSocket**: La configuración incluye soporte completo para WebSocket/Socket.IO

## 🎨 Nuevas Características UI

### Overlay de Cámara:
- Pantalla completa negra
- Header con indicador "Capturando Fotografía"
- Video en vivo fullscreen
- Botón blanco grande para capturar
- Botón rojo para cancelar

### Overlay de Audio:
- Pantalla completa con gradiente rojo
- Header con indicador "Grabando Audio"
- 12 barras animadas simulando waveform
- Ícono de micrófono pulsante
- Se cierra automáticamente al detener la grabación

## 🚀 Próximos Pasos

1. Aplicar la configuración de Nginx
2. Verificar que Socket.IO se conecte correctamente
3. Probar la captura de foto y audio con los nuevos overlays
4. Confirmar que no hay errores en la consola del navegador
