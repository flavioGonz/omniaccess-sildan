/**
 * La marca del vehículo de un evento, diciendo de dónde salió.
 *
 * Por qué (San Nicolás, 15/10: «los íconos de la marca de autos fallan mucho; puede confundir
 * a la hora de una búsqueda forense»): la marca la adivina la cámara Hikvision en cada cuadro
 * (vehicleLogoRecog) y se equivoca seguido. Dibujada como logo a todo color, una adivinanza se
 * leía igual que un dato. El padrón, en cambio, lo cargó y verificó una persona.
 *
 * Regla: si la matrícula está en el padrón con marca, vale esa (`deCamara: false`). Si no, la de
 * la cámara, marcada como tal (`deCamara: true`), para que la pantalla la muestre atenuada y con
 * la aclaración — no como un hecho. Es la misma regla que ya usaba el visor (VisorCuadro).
 */
export type MarcaDeEvento = { marca: string; deCamara: boolean } | null;

const limpiar = (s: unknown) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function marcaDeEvento(event: any, marcaCamara?: string | null): MarcaDeEvento {
    const chapa = limpiar(event?.plateDetected);
    const vehiculos: any[] = event?.user?.vehicles || [];
    const delPadron = chapa ? vehiculos.find((v) => limpiar(v?.plate) === chapa && v?.brand) : null;
    if (delPadron?.brand) return { marca: String(delPadron.brand), deCamara: false };
    const cam = (marcaCamara || "").trim();
    return cam ? { marca: cam, deCamara: true } : null;
}

/** Lo que se dice al pasar el mouse sobre una marca que adivinó la cámara. */
export const AVISO_MARCA_CAMARA = "Marca según la cámara: la reconoce sola y puede fallar. No usar como dato para una búsqueda.";
