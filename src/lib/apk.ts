/**
 * La APK de la consola del guardia.
 *
 * El archivo y el nombre de descarga son los del producto. OJO: la APK por dentro todavía se
 * compiló con el nombre del cliente anterior (es el nombre que muestra la tablet debajo del
 * ícono y el paquete Android); eso sólo se cambia recompilándola. /api/apk/version informa la
 * fecha del archivo: renombrarlo en el servidor con `mv` la conserva y no dispara una
 * "actualización" falsa en las tablets.
 */
export const ARCHIVO_APK = "OmniAccess-Guardia.apk";
export const NOMBRE_DESCARGA_APK = "OmniAccess-Guardia.apk";
