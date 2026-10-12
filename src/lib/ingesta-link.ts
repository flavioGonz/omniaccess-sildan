import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

/**
 * Traer una imagen desde un link, en el servidor: para sumar fotos de internet al conjunto sin
 * tener que bajarlas y volver a subirlas (lo pidió Nico el 12/10).
 *
 * Lo delicado es que el SERVIDOR hace el pedido, desde adentro de la red del barrio: un link a
 * http://127.0.0.1:9000 o a http://192.168.1.x sería una puerta a MinIO, a la base, a las
 * cámaras. Por eso:
 *  · sólo http y https, puertos 80/443 o el que diga el link si es público;
 *  · la dirección se valida en el `lookup` de la conexión misma — no antes con un dns.lookup
 *    aparte, que un DNS tramposo podría contestar distinto la segunda vez (DNS rebinding);
 *  · las redirecciones se siguen a mano (máx. REDIRECCIONES_MAX) y cada salto pasa por lo mismo;
 *  · se corta por tamaño mientras llega (no se confía en Content-Length) y por tiempo.
 *
 * Si el link es una PÁGINA y no una imagen (lo más común al copiar desde un buscador o una
 * tienda), se busca la imagen que la página declara para compartirse (og:image / twitter:image).
 * Y los links «envueltos» de los buscadores (imgres?imgurl=…, mediaurl=…) se desenvuelven.
 */

const TIEMPO_MS = 15_000;
const REDIRECCIONES_MAX = 4;
/** Lo mismo que una subida: una foto de celular pasa de 4 MB; más que esto no es una foto. */
export const LINK_MAX_BYTES = 15 * 1024 * 1024;
/** De una página sólo hace falta el <head> para encontrar og:image. */
const PAGINA_MAX_BYTES = 1.5 * 1024 * 1024;
/** Algunos CDN no le dan la imagen a un cliente sin nombre de navegador. */
const AGENTE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 OmniAccess";
/** Parámetros con los que los buscadores envuelven el link real de la imagen. */
const ENVOLTORIOS = ["imgurl", "mediaurl", "imgrefurl", "url", "u", "src", "image_url"];

export class LinkInvalido extends Error { }

/** ¿Es una dirección a la que el servidor NO tiene que ir? (privada, local, reservada) */
export function direccionPrivada(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
    }
    if (net.isIPv6(ip)) {
        const x = ip.toLowerCase();
        const v4 = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (v4) return direccionPrivada(v4[1]);
        return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
    }
    return true;
}

/** El lookup de cada conexión: resuelve y rechaza si alguna dirección es privada. */
const lookupSeguro: net.LookupFunction = (host, opciones, cb) => {
    dns.lookup(host, { ...(opciones as dns.LookupOptions), all: true }, (err, dirs) => {
        if (err) return (cb as any)(err);
        const lista = dirs as unknown as dns.LookupAddress[];
        const mala = lista.find((d) => direccionPrivada(d.address));
        if (mala || !lista.length) return (cb as any)(new LinkInvalido("Ese link apunta a una dirección interna: por seguridad el servidor no va ahí."));
        if ((opciones as any)?.all) return (cb as any)(null, lista);
        (cb as any)(null, lista[0].address, lista[0].family);
    });
};

