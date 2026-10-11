/**
 * Prender y apagar las tareas de omni-vision (Setting VISION_TAREAS = {apagadas: [...]}).
 *
 * El ajuste es la verdad; omni-vision arranca con todo prendido y se entera por dos lados: la
 * ruta que lo cambia se lo manda en el acto, y vision-worker se lo vuelve a mandar cada vez que
 * relee los ajustes (así un reinicio del contenedor no prende lo que alguien apagó).
 *
 * Este archivo no habla con la base ni con omni-vision: lo importa también la pantalla.
 *
 * `queApaga` es lo que se deja de tener: apagar una tarea no es gratis para el resto, y quien
 * aprieta el interruptor tiene que saberlo antes.
 */
export const CLAVE_TAREAS = "VISION_TAREAS";
export const TAREAS_VISION: Record<string, { nombre: string; queApaga: string }> = {
    detectar: { nombre: "Detección", queApaga: "Sin detección no corre nada de lo de abajo en las cámaras: se frenan el registro de detecciones, las reglas (conteo, sentido contrario, permanencia, aglomeración) y la relectura de NO_LEIDA. Suelta su memoria de la GPU." },
    segmentar: { nombre: "Siluetas", queApaga: "Sólo la usa el laboratorio (modo Siluetas). Apagada, suelta su memoria de la GPU." },
    pose: { nombre: "Pose", queApaga: "Sólo la usa el laboratorio (modo Pose, postura de la persona). Apagada, suelta su memoria de la GPU." },
    atributos: { nombre: "Atributos", queApaga: "Las detecciones se siguen guardando, pero sin color, carrocería ni ropa: no se van a poder buscar por eso. Suelta su memoria de la GPU." },
    texto: { nombre: "Texto (OCR)", queApaga: "Se deja de leer el rotulado de los vehículos (empresa por rotulado) y el texto en el laboratorio. Suelta su memoria de la GPU." },
    seguimiento: { nombre: "Seguimiento", queApaga: "Sin pistas no se sabe que un objeto en dos cuadros es el mismo: se frenan el registro de detecciones y las reglas. La detección suelta sigue andando en el laboratorio." },
};
