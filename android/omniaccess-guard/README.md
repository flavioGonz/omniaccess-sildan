# OmniAccess Guard (Android)

La consola de garita de OmniAccess (`/guard`) como app, con lo que el navegador no puede hacer:
linterna, voz, alarma a todo volumen, NFC para las rondas, hombre caído, pánico con los botones de
volumen y un servicio que mantiene todo vivo durante el turno.

Reemplaza a la APK «Guardia Sildan» (`uy.com.sildan.guard` 1.5), que estaba firmada con la clave
de depuración y no la aceptaba Google Play.

## Al abrirla

1. **Arranque:** el logo de OmniAccess se arma solo, sobre fondo oscuro (SplashScreen de Android 12+).
2. **Primera vez:** pide la dirección del servidor y la verifica (`GET /api/guardia/servidor`).
   Después pide el usuario y el PIN del guardia, los mismos de la consola (`POST /api/guardia/entrar`).
3. **Cada vez que se abre:** vuelve a identificar al guardia sola y abre la consola directo.
   Mientras carga, muestra una pantalla propia con el barrio y el avance. Si la consola no abre,
   muestra qué pasó, con «Reintentar» y «Cambiar servidor».

El PIN queda cifrado con una clave del almacén de Android, no se copia en respaldos y se borra con
«Cambiar guardia» (desde la consola) o «Cambiar servidor».

## Dos sabores

| | `play` | `directa` |
|---|---|---|
| Para | Google Play | Tablets fijas de garita instaladas a mano |
| Actualización | Por la tienda | Desde el servidor (`/api/apk/version`) |
| Pánico con la pantalla apagada | No | Sí (servicio de accesibilidad) |
| Servicio al encender | No | Sí |

## Compilar

Requiere JDK 17+ y el SDK de Android (`local.properties` con `sdk.dir=...`).

```
./gradlew bundlePlayRelease      # app-play-release.aab, el que se sube a Play
./gradlew assembleDirectaRelease # app-directa-release.apk, para instalar a mano
./gradlew lintPlayRelease        # tiene que dar 0 errores
```

**Firma:** el release se firma con la clave de subida si existe `firma.properties` en esta carpeta.
El archivo trae las claves `storeFile`, `storePassword`, `keyAlias` y `keyPassword`.
Ni ese archivo ni el `.jks` van al repo (están en `.gitignore`); se guardan aparte, con respaldo.
Si se pierde la clave de subida, Play permite reemplazarla pidiéndolo desde la consola
(Play App Signing). Sin la clave, no se pueden publicar versiones nuevas hasta que Google la reemplace.

## Para la ficha de Play Console

- **Servicio en primer plano de tipo ubicación:** hay que declararlo y justificarlo. El servicio
  mantiene el pánico y la ubicación del guardia durante la ronda, con la pantalla apagada.
  Play pide un video corto.
- **Ubicación:** sólo en primer plano. Ya no se pide ubicación en segundo plano.
- **Cámara y micrófono:** los usa la consola (fotos de visitas, intercomunicador).
- **Política de privacidad:** obligatoria por la ubicación, la cámara y el micrófono.
- **Tipo de app:** herramienta para empresas. Si se publica como app privada (Managed Google
  Play), no aparece en la tienda pública.
