# Archivo de Sonido de Alerta

Para que las notificaciones PWA funcionen con sonido, necesitas colocar un archivo de audio en esta ubicación:

**Ubicación requerida:** `/opt/OmniAccess/public/sounds/alert.mp3`

## Opciones para obtener el archivo:

### Opción 1: Descargar un sonido de alerta gratuito
Puedes descargar sonidos de alerta gratuitos de:
- https://freesound.org/ (busca "alarm" o "alert")
- https://www.zapsplat.com/ (sección de alarmas)
- https://mixkit.co/free-sound-effects/alarm/

### Opción 2: Usar un comando para generar un tono (si tienes ffmpeg)
```bash
ffmpeg -f lavfi -i "sine=frequency=1000:duration=2" -f lavfi -i "sine=frequency=800:duration=2" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1" /opt/OmniAccess/public/sounds/alert.mp3
```

### Opción 3: Copiar un archivo existente
Si tienes un archivo de sonido de alerta en tu sistema, simplemente cópialo:
```bash
cp /ruta/a/tu/sonido.mp3 /opt/OmniAccess/public/sounds/alert.mp3
```

## Verificación
Una vez colocado el archivo, verifica que existe:
```bash
ls -lh /opt/OmniAccess/public/sounds/alert.mp3
```

El archivo debería tener al menos 10KB de tamaño para ser un sonido válido.
