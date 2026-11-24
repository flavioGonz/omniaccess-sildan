import { prisma } from "@/lib/prisma";

/**
 * La dirección pública del sitio, la que sirve para un enlace que sale en un correo (25/11).
 *
 * Lo que pasó: las primeras invitaciones del censo de San Nicolás salieron con el botón apuntando a
 * `https://localhost:10001/registro/…`. El origen se sacaba de `req.nextUrl.origin`, que detrás del
 * proxy es lo que ve el proceso (localhost:10001), no lo que escribió quien estaba en el panel. Y
 * nada lo frenaba: un enlace que sólo existe adentro del servidor se mandó a los vecinos.
 *
 * El orden, de lo más firme a lo menos:
 *   1. La Setting BASE_URL («URL pública del sistema» en Ajustes), la misma que usan los pases de
 *      las visitas.
 *   2. El host que mandó el navegador, como llega por el proxy (x-forwarded-host, o host).
 * Una dirección local (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, sin punto) NUNCA vale:
 * mejor no mandar que mandar un enlace que no abre.
 */
export function esOrigenLocal(origen: string): boolean {
    let h: string;
    try { h = new URL(origen).hostname; } catch { return true; }
    return !h.includes(".") || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?)/i.test(h) || h.endsWith(".local") || h.endsWith(".localhost");
}

/** Deja `https://host` (sin barra ni camino); null si no es una dirección pública con http(s). */
export function limpiarOrigen(v: string | null | undefined): string | null {
    const t = String(v || "").trim();
    if (!t) return null;
    try {
        const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
        if (!/^https?:$/.test(u.protocol)) return null;
        const o = `${u.protocol}//${u.host}`;
        return esOrigenLocal(o) ? null : o;
    } catch { return null; }
}

/** Del pedido que llegó al panel: el host como lo escribió el navegador, no como lo ve el proceso. */
export function origenDelPedido(h: { get(n: string): string | null }): string | null {
    const host = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0].trim();
    if (!host) return null;
    const proto = (h.get("x-forwarded-proto") || "https").split(",")[0].trim();
    return limpiarOrigen(`${proto === "http" ? "http" : "https"}://${host}`);
}

/** La dirección pública: BASE_URL, o la del pedido, o la guardada; null si ninguna es pública. */
export async function origenPublico(o: { pedido?: { get(n: string): string | null }; guardado?: string | null } = {}): Promise<string | null> {
    const base = limpiarOrigen((await prisma.setting.findUnique({ where: { key: "BASE_URL" } }).catch(() => null))?.value);
    return base || (o.pedido ? origenDelPedido(o.pedido) : null) || limpiarOrigen(o.guardado);
}
