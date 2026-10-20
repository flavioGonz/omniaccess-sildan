import crypto from "crypto";

/**
 * Firma de enlaces a medios. La misma cuenta que firma-medios.js (raíz del repo), que usan los
 * procesos en JS; ver allí el porqué. Si cambia una, cambia la otra.
 */
export const PARAM_FIRMA = "f";
const DURA_SEG = 30 * 86400;
const secreto = () => process.env.MEDIOS_SECRETO || process.env.JWT_SECRET || "";
const mac = (ruta: string, exp: number) => crypto.createHmac("sha256", secreto()).update(`${ruta}|${exp}`).digest("base64url").slice(0, 22);

export function firmarUrl(url: string, segundos = DURA_SEG): string {
    if (!url || !secreto()) return url;
    try {
        const u = new URL(url, "http://x");
        const exp = Math.floor(Date.now() / 1000) + segundos;
        u.searchParams.set(PARAM_FIRMA, `${exp}.${mac(u.pathname, exp)}`);
        return /^https?:\/\//i.test(url) ? u.toString() : u.pathname + u.search;
    } catch { return url; }
}

/** ¿La firma vale para este camino y no venció? */
export function firmaDeMedioValida(ruta: string, f: string | null | undefined): boolean {
    if (!f || !secreto()) return false;
    const [e, m] = f.split(".");
    const exp = Number(e);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !m) return false;
    const esperado = mac(ruta, exp);
    if (esperado.length !== m.length) return false;
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(m));
}
