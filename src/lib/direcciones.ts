import { prisma } from "@/lib/prisma";
import { claveDeLugar, textoDeDireccion, type PartesOsm } from "@/lib/direccion-texto";
import { funcionActiva } from "@/app/actions/funciones";
import { URL_GEO } from "@/lib/omni-geo";

/**
 * Averiguar la dirección de un punto, preguntándole al servicio de direcciones y guardando lo que
 * contesta (23/11).
 *
 * El servicio es omni-geo: un Nominatim con el mapa de OpenStreetMap que corre como contenedor de
 * OmniAccess en este mismo equipo (`services/omni-geo`, `lib/omni-geo`) y se prende con la función
 * «Direcciones de los lugares». Es propio a propósito —decisión de Nico—: por dónde anda cada
 * vehículo de un cliente no se le manda a un tercero. Con el ajuste `GEO_URL` se puede apuntar a
 * otro Nominatim (uno central, compartido por varias instalaciones); si está, manda él.
 *
 * Tres cuidados, porque de esto cuelgan el mapa en vivo y los reportes:
 *
 *  · **Lo que ya se preguntó no se vuelve a preguntar.** Se guarda en `GeoDireccion`, por punto
 *    redondeado a once metros. Un vehículo vuelve todos los días a los mismos lugares: al segundo
 *    día casi todo sale de la base.
 *  · **Si el servicio no contesta, nadie espera.** Tras unas fallas seguidas se lo da por caído un
 *    minuto y todo sigue como antes de que existiera: con el nombre de la geocerca o las
 *    coordenadas. Una pantalla que tarda diez segundos porque un servicio accesorio está apagado
 *    es peor que una sin direcciones.
 *  · **Una falla no se guarda como «no hay dirección».** Sólo se guarda vacío cuando el servicio
 *    contestó que ahí no hay nada (agua, campo sin caminos).
 */

/** El ajuste para usar OTRO servicio en vez del incorporado: «http://172.26.20.186:8080». Vacío = el de este equipo. */
export const AJUSTE_GEO = "GEO_URL";
/** Cuánto se espera cada respuesta. El servicio está en la misma red: si tarda más que esto, está mal. */
const ESPERA_MS = 2500;
const A_LA_VEZ = 4;
/** Preguntas nuevas por pedido. Lo que pase de esto queda con coordenadas esta vez y entra en la próxima. */
export const NUEVAS_MAX = 2000;
const FALLAS_PARA_CAIDO = 3, CAIDO_MS = 60_000;

let leido: { url: string | null; propio: boolean; hasta: number } | null = null;
let fallas = 0, caidoHasta = 0;

export const urlValida = (x: string | null | undefined): string | null => {
    const u = (x || "").trim().replace(/\/+$/, "");
    return /^https?:\/\/[\w.\-]+(:\d{1,5})?(\/[\w.\-/]*)?$/.test(u) ? u : null;
};

/**
 * A quién se le pregunta. Con la función apagada, a nadie (`url` nulo): ni siquiera se muestra lo
 * ya averiguado, porque «apagada» tiene que querer decir apagada. Prendida: el servicio de afuera
 * si se cargó uno, y si no el incorporado. Se relee cada medio minuto.
 */
export async function servicioDeDirecciones(): Promise<{ url: string | null; propio: boolean }> {
    if (leido && leido.hasta > Date.now()) return leido;
    if (!(await funcionActiva("GPS_DIRECCIONES"))) leido = { url: null, propio: false, hasta: Date.now() + 30_000 };
    else {
        const f = await prisma.setting.findUnique({ where: { key: AJUSTE_GEO } }).catch(() => null);
        const otro = urlValida(f?.value) || urlValida(process.env.GEO_URL);
        leido = { url: otro || URL_GEO, propio: !otro, hasta: Date.now() + 30_000 };
    }
    return leido;
}
/** Para que un cambio del ajuste valga en el acto, y no al minuto. */
export const olvidarServicio = () => { leido = null; fallas = 0; caidoHasta = 0; };

type Respuesta = { address?: PartesOsm; error?: unknown };
/** `undefined` = no se pudo preguntar (no se guarda); `null` = contestó que ahí no hay nada. */
export async function preguntarDireccion(url: string, lat: number, lon: number) {
    try {
        const r = await fetch(`${url}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=es`, { signal: AbortSignal.timeout(ESPERA_MS), cache: "no-store" });
        if (!r.ok) return undefined;
        const j = (await r.json()) as Respuesta;
        return j.error ? null : textoDeDireccion(j.address);
    } catch { return undefined; }
}

/**
 * Las direcciones de muchos puntos de una vez: primero lo guardado, después lo que falta.
 * Devuelve sólo los que tienen dirección, por la clave del punto (`claveDeLugar`).
 */
export async function direccionesDe(puntos: { lat: number; lon: number }[], o: { nuevasMax?: number } = {}): Promise<Map<string, string>> {
    const porClave = new Map<string, { lat: number; lon: number }>();
    for (const p of puntos) if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) porClave.set(claveDeLugar(p.lat, p.lon), p);
    const sabidas = new Map<string, string>();
    if (!porClave.size) return sabidas;
    const servicio = await servicioDeDirecciones();
    if (!servicio.url) return sabidas;
    const claves = [...porClave.keys()], vistas = new Set<string>();
    for (let i = 0; i < claves.length; i += 5000) {
        const filas = await prisma.geoDireccion.findMany({ where: { clave: { in: claves.slice(i, i + 5000) } }, select: { clave: true, texto: true } }).catch(() => []);
        for (const f of filas) { vistas.add(f.clave); if (f.texto) sabidas.set(f.clave, f.texto); }
    }
    const faltan = claves.filter((c) => !vistas.has(c)).slice(0, o.nuevasMax ?? NUEVAS_MAX);
    const url = faltan.length && Date.now() >= caidoHasta ? servicio.url : null;
    if (!url) return sabidas;

    const nuevas: { clave: string; texto: string; calle: string | null; barrio: string | null; ciudad: string | null }[] = [];
    let i = 0, cortar = false;
    const obrero = async () => {
        while (i < faltan.length && !cortar) {
            const clave = faltan[i++], p = porClave.get(clave)!;
            const d = await preguntarDireccion(url, p.lat, p.lon);
            if (d === undefined) { if (++fallas >= FALLAS_PARA_CAIDO) { caidoHasta = Date.now() + CAIDO_MS; cortar = true; } continue; }
            fallas = 0;
            nuevas.push({ clave, texto: d?.texto || "", calle: d?.calle || null, barrio: d?.barrio || null, ciudad: d?.ciudad || null });
            if (d?.texto) sabidas.set(clave, d.texto);
        }
    };
    await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, faltan.length) }, obrero));
    if (nuevas.length) await prisma.geoDireccion.createMany({ data: nuevas, skipDuplicates: true }).catch(() => { /* guardar es para la próxima: si falla, igual se contesta */ });
    return sabidas;
}

export async function direccionDe(lat: number | null | undefined, lon: number | null | undefined): Promise<string | null> {
    if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
    return (await direccionesDe([{ lat, lon }])).get(claveDeLugar(lat, lon)) || null;
}

/** ¿El servicio contesta? Para la pantalla donde se lo configura: se prueba con un punto del centro de Montevideo. */
export async function probarServicio(url: string): Promise<{ ok: boolean; ejemplo: string | null }> {
    const d = await preguntarDireccion(url, -34.9058, -56.1913);
    return { ok: d !== undefined, ejemplo: d?.texto || null };
}
