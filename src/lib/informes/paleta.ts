/**
 * La paleta de los informes, sola: sin disco, sin base y sin React, para que la pueda usar tanto el
 * servidor que arma un PDF (lib/informes/marca) como el navegador que dibuja un informe imprimible.
 *
 * Es la de la interfaz (globals.css, pasada de oklch a hex): un azul de acción y los tonos de estado.
 * En un informe vale lo mismo que en pantalla: el color dice cómo está algo, no adorna.
 */
export const COLOR = {
    tinta: "#0b1220", texto: "#1f2937", gris: "#6b7280", grisClaro: "#9ca3af", linea: "#e5e7eb", superficie: "#f4f6f9", fondo: "#ffffff",
    accion: "#0073e9", accionClaro: "#7fb6f5",
    bien: "#009965", aviso: "#db8d0f", avisoTexto: "#a85e00", mal: "#e32a4e", info: "#1c8be3", quieto: "#8e65df",
} as const;

export const rgb = (hex: string): [number, number, number] => {
    const m = hex.replace("#", "");
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
};
/** El mismo color, mezclado con blanco: los fondos suaves de las celdas y las bandas. */
export const suave = (hex: string, k = 0.86): string => "#" + rgb(hex).map((c) => Math.round(c + (255 - c) * k).toString(16).padStart(2, "0")).join("");

/**
 * Los tonos de estado sobre una tapa oscura: el rojo y el ámbar de papel se apagan contra la tinta,
 * así que ahí van en su versión clara. Los mismos en el PDF de rastreo y en el informe con mapa.
 */
export const EN_TAPA = { texto: "#ffffff", claro: "#e2e8f0", apagado: "#94a3b8", mudo: "#64748b", mal: "#ff6b84", aviso: "#f5b544" } as const;
