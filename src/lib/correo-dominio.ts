import { Resolver } from "node:dns/promises";

/**
 * ¿El dominio del remitente deja que este servidor mande en su nombre?
 *
 * Existe por lo que pasó el 21/11: la invitación de prueba del censo llegó a spam. No era el texto
 * ni el ritmo: el dominio del remitente tenía una política que manda a spam todo lo que no esté
 * autorizado (DMARC `p=quarantine`) y su lista de autorizados (SPF) no nombraba al servidor por el
 * que salíamos. Eso se ve en el DNS ANTES de mandar, y con 490 correos por salir no puede quedar
 * librado a que alguien se acuerde de mirarlo: la pantalla del censo lo dice sola.
 *
 * Acá hay dos mitades. `juzgarDominio` es pura —recibe lo que dice el DNS y opina— y es la que se
 * prueba. `revisarDominio` es la que pregunta.
 *
 * Sólo se sabe juzgar a Google (Gmail / Workspace), que es por donde sale hoy. Para otro proveedor
 * la respuesta es «no sé», que no es lo mismo que «está bien».
 */

export type DatosDns = {
    /** El registro SPF del dominio, o null si no tiene. */
    spf: string | null;
    /** Todo lo que el SPF trae adentro siguiendo sus `include:`, en un solo texto. */
    spfAbierto: string;
    /** El registro DMARC, o null si no tiene. */
    dmarc: string | null;
    /** Si está publicada la firma de Google con su selector habitual (`google`). */
    dkim: boolean;
    /** Falso si el DNS no contestó: ahí no se opina. */
    sePudo: boolean;
};

export type JuicioDominio = {
    estado: "bien" | "aviso" | "mal" | "no-se";
    dominio: string;
    /** Una frase: lo que va a pasar con los correos. */
    titulo: string;
    /** Por qué. */
    renglones: string[];
    /** Qué hay que cargar en el DNS para arreglarlo, listo para copiar. */
    arreglo: { donde: string; valor: string }[];
};

/** El dominio de «Nombre <alguien@dominio>». */
export function dominioDe(desde: string): string {
    const m = /<([^>]+)>/.exec(desde);
    const correo = (m ? m[1] : desde).trim();
    return correo.includes("@") ? correo.split("@").pop()!.toLowerCase() : "";
}

export const esGoogle = (host: string): boolean => /(^|\.)(gmail|google|googlemail)\.com$/i.test(host.trim());

/** `p=` del DMARC: qué pide el dominio que se haga con lo que no pasa. */
export function politicaDmarc(dmarc: string | null): "none" | "quarantine" | "reject" | null {
    const m = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(dmarc || "");
    return m ? (m[1].toLowerCase() as "none" | "quarantine" | "reject") : null;
}

/** El SPF con Google agregado, sin tocar lo que ya autorizaba. */
export function spfConGoogle(spf: string | null): string {
    if (!spf) return "v=spf1 include:_spf.google.com ~all";
    if (/include:_spf\.google\.com/i.test(spf)) return spf;
    return spf.replace(/^v=spf1\b/i, "v=spf1 include:_spf.google.com");
}

export function juzgarDominio({ desde, host, dns }: { desde: string; host: string; dns: DatosDns }): JuicioDominio {
    const dominio = dominioDe(desde);
    const base = { dominio, renglones: [] as string[], arreglo: [] as { donde: string; valor: string }[] };
    if (!dominio) return { ...base, estado: "no-se", titulo: "El remitente no tiene forma de correo." };
    /* Una casilla @gmail.com sale por Google con el dominio de Google: no hay nada que configurar. */
    if (/^(gmail|googlemail)\.com$/.test(dominio) && esGoogle(host)) return { ...base, estado: "bien", titulo: "Sale por Gmail con una casilla de Gmail: no hay nada que autorizar." };
    if (!esGoogle(host)) return { ...base, estado: "no-se", titulo: `No sé comprobar ${host || "este servidor"}: mandate una de prueba y fijate si llega a la bandeja de entrada.` };
    if (!dns.sePudo) return { ...base, estado: "no-se", titulo: `No pude consultar el DNS de ${dominio}. No es lo mismo que «está bien».` };

    const spfOk = /include:_spf\.google\.com/i.test(`${dns.spf || ""} ${dns.spfAbierto}`);
    const politica = politicaDmarc(dns.dmarc);
    const arregloSpf = { donde: `TXT de ${dominio}`, valor: spfConGoogle(dns.spf) };
    const arregloDkim = { donde: `TXT de google._domainkey.${dominio}`, valor: "La clave que da Google: consola de administración → Aplicaciones → Google Workspace → Gmail → Autenticar el correo → Generar registro, y después «Iniciar autenticación»." };

    if (spfOk && dns.dkim) return { ...base, estado: "bien", titulo: `${dominio} autoriza a Google a mandar en su nombre y firma los correos.` };

    if (!spfOk && !dns.dkim) {
        const renglones = [
            dns.spf ? `Su lista de autorizados (SPF) no nombra a Google: «${dns.spf}».` : "No tiene lista de autorizados (SPF).",
            "No tiene publicada la firma de Google (DKIM, selector «google»).",
            politica === "reject" ? "Y su política (DMARC) pide RECHAZAR lo que no esté autorizado."
                : politica === "quarantine" ? "Y su política (DMARC) pide mandar a spam lo que no esté autorizado."
                    : "No tiene una política que lo mande a spam, pero un correo sin ninguna de las dos cosas es el que los filtros apartan.",
        ];
        return {
            ...base, estado: "mal", renglones, arreglo: [arregloSpf, arregloDkim],
            titulo: politica === "reject" ? `Los correos de ${dominio} se van a rechazar.` : `Los correos de ${dominio} van a llegar a spam.`,
        };
    }
    if (spfOk) return {
        ...base, estado: "aviso", arreglo: [arregloDkim],
        titulo: `${dominio} autoriza a Google, pero los correos salen sin su firma.`,
        renglones: ["Llegan a la bandeja de entrada. Lo que puede fallar es un correo reenviado (de una casilla a otra): ahí la autorización se pierde y sólo la firma (DKIM) lo sostiene."],
    };
    return {
        ...base, estado: "aviso", arreglo: [arregloSpf],
        titulo: `${dominio} firma los correos, pero su lista de autorizados no nombra a Google.`,
        renglones: ["Con la firma alcanza para pasar. Agregar a Google a la lista (SPF) lo deja bien por los dos lados."],
    };
}

