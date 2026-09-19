import L from "leaflet";

/**
 * Iconos de Leaflet, con memoria.
 *
 * react-leaflet compara la prop `icon` por IDENTIDAD. Un `L.divIcon({...})` escrito dentro
 * del render devuelve un objeto nuevo cada vez, así que el marcador no se actualiza: se
 * **reemplaza**, y el navegador vuelve a parsear ese HTML. Con la reproducción del flujo
 * andando a 60 cuadros por segundo eso es reconstruir el DOM de cada flecha, cada parada y
 * cada auto sesenta veces por segundo — y no cambió ninguno.
 *
 * Acá el icono se cachea por una clave que describe cómo se ve. Dos llamadas con la misma
 * clave devuelven el MISMO objeto, react-leaflet no toca nada, y el marcador solo se
 * redibuja cuando de verdad cambió de aspecto.
 *
 * La memoria tiene tope y descarta lo más viejo. Las claves acotadas —un ángulo entero, un
 * número de parada— nunca lo alcanzan; las que dependen de una matrícula sí podrían, en una
 * pantalla abierta toda la noche.
 */

const TOPE = 400;
const memoria = new Map<string, L.DivIcon>();

export function iconoCacheado(clave: string, crear: () => L.DivIconOptions): L.DivIcon {
    const guardado = memoria.get(clave);
    if (guardado) {
        // Volver a ponerlo lo manda al final: lo que se sigue usando no se descarta.
        memoria.delete(clave);
        memoria.set(clave, guardado);
        return guardado;
    }
    const icono = L.divIcon(crear());
    memoria.set(clave, icono);
    if (memoria.size > TOPE) {
        const masViejo = memoria.keys().next().value;
        if (masViejo !== undefined) memoria.delete(masViejo);
    }
    return icono;
}
