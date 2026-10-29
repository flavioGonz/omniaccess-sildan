/**
 * Leer un QR con la cámara del teléfono.
 *
 * Android trae BarcodeDetector y lo usa el Chrome nativo, rápido y sin bajar nada. El Safari del
 * iPhone (y Firefox) no lo tienen: antes la pantalla decía «este equipo no soporta escaneo» y el
 * guardia con iPhone no podía validar un pase. Para ellos se baja jsQR (130 KB, una sola vez, y
 * sólo cuando hace falta) y se decodifica un cuadro achicado del video.
 */

/** Lado mayor del cuadro que se le pasa a jsQR: más grande no lee mejor un QR en pantalla y tarda más. */
const LADO_JSQR = 640;

export type LectorQr = { tipo: "nativo" | "jsqr"; leer: (video: HTMLVideoElement) => Promise<string | null> };

export async function crearLectorQr(): Promise<LectorQr> {
    const Det = typeof window !== "undefined" ? (window as any).BarcodeDetector : undefined;
    if (Det) {
        try {
            const formatos: string[] = (await Det.getSupportedFormats?.()) || ["qr_code"];
            if (formatos.includes("qr_code")) {
                const det = new Det({ formats: ["qr_code"] });
                return { tipo: "nativo", leer: async (v) => { const c = await det.detect(v); return c?.[0]?.rawValue || null; } };
            }
        } catch { /* sin BarcodeDetector usable: se sigue con jsQR */ }
    }
    // Es UMD (CommonJS adentro): según el empaquetador, la función llega como default o como el módulo.
    const m: any = await import("@/lib/vendor/jsqr");
    const jsQR = (typeof m === "function" ? m : m.default) as typeof import("@/lib/vendor/jsqr").default;
    const lienzo = document.createElement("canvas");
    const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
    return {
        tipo: "jsqr",
        leer: async (v) => {
            const w = v.videoWidth, h = v.videoHeight;
            if (!w || !h) return null;
            const k = Math.min(1, LADO_JSQR / Math.max(w, h));
            lienzo.width = Math.round(w * k); lienzo.height = Math.round(h * k);
            ctx.drawImage(v, 0, 0, lienzo.width, lienzo.height);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data || null;
        },
    };
}
