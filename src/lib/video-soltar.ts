import { useCallback, useRef } from "react";

/**
 * Soltar la descarga de un <video> que se saca de la pantalla.
 *
 * Por qué existe (13/11, Nico: «después de entrar a una búsqueda de parecidos o a grabaciones, salgo
 * hacia atrás y la pared queda toda en negro: tengo que recargar»). Las grabaciones se piden por
 * tramos y cada salto cambia la dirección del video; el <video> lleva `key`, así que React saca el
 * viejo y pone uno nuevo. Sacarlo de la página NO corta su descarga: el navegador la mantiene hasta
 * que le toca limpiar memoria. Medido ese día con seis saltos seguidos, uno cada 2 s: las seis
 * descargas seguían abiertas al terminar, y tardaron de 16 a 20 s más en cerrarse solas. Soltando
 * el viejo, quedaba una: la que se está viendo.
 *
 * Y cada descarga abierta es un ffmpeg en el servidor trayendo ese tramo del NVR en tiempo real
 * (/api/nvr/playback no frena a ffmpeg aunque nadie lea). Arrastrar la regla un rato era abrirle al
 * NVR media docena de reproducciones a la vez, por el mismo enlace por el que viajan los vivos.
 *
 * Lo mismo que ya hacía el vivo (piezas.tsx → Vivo) al desmontarse; acá va para los <video> que
 * cambian de dirección con `key`.
 */
export function soltarVideo(v: HTMLVideoElement | null | undefined) {
    if (!v) return;
    try { v.pause(); v.removeAttribute("src"); v.load(); } catch { /* ya no está */ }
}

/**
 * La referencia de un <video> que se reemplaza con `key`: cuando llega otro elemento (o ninguno),
 * el anterior se suelta. Se usa igual que un useRef (`video.current`), y al <video> se le pasa
 * `poner` como `ref`.
 *
 * La comprobación va un instante después y sólo suelta si el elemento ya no está en la página: en
 * desarrollo React desmonta y vuelve a montar las referencias para probarlas, con el mismo
 * elemento, y soltarlo ahí lo dejaba sin dirección (React no se la vuelve a poner: no cambió).
 */
export function useVideoQueSeSuelta(): [React.MutableRefObject<HTMLVideoElement | null>, (el: HTMLVideoElement | null) => void] {
    const ref = useRef<HTMLVideoElement | null>(null);
    const poner = useCallback((el: HTMLVideoElement | null) => {
        const anterior = ref.current;
        ref.current = el;
        if (anterior && anterior !== el) setTimeout(() => { if (!anterior.isConnected) soltarVideo(anterior); }, 0);
    }, []);
    return [ref, poner];
}