/** Si el link es de un buscador que envuelve la imagen, el link de adentro. */
export function desenvolver(u: URL): URL {
    for (const k of ENVOLTORIOS) {
        const v = u.searchParams.get(k);
        if (v && /^https?:\/\//i.test(v)) { try { return new URL(v); } catch { /* no era un link */ } }
    }
    return u;
}

type Respuesta = { tipo: string; cuerpo: Buffer; final: URL };

function pedir(u: URL, tope: number, saltos = 0): Promise<Respuesta> {
    return new Promise((ok, mal) => {
        if (u.protocol !== "http:" && u.protocol !== "https:") return mal(new LinkInvalido("Sólo links http o https."));
        if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && direccionPrivada(u.hostname.replace(/^\[|\]$/g, ""))) return mal(new LinkInvalido("Ese link apunta a una dirección interna: por seguridad el servidor no va ahí."));
        const mod = u.protocol === "https:" ? https : http;
        const req = mod.get(u, { lookup: lookupSeguro, headers: { "user-agent": AGENTE, accept: "image/avif,image/webp,image/*,text/html;q=0.8,*/*;q=0.5" }, timeout: TIEMPO_MS }, (res) => {
            const codigo = res.statusCode || 0;
            if (codigo >= 300 && codigo < 400 && res.headers.location) {
                res.resume();
                if (saltos >= REDIRECCIONES_MAX) return mal(new LinkInvalido("El link redirige demasiadas veces."));
                let sig: URL;
                try { sig = new URL(res.headers.location, u); } catch { return mal(new LinkInvalido("El link redirige a algo que no es un link.")); }
                return pedir(sig, tope, saltos + 1).then(ok, mal);
            }
            if (codigo !== 200) { res.resume(); return mal(new LinkInvalido(`El sitio contestó ${codigo}${codigo === 403 ? ": no deja bajar la imagen desde otro lado" : ""}.`)); }
            const partes: Buffer[] = []; let n = 0;
            res.on("data", (c: Buffer) => {
                n += c.length;
                if (n > tope) { req.destroy(); mal(new LinkInvalido(tope === LINK_MAX_BYTES ? "La imagen pesa demasiado (más de 15 MB)." : "La página es demasiado grande para buscarle la imagen.")); return; }
                partes.push(c);
            });
            res.on("end", () => ok({ tipo: String(res.headers["content-type"] || "").toLowerCase(), cuerpo: Buffer.concat(partes), final: u }));
            res.on("error", mal);
        });
        req.on("timeout", () => req.destroy(new LinkInvalido("El sitio tardó demasiado en contestar.")));
        req.on("error", (e) => mal(e instanceof LinkInvalido ? e : new LinkInvalido(`No se pudo llegar al sitio (${(e as any).code || e.message}).`)));
    });
}

/** La imagen que una página declara para compartirse. */
function imagenDePagina(html: string, base: URL): URL | null {
    const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
    for (const clave of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
        for (const m of metas) {
            if (!new RegExp(`(?:property|name)=["']${clave.replace(/:/g, ":")}["']`, "i").test(m)) continue;
            const c = m.match(/content=["']([^"']+)["']/i)?.[1];
            if (c) { try { return new URL(c.replace(/&amp;/g, "&"), base); } catch { /* sigue */ } }
        }
    }
    const link = html.match(/<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (link) { try { return new URL(link, base); } catch { /* nada */ } }
    return null;
}

/**
 * Los bytes de la imagen de un link (o de la imagen principal de la página). Tira LinkInvalido
 * con un mensaje para la persona cuando no se puede.
 */
export async function imagenDeLink(texto: string): Promise<{ bytes: Buffer; desde: string }> {
    let u: URL;
    try { u = new URL(String(texto || "").trim()); } catch { throw new LinkInvalido("Eso no es un link."); }
    if (u.protocol === "data:") throw new LinkInvalido("Es una imagen incrustada (data:), no un link: copiá la imagen y pegala, o guardala y soltala.");
    u = desenvolver(u);
    const r = await pedir(u, LINK_MAX_BYTES);
    if (r.tipo.startsWith("image/")) return { bytes: r.cuerpo, desde: r.final.toString() };
    if (r.tipo.includes("html")) {
        const img = imagenDePagina(r.cuerpo.subarray(0, PAGINA_MAX_BYTES).toString("utf8"), r.final);
        if (!img) throw new LinkInvalido("Es una página sin imagen principal declarada: abrí la imagen sola (clic derecho › Abrir imagen) y copiá ese link.");
        const r2 = await pedir(img, LINK_MAX_BYTES);
        if (!r2.tipo.startsWith("image/")) throw new LinkInvalido("La página declara una imagen que no es una imagen.");
        return { bytes: r2.cuerpo, desde: r2.final.toString() };
    }
    // Sin tipo declarado: se prueba igual; si no es imagen, sharp lo dice al guardar.
    if (!r.tipo || r.tipo.includes("octet-stream")) return { bytes: r.cuerpo, desde: r.final.toString() };
    throw new LinkInvalido(`El link no es una imagen (es ${r.tipo.split(";")[0]}).`);
}
