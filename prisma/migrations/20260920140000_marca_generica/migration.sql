-- Una camara sin marca conocida. El seguimiento no necesita driver: toma cuadros
-- por RTSP con ffmpeg, que habla con cualquiera. Lo que no va a poder hacer es
-- mandarle credenciales ni abrirle nada, y eso lo dice el catalogo de drivers.
ALTER TYPE "DeviceBrand" ADD VALUE IF NOT EXISTS 'GENERICA';
