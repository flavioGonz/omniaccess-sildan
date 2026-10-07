/**
 * La APK de la consola del guardia.
 *
 * El archivo y el nombre de descarga son los del producto: «OmniAccess Guard» (decidido el 7/10,
 * igual que las PWA del guardia). OJO: la APK por dentro todavía se compiló con el nombre del
 * cliente anterior (lo que muestra la tablet debajo del ícono y el paquete Android); eso sólo se
 * cambia recompilándola, con la etiqueta «OmniAccess Guard». /api/apk/version informa la
 * fecha del archivo: renombrarlo en el servidor con `mv` la conserva y no dispara una
 * "actualización" falsa en las tablets.
 */
export const ARCHIVO_APK = "OmniAccess-Guard.apk";
export const NOMBRE_DESCARGA_APK = "OmniAccess-Guard.apk";
