import { normalizarChapa } from "@/lib/formato-chapa";

/**
 * Hablarle al lector de matrículas (omni-lpr) desde la aplicación.
 *
 * Vivía adentro de la ruta de siluetas. Salió de ahí el 16/11, cuando la captura de una lectura
 * también tuvo que mostrar dónde está la chapa: dos lugares pidiéndole al mismo lector, y el
 * lector atiende DE A UNO —con pedidos simultáneos se cayó con `cudaErrorIllegalAddress`, ver
 * tracking-worker—, así que la fila tiene que ser una sola para todos.
 */
const LPR = (process.env.OMNI_LPR_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
/** Los mismos modelos que el motor de lecturas: si no, las dos lecturas de una misma chapa no serían comparables. */
const DETECTOR = process.env.TRACKING_DETECTOR || "yolo-v9-t-640-license-plate-end2end";
const OCR = process.env.TRACKING_OCR || "cct-xs-v1-global-model";

export type ChapaLeida = {
    /** El texto con forma de chapa del Mercosur (corregido por posición). Vacío: se encontró la chapa pero no se la pudo leer. */
    texto: string;
    confianza: number;
    /** En píxeles de la imagen que se mandó. */
    caja: { x1: number; y1: number; x2: number; y2: number };
};

/**
 * La confianza de una lectura, igual que en el motor: el promedio de la de cada letra, sin pasar
 * de la del detector. El lector entrega la del texto como una LISTA (una por letra). El primer
 * día esto la leía como un número, daba siempre 0 y ningún texto llegaba a confirmarse: se veía
 * el recuadro sobre chapas perfectamente legibles y nunca la matrícula (16/11, captura de Nico
 * del estacionamiento del frente; medido: seis lecturas iguales de seis, todas con «confianza 0»).
 */
export function confianzaDeLectura(i: unknown): number {
    const o = (i || {}) as { ocr?: { confidence?: unknown }; confidence?: unknown; detection?: { confidence?: unknown } };
    const c = o.ocr?.confidence ?? o.confidence;
    const letras = Array.isArray(c) ? c.map(Number).filter((n) => Number.isFinite(n)) : typeof c === "number" ? [c] : [];
    const media = letras.length ? letras.reduce((a, b) => a + b, 0) / letras.length : 0;
    const det = Number(o.detection?.confidence);
    return Math.min(media, Number.isFinite(det) ? det : 1);
}

/** Uno por vez, en el orden en que se piden. */
let fila: Promise<unknown> = Promise.resolve();

/** Las chapas de una imagen, de la más confiable a la menos. Tira si el lector no contesta. */
export function leerChapas(jpeg: Buffer, msTope = 8000): Promise<ChapaLeida[]> {
    const pedido = fila.then(async () => {
        const r = await fetch(`${LPR}/api/v1/tools/detect_and_recognize_plate/invoke`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_base64: jpeg.toString("base64"), detector_model: DETECTOR, ocr_model: OCR }),
            signal: AbortSignal.timeout(msTope),
        });
        if (!r.ok) throw new Error(`omni-lpr respondió ${r.status}`);
        const d = await r.json();
        const items = d?.content?.[0]?.data;
        return (Array.isArray(items) ? items : [])
            .map((i: { ocr?: { text?: unknown }; text?: unknown; detection?: { bounding_box?: unknown }; bounding_box?: unknown }) => ({
                texto: normalizarChapa(String(i?.ocr?.text ?? i?.text ?? ""))?.plate || "",
                confianza: confianzaDeLectura(i),
                caja: (i?.detection?.bounding_box || i?.bounding_box) as ChapaLeida["caja"] | undefined,
            }))
            .filter((x): x is ChapaLeida => !!x.caja && [x.caja.x1, x.caja.y1, x.caja.x2, x.caja.y2].every((n) => typeof n === "number" && Number.isFinite(n)))
            .sort((a, b) => b.confianza - a.confianza);
    });
    fila = pedido.catch(() => null);
    return pedido;
}

/**
 * De las chapas de una foto, cuál es LA del evento: la que dice lo mismo que ya se sabe. Si
 * ninguna coincide, la más confiable —el recuadro igual sirve: muestra dónde está la chapa—, y si
 * la que se eligió dice otra cosa, se devuelve el texto que ya se sabía: la lectura del evento la
 * hizo la cámara de acceso con el vehículo de frente, y manda sobre una relectura de la foto.
 */
export function chapaDelEvento(leidas: ChapaLeida[], plate: string | null | undefined): ChapaLeida | null {
    if (!leidas.length) return null;
    const esperado = (plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const igual = esperado ? leidas.find((x) => x.texto === esperado) : null;
    const elegida = igual || leidas[0];
    return { ...elegida, texto: esperado || elegida.texto };
}
