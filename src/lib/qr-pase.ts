import QRCode from "qrcode";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

/**
 * El QR del pase de visita, con el logo del barrio en el centro.
 *
 * Una sola implementación para los tres lugares donde se dibuja — el WhatsApp del bot
 * (PNG), el envío desde el panel (PNG) y las páginas /invitado, /residente y el panel de
 * invitados (SVG) —, para que el pase se vea igual en todos. Antes cada uno llamaba a
 * `qrcode` por su cuenta y no había dónde ponerle un logo.
 *
 * El logo sale del Setting INVITE_QR_LOGO_URL (una imagen subida desde Ajustes → WhatsApp,
 * en /public/branding). Con logo se usa corrección de errores H: el logo tapa hasta un
 * ~25 % del centro y H tolera 30 %. Sin logo queda M, que es más chico y se lee igual.
 */

export const SETTING_LOGO_QR = "INVITE_QR_LOGO_URL";
/** Lado del logo como fracción del lado del QR. 0.24 queda dentro de lo que tolera H. */
const FRACCION_LOGO = 0.24;
/** Aire blanco alrededor del logo, como fracción del lado del logo. */
const AIRE_LOGO = 0.14;

async function logoConfigurado(): Promise<{ url: string; ruta: string } | null> {
    try {
        const s = await prisma.setting.findUnique({ where: { key: SETTING_LOGO_QR } });
        const url = (s?.value || "").trim();
        // Sólo lo que subió Ajustes: /branding/<archivo> (anterior al build) o /api/branding/<archivo>.
        const m = url.match(/^\/(?:api\/)?branding\/([^/?#]+)$/);
        if (!m) return null;
        const ruta = path.join(process.cwd(), "public", "branding", path.basename(m[1]));
        await fs.access(ruta);
        return { url, ruta };
    } catch { return null; }
}

/** PNG del QR (para WhatsApp y descargas). `texto` es lo que se codifica (link o token). */
export async function qrPasePng(texto: string, lado = 512): Promise<Buffer> {
    const logo = await logoConfigurado();
    const base = await QRCode.toBuffer(String(texto || ""), { width: lado, margin: 1, errorCorrectionLevel: logo ? "H" : "M" });
    if (!logo) return base;
    try {
        const sharp = (await import("sharp")).default;
        const ladoLogo = Math.round(lado * FRACCION_LOGO);
        const aire = Math.round(ladoLogo * AIRE_LOGO);
        const caja = ladoLogo + aire * 2;
        const imagen = await sharp(logo.ruta).resize({ width: ladoLogo, height: ladoLogo, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
        // Fondo blanco redondeado debajo del logo: sin él, un logo con transparencias deja
        // módulos del QR asomando entre sus formas y el lector se confunde.
        const radio = Math.round(caja * 0.18);
        const fondo = Buffer.from(`<svg width="${caja}" height="${caja}"><rect x="0" y="0" width="${caja}" height="${caja}" rx="${radio}" fill="#ffffff"/></svg>`);
        const x = Math.round((lado - caja) / 2);
        return await sharp(base)
            .composite([{ input: fondo, left: x, top: x }, { input: imagen, left: x + aire, top: x + aire }])
            .png().toBuffer();
    } catch (e) {
        console.error("[qr-pase] no se pudo poner el logo, va sin él:", (e as any)?.message);
        return base;
    }
}

/** SVG del QR (para las páginas). El logo va como <image> con fondo blanco, en coordenadas del viewBox. */
export async function qrPaseSvg(texto: string, px = 240): Promise<string> {
    const logo = await logoConfigurado();
    let svg: string;
    try { svg = await QRCode.toString(String(texto || ""), { type: "svg", margin: 1, errorCorrectionLevel: logo ? "H" : "M", width: px }); }
    catch { return ""; }
    if (!logo) return svg;
    const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    if (!m) return svg;
    const modulos = parseFloat(m[1]);
    const ladoLogo = modulos * FRACCION_LOGO;
    const aire = ladoLogo * AIRE_LOGO;
    const caja = ladoLogo + aire * 2;
    const x = (modulos - caja) / 2;
    const extra = `<rect x="${x}" y="${x}" width="${caja}" height="${caja}" rx="${caja * 0.18}" fill="#ffffff"/>` +
        `<image href="${logo.url}" x="${x + aire}" y="${x + aire}" width="${ladoLogo}" height="${ladoLogo}" preserveAspectRatio="xMidYMid meet"/>`;
    return svg.replace("</svg>", extra + "</svg>");
}
