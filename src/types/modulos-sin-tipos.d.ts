/**
 * Módulos que no traen sus tipos y no tienen paquete @types instalado. Declararlos acá, como `any`,
 * deja el compilador en cero errores sin sumar dependencias al package.json de los servidores.
 * Si alguno pasa a usarse mucho, conviene instalar sus tipos (@types/js-yaml, @types/web-push,
 * @types/archiver) y sacarlo de esta lista.
 */
declare module "archiver";
declare module "flubber";
declare module "js-yaml";
declare module "web-push";
