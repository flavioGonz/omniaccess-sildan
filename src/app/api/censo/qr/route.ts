import { NextRequest, NextResponse } from "next/server";
import { origenPublico } from "@/lib/origen-publico";
import QRCode from "qrcode";
import sharp from "sharp";
import { getSession } from "@/app/actions/auth";
import { getAppBranding } from "@/app/actions/settings";
import { isotipoSvg } from "@/components/brand/OmniLogo";

export const dynamic = "force-dynamic";

/**
 * El QR del censo, hecho acá y no en una página de internet.
 *
 * Un QR de un formulario con datos de trescientas familias no se genera en un sitio de terceros:
 * la URL queda en el registro de alguien más, y la imagen que se imprime no la controla nadie.
 *
 * `?formato=svg` para imprimir (vectorial, no se pixela en un A3) y `?formato=png` para proyectar
 * o pegar en una placa. Corrección de errores alta (H): con el logo tapando el centro, el código
 * se sigue leyendo aunque se pierda hasta un 30 % — y además perdona el papel doblado.
 */
const TAM_MAX = 2048;

export async function GET(req: NextRequest) {
    if (!(await getSession().catch(() => null))) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const formato = sp.get("formato") === "png" ? "png" : "svg";
    const tam = Math.min(TAM_MAX, Math.max(240, Number(sp.get("tam")) || 1024));
    // La URL pública del sistema (ver lib/origen-publico): `req.nextUrl.origin` detrás del proxy es
    // localhost:10001, y un QR impreso con eso no abre en ningún teléfono (el mismo error que
    // mandó los primeros correos del censo con localhost, 25/11).
    const origen = await origenPublico({ pedido: req.headers });
    if (!origen) return NextResponse.json({ error: "No se sabe la dirección pública del sistema: cargala en Ajustes (URL pública, BASE_URL)." }, { status: 400 });
    const url = `${origen}/registro`;

    const opciones = { errorCorrectionLevel: "H" as const, margin: 2, color: { dark: "#0b1220", light: "#ffffff" } };
    if (formato === "svg") {
        const svg = await QRCode.toString(url, { ...opciones, type: "svg", width: tam });
        return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `inline; filename="qr-censo.svg"`, "Cache-Control": "no-store" } });
    }
    const png = await QRCode.toBuffer(url, { ...opciones, type: "png", width: tam });

    // El logo en el centro: el del barrio si lo cargó, y si no **la marca de OmniAccess**, que está
    // en public/ y antes no se usaba. El hueco se compone acá para que la imagen que se baja ya esté
    // lista — nadie tiene que abrir otro programa para pegarle el logo. Lo que no se hace nunca es
    // el hueco vacío: un cuadrado blanco en el medio de un QR no es un diseño, es un error.
    let salida = png;
    try {
        const marca = await getAppBranding();
        const fuente = marca.logoUrl
            ? await fetch(marca.logoUrl.startsWith("http") ? marca.logoUrl : `${origen}${marca.logoUrl}`, { signal: AbortSignal.timeout(4000) })
                .then((r) => (r.ok ? r.arrayBuffer().then((a) => Buffer.from(a)) : null)).catch(() => null)
            : null;
        // El isotipo sale del componente de marca (`isotipoSvg`), no de un archivo de `public/`:
        // ahí viven todavía los logos de la identidad anterior y es exactamente así como se coló
        // el anillo viejo en esta pantalla. Si la marca cambia, cambia en un solo lugar.
        const dibujo = fuente ?? Buffer.from(isotipoSvg());
        if (dibujo) {
            const lado = Math.round(tam * 0.2);
            const aire = Math.round(lado * 0.16);
            // density alta para que el vectorial no entre pixelado cuando el QR se imprime en A3
            const logo = await sharp(dibujo, { density: 600 })
                .resize(lado - aire * 2, lado - aire * 2, { fit: "inside", background: { r: 255, g: 255, b: 255, alpha: 0 } })
                .extend({ top: aire, bottom: aire, left: aire, right: aire, background: "#ffffff" })
                .flatten({ background: "#ffffff" }).png().toBuffer();
            salida = await sharp(png).composite([{ input: logo, gravity: "centre" }]).png().toBuffer();
        }
    } catch { /* sin logo: el QR solo, que es lo que importa */ }
    return new NextResponse(new Uint8Array(salida), { headers: { "Content-Type": "image/png", "Content-Disposition": `inline; filename="qr-censo.png"`, "Cache-Control": "no-store" } });
}