/* ---------- La mitad que pregunta ---------- */

const AUSENTE = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);
/** Los TXT de un nombre, cada uno en un solo texto. Lanza si el DNS no contestó; devuelve [] si el nombre no tiene. */
async function txt(r: Resolver, nombre: string): Promise<string[]> {
    try { return (await r.resolveTxt(nombre)).map((p) => p.join("")); }
    catch (e) { if (AUSENTE.has((e as NodeJS.ErrnoException).code || "")) return []; throw e; }
}

/** Sigue los `include:` del SPF hasta tres niveles y devuelve todo junto. Más hondo no hace falta para saber si nombra a Google. */
async function abrirSpf(r: Resolver, spf: string, nivel = 0, vistos = new Set<string>()): Promise<string> {
    if (nivel >= 3) return "";
    let todo = "";
    for (const m of spf.matchAll(/(?:include:|redirect=)([^\s]+)/gi)) {
        const n = m[1].toLowerCase();
        if (vistos.has(n) || vistos.size > 12) continue;
        vistos.add(n);
        const hijo = (await txt(r, n).catch(() => [])).find((t) => /^v=spf1\b/i.test(t)) || "";
        todo += ` include:${n} ${hijo} ${hijo ? await abrirSpf(r, hijo, nivel + 1, vistos) : ""}`;
    }
    return todo;
}

export async function consultarDns(dominio: string): Promise<DatosDns> {
    /* Un DNS que no contesta en dos segundos y medio no puede frenar la pantalla del censo. */
    const r = new Resolver({ timeout: 2500, tries: 1 });
    try {
        const [raiz, dmarc, dkim] = await Promise.all([txt(r, dominio), txt(r, `_dmarc.${dominio}`), txt(r, `google._domainkey.${dominio}`)]);
        const spf = raiz.find((t) => /^v=spf1\b/i.test(t)) || null;
        return {
            spf, spfAbierto: spf ? await abrirSpf(r, spf) : "",
            dmarc: dmarc.find((t) => /^v=DMARC1\b/i.test(t)) || null,
            dkim: dkim.some((t) => /p=[A-Za-z0-9+/]{20,}/.test(t)),
            sePudo: true,
        };
    } catch {
        return { spf: null, spfAbierto: "", dmarc: null, dkim: false, sePudo: false };
    }
}

const GUARDADO = new Map<string, { hasta: number; juicio: JuicioDominio }>();
/** Cinco minutos: el DNS no cambia de un clic al otro, y la lista del censo se pide seguido. */
const DURA_MS = 5 * 60_000;

/** Lo que la pantalla muestra. `fresco` saltea lo guardado: es el «volver a mirar» después de tocar el DNS. */
export async function revisarDominio(cfg: { desde: string; host: string }, fresco = false): Promise<JuicioDominio> {
    const dominio = dominioDe(cfg.desde);
    const llave = `${dominio}|${cfg.host}`;
    const hay = GUARDADO.get(llave);
    if (!fresco && hay && hay.hasta > Date.now()) return hay.juicio;
    const necesitaDns = !!dominio && esGoogle(cfg.host) && !/^(gmail|googlemail)\.com$/.test(dominio);
    const dns = necesitaDns ? await consultarDns(dominio) : { spf: null, spfAbierto: "", dmarc: null, dkim: false, sePudo: false };
    const juicio = juzgarDominio({ desde: cfg.desde, host: cfg.host, dns });
    // Un «no pude consultar» no se guarda: la próxima vez se vuelve a preguntar.
    if (juicio.estado !== "no-se" || !necesitaDns) GUARDADO.set(llave, { hasta: Date.now() + DURA_MS, juicio });
    return juicio;
}
