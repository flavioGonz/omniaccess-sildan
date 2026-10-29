/**
 * Lo que comparten los informes que arma el servidor (PDF y Excel): la marca, la paleta, la fuente
 * y cómo se lee una imagen guardada.
 *
 * La paleta es la de la interfaz (globals.css, pasada de oklch a hex): un azul de acción y los
 * tonos de estado. En un informe vale lo mismo que en pantalla: el color dice cómo está algo, no
 * adorna. Si en Ajustes hay color de informe (REPORT_PRIMARY), ese manda en las bandas de marca;
 * los tonos de estado no cambian, porque significan lo mismo en todos lados.
 *
 * La fuente es Outfit, la de OmniAccess (SIL Open Font License, en ./fuentes con su licencia): las
 * fuentes estándar de un PDF no tienen la «ñ» ni las tildes en todas las variantes, y el informe se
 * vería como un formulario cualquiera.
 */
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

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

export type Marca = {
    empresa: string; contacto: string; preparadoPor: string; autorizadoPor: string; pie: string;
    primario: string;
    logo: { png: Buffer; w: number; h: number } | null;
    portada: Buffer | null;
};

export async function leerMarca(): Promise<Marca> {
    const claves = ["REPORT_COMPANY", "REPORT_CONTACT", "REPORT_PREPARED_BY", "REPORT_AUTHORIZED_BY", "REPORT_FOOTER", "REPORT_PRIMARY", "REPORT_LOGO_URL", "REPORT_COVER_URL", "APP_BRAND_NAME", "APP_BRAND_LOGO_URL", "APP_BRAND_PRIMARY"];
    const filas = await prisma.setting.findMany({ where: { key: { in: claves } } }).catch(() => []);
    const v = Object.fromEntries(filas.map((f) => [f.key, (f.value || "").trim()]));
    const hex = (x?: string) => (x && /^#[0-9a-fA-F]{6}$/.test(x) ? x : null);
    const empresa = v.REPORT_COMPANY || v.APP_BRAND_NAME || "OmniAccess";
    const logoCrudo = await leerImagen(v.REPORT_LOGO_URL || v.APP_BRAND_LOGO_URL || "");
    let logo: Marca["logo"] = null;
    if (logoCrudo) {
        try {
            const sharp = (await import("sharp")).default;
            const png = await sharp(logoCrudo).resize({ height: 160, withoutEnlargement: true }).png().toBuffer();
            const meta = await sharp(png).metadata();
            logo = { png, w: meta.width || 1, h: meta.height || 1 };
        } catch { logo = null; }
    }
    return {
        empresa, contacto: v.REPORT_CONTACT || "", preparadoPor: v.REPORT_PREPARED_BY || "", autorizadoPor: v.REPORT_AUTHORIZED_BY || "",
        pie: v.REPORT_FOOTER || empresa,
        // El violeta que devolvía getReportBranding por defecto no es de OmniAccess: sin color elegido, la tinta.
        primario: hex(v.REPORT_PRIMARY) || hex(v.APP_BRAND_PRIMARY) || COLOR.tinta,
        logo, portada: await leerImagen(v.REPORT_COVER_URL || ""),
    };
}

/** Outfit, en base64, para registrarla en jsPDF. Se lee una vez por proceso. */
let fuentes: { regular: string; negrita: string } | null = null;
export async function fuentesOutfit() {
    if (fuentes) return fuentes;
    const dir = path.join(process.cwd(), "src", "lib", "informes", "fuentes");
    const [r, b] = await Promise.all([fs.readFile(path.join(dir, "Outfit-Regular.ttf")), fs.readFile(path.join(dir, "Outfit-Bold.ttf"))]);
    fuentes = { regular: r.toString("base64"), negrita: b.toString("base64") };
    return fuentes;
}

/**
 * Una imagen guardada, por la forma en que la guarda OmniAccess: «/api/files/<bucket>/<clave>»,
 * «<bucket>/<clave>», «/api/vision/imagen/<clave>» (bucket de OmniVision) o una URL http(s).
 * null si no está (pudo vencer la retención): el informe sigue sin esa foto.
 */
export async function leerImagen(ruta: string | null | undefined): Promise<Buffer | null> {
    if (!ruta) return null;
    try {
        if (/^https?:\/\//.test(ruta)) {
            const r = await fetch(ruta, { signal: AbortSignal.timeout(8000) });
            return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
        }
        let bucket: string, clave: string;
        const limpia = ruta.replace(/^\/+/, "");
        if (limpia.startsWith("api/vision/imagen/")) { bucket = process.env.VISION_BUCKET || "objetos"; clave = limpia.slice("api/vision/imagen/".length); }
        else {
            const sin = limpia.startsWith("api/files/") ? limpia.slice("api/files/".length) : limpia;
            if (sin.startsWith("api/")) return null; // otra ruta de la aplicación (se arma a pedido): no es un archivo
            const i = sin.indexOf("/");
            if (i < 1) return null;
            bucket = sin.slice(0, i); clave = sin.slice(i + 1);
            if (bucket === "lpr") bucket = process.env.S3_BUCKET || "lpr-prod";
        }
        const { getS3Client } = await import("@/lib/s3");
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: bucket, Key: clave }));
        return Buffer.from(await r.Body!.transformToByteArray());
    } catch { return null; }
}

/** Una foto achicada a JPEG, lista para el PDF (y su proporción, para no deformarla). */
export async function fotoChica(buf: Buffer | null, ancho = 360): Promise<{ jpg: Buffer; w: number; h: number } | null> {
    if (!buf) return null;
    try {
        const sharp = (await import("sharp")).default;
        const jpg = await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        const m = await sharp(jpg).metadata();
        return { jpg, w: m.width || 1, h: m.height || 1 };
    } catch { return null; }
}
