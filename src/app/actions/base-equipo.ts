"use server";

import { prisma } from "@/lib/prisma";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { TIPOS_CARA } from "@/lib/caras-vivo";
import { contarBase, daFotos, guardaFotoDeCaras, listarPersonas, listarRostros, tarjetasDePagina, todasLasPersonas, todasLasTarjetas, type PersonaEquipo, type RostroEquipo } from "@/lib/rostros-equipo";
import { codigoRostro } from "@/lib/rostros";
import { imagenRostro } from "@/lib/rostros-servidor";

/**
 * La base local de un lector: qué tiene guardado adentro y cuánto de eso coincide con OmniAccess.
 *
 * Pedido de Nico (19/11): «tema lectura de rostros, base de datos locales de cada lector, logs,
 * registros, rostros».
 *
 * Lo que hace valiosa esta pantalla no es listar: es **el cruce**. Un lector con 417 personas
 * cargadas y un padrón con otras tantas son dos listas que nadie comparó nunca, y la pregunta que
 * importa —¿quién puede abrir esta puerta y no está en el sistema?— no se podía contestar sin
 * sentarse con las dos pantallas al lado. Acá cada persona del equipo dice si la conocemos.
 *
 * El cruce se hace por LEGAJO contra las credenciales del padrón, y si no, por nombre exacto. No
 * se adivina nada más: dos personas distintas con el mismo nombre existen, y marcar a una como la
 * otra sería peor que no marcar ninguna.
 */

export type PersonaDeBase = PersonaEquipo & {
    /**
     * El `FPID` de su cara en el equipo, cuando se pudo atar. Medido el 19/11: en el portero de
     * lab el FPID ES el legajo, pero en los dos equipos de producción las caras están cargadas con
     * identificadores propios (`414ad2`, `arquitecto1`) y sin nombre, así que **la mayoría de los
     * rostros no corresponde a ninguna persona de la lista**. Por eso esto es `null` y no una
     * suposición: pedir la foto de un FPID inventado devuelve 404 y la fila quedaría con un hueco
     * sin explicación.
     */
    fpid: string | null;
    /**
     * Tiene una cara cargada en la biblioteca del equipo con su legajo, se pueda bajar la foto o no
     * (24/11). Antes esto sólo se sabía si había foto, y en el terminal —que no guarda fotos— ninguna
     * persona figuraba con cara aunque el equipo la reconociera.
     */
    caraEnEquipo: boolean;
    /** El usuario del padrón que le corresponde, si lo hay. */
    padron: { id: string; nombre: string; unidad: string | null } | null;
    /** Cómo se encontró: por su legajo o por el nombre exacto. */
    porQue: "sincronizada" | "legajo" | "nombre" | null;
    /**
     * Los números de sus tarjetas, y de quién es cada una en el padrón (24/11). Una tarjeta cargada
     * en la puerta que en el padrón es de OTRA persona —o de nadie— es lo que hay que poder ver.
     */
    numeros: { numero: string; padron: { id: string; nombre: string } | null }[];
};

export type BaseEquipo = {
    equipo: { id: string; nombre: string; ip: string; tipo: string; marca: string };
    cuenta: Awaited<ReturnType<typeof contarBase>>;
    personas: PersonaDeBase[];
    total: number;
    desde: number;
    /** De la página traída: cuántas están en el padrón. */
    enPadron: number;
    /** Cuántas caras tiene la biblioteca del equipo, y cuántas se pudieron atar a esta página. */
    rostrosBiblioteca: number;
    rostrosAtados: number;
    error?: string;
};

export async function baseDelEquipo(deviceId: string, desde = 0): Promise<BaseEquipo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes("dispositivos")) throw new Error("Tu rol no puede ver los equipos.");

    const d = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, ip: true, deviceType: true, brand: true, username: true, password: true, authType: true, httpPort: true },
    });
    if (!d) throw new Error("Ese equipo no existe.");
    if (!TIPOS_CARA.includes(String(d.deviceType) as never)) throw new Error("Ese equipo no es un portero ni un control de acceso.");

    const cabecera = { id: d.id, nombre: d.name, ip: d.ip, tipo: String(d.deviceType), marca: String(d.brand) };
    if (String(d.brand) !== "HIKVISION") {
        return { equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false }, personas: [], total: 0, desde: 0, enPadron: 0, rostrosBiblioteca: 0, rostrosAtados: 0, error: "Por ahora sólo se lee la base de los equipos Hikvision." };
    }

    try {
        /* Las caras del equipo se piden una vez por carga para poder atarlas a su persona: el
           vínculo es FPID = legajo, y cuando no lo es (producción) no se ata nada. */
        const [cuenta, pagina, caras] = await Promise.all([
            contarBase(d), listarPersonas(d, desde),
            listarRostros(d).catch(() => ({ rostros: [] as RostroEquipo[], total: 0 })),
        ]);
        const numeros = await tarjetasDePagina(d, pagina.personas).catch(() => new Map<string, string[]>());
        const todas = [...numeros.values()].flat();
        const duenos = todas.length
            ? await prisma.credential.findMany({ where: { value: { in: todas } }, select: { value: true, user: { select: { id: true, name: true } } } }).catch(() => [])
            : [];
        const duenoDe = new Map(duenos.filter((c) => c.user).map((c) => [c.value, c.user!]));
        /* Y además hay que PODER bajar la foto: el terminal declara una URL por cara que después
           contesta 404, y algunos de sus FPID son números que coinciden con un legajo. Sin esta
           medición la fila mostraba una imagen rota por cada coincidencia casual. */
        const conFoto = caras.rostros.length ? await daFotos(d, caras.rostros) : false;
        const fpids = new Set(conFoto ? caras.rostros.map((r) => r.fpid) : []);
        const enBiblioteca = new Set(caras.rostros.map((r) => r.fpid));

        /* El cruce con el padrón: primero por legajo contra las credenciales (es lo que el equipo
           usa para identificar), y si no hay, por nombre exacto. */
        const legajos = pagina.personas.map((x) => x.legajo).filter(Boolean);
        const nombres = pagina.personas.map((x) => (x.nombre || "").trim()).filter((x) => x.length > 1);
        const [porLegajo, porCred, porNombre] = await Promise.all([
            legajos.length
                ? prisma.user.findMany({ where: { legajoEquipos: { in: legajos } }, select: { id: true, name: true, apartment: true, legajoEquipos: true } }).catch(() => [])
                : Promise.resolve([]),
            legajos.length
                ? prisma.credential.findMany({ where: { value: { in: legajos } }, select: { value: true, user: { select: { id: true, name: true, apartment: true } } } }).catch(() => [])
                : Promise.resolve([]),
            nombres.length
                ? prisma.user.findMany({ where: { name: { in: nombres } }, select: { id: true, name: true, apartment: true } }).catch(() => [])
                : Promise.resolve([]),
        ]);
        const mapaLegajo = new Map(porLegajo.map((u) => [u.legajoEquipos!, u]));
        const mapaCred = new Map(porCred.filter((c) => c.user).map((c) => [c.value, c.user!]));
        const mapaNombre = new Map(porNombre.map((u) => [u.name, u]));

        const personas: PersonaDeBase[] = pagina.personas.map((x) => {
            /* En orden de confianza: el número con el que NOSOTROS la cargamos, después una
               credencial del padrón con ese valor, y recién al final el nombre exacto. */
            const porNuestro = mapaLegajo.get(x.legajo);
            const porCredencial = !porNuestro ? mapaCred.get(x.legajo) : undefined;
            const porNom = !porNuestro && !porCredencial && x.nombre ? mapaNombre.get(x.nombre.trim()) : undefined;
            const u = porNuestro || porCredencial || porNom;
            return {
                ...x,
                fpid: fpids.has(x.legajo) ? x.legajo : null,
                caraEnEquipo: enBiblioteca.has(x.legajo) || x.rostros > 0,
                padron: u ? { id: u.id, nombre: u.name, unidad: u.apartment || null } : null,
                porQue: porNuestro ? "sincronizada" : porCredencial ? "legajo" : porNom ? "nombre" : null,
                numeros: (numeros.get(x.legajo) || []).map((n) => ({ numero: n, padron: duenoDe.get(n) ? { id: duenoDe.get(n)!.id, nombre: duenoDe.get(n)!.name } : null })),
            };
        });

        return {
            equipo: cabecera, cuenta, personas, total: pagina.total, desde,
            enPadron: personas.filter((x) => x.padron).length,
            rostrosBiblioteca: caras.total || caras.rostros.length,
            rostrosAtados: personas.filter((x) => x.caraEnEquipo).length,
        };
    } catch (e) {
        return {
            equipo: cabecera, cuenta: { personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false },
            personas: [], total: 0, desde: 0, enPadron: 0, rostrosBiblioteca: 0, rostrosAtados: 0,
            error: e instanceof Error ? e.message.slice(0, 200) : "No se pudo leer la base del equipo",
        };
    }
}

/* ── La base entera, para el bento con barra lateral (25/11) ─────────────────────────────── */

/**
 * Nico, sobre la base de los lectores: «necesita mucho trabajo de organización de la info: las cards
 * y rostros deben ser un bloque solo cuando el rostro (usuario) tiene tarjeta asociada… la idea es
 * que esta página no tenga tanto scroll, agrupar mejor la info».
 *
 * Eso no se puede de a 30: la persona, su cara y sus tarjetas vienen de tres listas distintas del
 * equipo, y de a páginas una cara de la página 9 aparecía suelta, sin su persona. Medido el 25/11 en
 * el lab: las 71 caras del terminal y las 66 del portero son TODAS de una persona de su lista (el
 * FPID es el legajo), 15 y 10 de ellas con tarjeta. Traer todo cuesta 7 s en el terminal y unos 9 s
 * en el portero (personas, tarjetas y caras a la vez); se guarda cinco minutos y «Volver a leer» lo
 * trae de nuevo.
 */
export type TarjetaDeBase = { numero: string; padron: { id: string; nombre: string } | null };
export type PersonaCompleta = {
    legajo: string; nombre: string | null; tipo: string | null; vence: string | null; huellas: number;
    tarjetas: TarjetaDeBase[];
    /** Tiene cara en la biblioteca del equipo; `foto`: el equipo la entrega para verla. */
    cara: boolean; foto: boolean;
    padron: { id: string; nombre: string; unidad: string | null; cara: string | null } | null;
    porQue: "sincronizada" | "legajo" | "nombre" | null;
};
export type BaseCompleta = {
    equipo: { id: string; nombre: string; ip: string; tipo: string; marca: string };
    personas: PersonaCompleta[];
    tarjetas: number; caras: number;
    huellas: boolean; bitacora: boolean;
    /** El equipo guarda la foto de las caras (null: no tiene ese ajuste). */
    guardaFotos: boolean | null;
    leido: string;
    error?: string;
};

const BASE_MS = 5 * 60_000;
const bases = new Map<string, { t: number; r: Promise<BaseCompleta> }>();

async function sesionDispositivos() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    const permisos = s ? permisosDeSesion(s) : [];
    if (!permisos.includes("dispositivos")) throw new Error("Tu rol no puede ver los equipos.");
    return permisos;
}

export async function baseCompleta(deviceId: string, forzar = false): Promise<BaseCompleta> {
    await sesionDispositivos();
    const ya = bases.get(deviceId);
    if (!forzar && ya && Date.now() - ya.t < BASE_MS) return ya.r;
    const r = leerBaseCompleta(deviceId);
    bases.set(deviceId, { t: Date.now(), r });
    r.then((x) => { if (x.error) bases.delete(deviceId); }).catch(() => bases.delete(deviceId));
    return r;
}

async function leerBaseCompleta(deviceId: string): Promise<BaseCompleta> {
    const d = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, name: true, ip: true, deviceType: true, brand: true, username: true, password: true, authType: true, httpPort: true },
    });
    if (!d) throw new Error("Ese equipo no existe.");
    if (!TIPOS_CARA.includes(String(d.deviceType) as never)) throw new Error("Ese equipo no es un portero ni un control de acceso.");
    const equipo = { id: d.id, nombre: d.name, ip: d.ip, tipo: String(d.deviceType), marca: String(d.brand) };
    const vacia = (error: string): BaseCompleta => ({ equipo, personas: [], tarjetas: 0, caras: 0, huellas: false, bitacora: false, guardaFotos: null, leido: new Date().toISOString(), error });
    if (String(d.brand) !== "HIKVISION") return vacia("Por ahora sólo se lee la base de los equipos Hikvision.");
    try {
        /* Las tres listas a la vez: son pedidos distintos del equipo y así tarda lo que la más larga. */
        const [personas, numeros, biblioteca, cuenta, guarda] = await Promise.all([
            todasLasPersonas(d), todasLasTarjetas(d),
            listarRostros(d).catch(() => ({ rostros: [] as RostroEquipo[], total: 0 })),
            contarBase(d).catch(() => ({ personas: null, tarjetas: null, rostros: null, bitacora: false, huellas: false })),
            guardaFotoDeCaras(d),
        ]);
        const conFoto = biblioteca.rostros.length ? await daFotos(d, biblioteca.rostros) : false;
        const caras = new Set(biblioteca.rostros.map((r) => r.fpid));

        /* El cruce con el padrón, de toda la base de una vez. Mismo orden de confianza que la página:
           el número con que OmniAccess la cargó, una credencial con su legajo, el nombre exacto. */
        const legajos = personas.map((x) => x.legajo).filter(Boolean);
        const nombres = [...new Set(personas.map((x) => (x.nombre || "").trim()).filter((x) => x.length > 1))];
        const todas = [...numeros.values()].flat();
        const sel = { id: true, name: true, apartment: true, cara: true } as const;
        const [porLegajo, porCred, porNombre, duenos] = await Promise.all([
            prisma.user.findMany({ where: { legajoEquipos: { in: legajos } }, select: { ...sel, legajoEquipos: true } }).catch(() => []),
            prisma.credential.findMany({ where: { value: { in: legajos } }, select: { value: true, user: { select: sel } } }).catch(() => []),
            nombres.length ? prisma.user.findMany({ where: { name: { in: nombres } }, select: sel }).catch(() => []) : Promise.resolve([]),
            todas.length ? prisma.credential.findMany({ where: { value: { in: todas } }, select: { value: true, user: { select: { id: true, name: true } } } }).catch(() => []) : Promise.resolve([]),
        ]);
        const mapaLegajo = new Map(porLegajo.map((u) => [u.legajoEquipos!, u]));
        const mapaCred = new Map(porCred.filter((c) => c.user).map((c) => [c.value, c.user!]));
        const mapaNombre = new Map(porNombre.map((u) => [u.name, u]));
        const duenoDe = new Map(duenos.filter((c) => c.user).map((c) => [c.value, c.user!]));

        const lista: PersonaCompleta[] = personas.map((x) => {
            const nuestro = mapaLegajo.get(x.legajo);
            const cred = !nuestro ? mapaCred.get(x.legajo) : undefined;
            const nom = !nuestro && !cred && x.nombre ? mapaNombre.get(x.nombre.trim()) : undefined;
            const u = nuestro || cred || nom;
            const tieneCara = caras.has(x.legajo) || x.rostros > 0;
            return {
                legajo: x.legajo, nombre: x.nombre, tipo: x.tipo, vence: x.vence, huellas: x.huellas,
                tarjetas: (numeros.get(x.legajo) || []).map((n) => ({ numero: n, padron: duenoDe.get(n) ? { id: duenoDe.get(n)!.id, nombre: duenoDe.get(n)!.name } : null })),
                cara: tieneCara, foto: tieneCara && conFoto && caras.has(x.legajo),
                padron: u ? { id: u.id, nombre: u.name, unidad: u.apartment || null, cara: u.cara || null } : null,
                porQue: nuestro ? "sincronizada" : cred ? "legajo" : nom ? "nombre" : null,
            };
        });
        return {
            equipo, personas: lista, tarjetas: todas.length, caras: biblioteca.rostros.length,
            huellas: cuenta.huellas, bitacora: cuenta.bitacora, guardaFotos: conFoto ? true : guarda, leido: new Date().toISOString(),
        };
    } catch (e) {
        return vacia(e instanceof Error ? e.message.slice(0, 200) : "No se pudo leer la base del equipo");
    }
}

/* ── La barra lateral: los lectores y las cámaras que miran caras ────────────────────────── */

export type FuenteLector = { id: string; nombre: string; tipo: string; ip: string; marca: string;
    /** Lo de la última lectura de su base, si está guardada: para no preguntarle al equipo sólo por dibujar la barra. */
    leida: { personas: number; caras: number; tarjetas: number; leido: string } | null };
export type FuenteCamara = { id: string; nombre: string; tipo: string; pasadas: number; personas: number; ultima: string | null };

/**
 * Las fuentes de caras de la instalación: los lectores (con su base adentro) y las cámaras donde
 * OmniVision mira caras (Ajustes › FACE_CAMARAS), con lo que vieron en 30 días. Lo de las cámaras sale
 * de la base de OmniAccess, sin tocar ningún equipo.
 */
export async function fuentesDeRostros(): Promise<{ lectores: FuenteLector[]; camaras: FuenteCamara[]; verCamaras: boolean }> {
    const permisos = await sesionDispositivos();
    const lectores = await prisma.device.findMany({
        where: { deviceType: { in: TIPOS_CARA as unknown as string[] } as never },
        select: { id: true, name: true, ip: true, deviceType: true, brand: true }, orderBy: { name: "asc" },
    });
    const conLeida: FuenteLector[] = await Promise.all(lectores.map(async (l) => {
        const c = bases.get(l.id);
        const b = c && Date.now() - c.t < BASE_MS ? await Promise.race([c.r, Promise.resolve(null)]) : null;
        return { id: l.id, nombre: l.name, tipo: String(l.deviceType), ip: l.ip, marca: String(l.brand),
            leida: b && !b.error ? { personas: b.personas.length, caras: b.caras, tarjetas: b.tarjetas, leido: b.leido } : null };
    }));
    const verCamaras = permisos.includes("vision") || permisos.includes("rostros") || permisos.includes("historial");
    if (!verCamaras) return { lectores: conLeida, camaras: [], verCamaras };
    const ids = await prisma.setting.findUnique({ where: { key: "FACE_CAMARAS" } }).then((s) => { try { const v = JSON.parse(s?.value || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }).catch(() => [] as string[]);
    if (!ids.length) return { lectores: conLeida, camaras: [], verCamaras };
    const [devs, cuentas] = await Promise.all([
        prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, deviceType: true } }),
        prisma.$queryRaw<{ d: string; n: number; p: number; u: Date | null }[]>`
            select "deviceId" as d, count(*)::int as n, count(distinct "rostroId")::int as p, max(cuando) as u
            from "RostroPasada" where "deviceId" = any(${ids}::text[]) and cuando > now() - interval '30 days' group by 1`.catch(() => []),
    ]);
    const porId = new Map(cuentas.map((c) => [c.d, c]));
    const camaras = devs.map((c) => ({ id: c.id, nombre: c.name, tipo: String(c.deviceType), pasadas: porId.get(c.id)?.n || 0, personas: porId.get(c.id)?.p || 0, ultima: porId.get(c.id)?.u?.toISOString() || null }))
        .sort((a, b) => b.personas - a.personas || a.nombre.localeCompare(b.nombre));
    return { lectores: conLeida, camaras, verCamaras };
}

export type DeteccionDeCamara = { rostroId: string; codigo: string; nombre: string | null; foto: string | null; veces: number; aca: number; ultima: string; registrado: boolean };

/**
 * Las caras que vio una cámara en los últimos días: una por identidad, con cuántas veces pasó por
 * esa cámara y cuándo fue la última. Son las detecciones que Nico quiere en el mismo bento.
 */
export async function deteccionesDeCamara(deviceId: string, dias = 30): Promise<{ total: number; detecciones: DeteccionDeCamara[] }> {
    const permisos = await sesionDispositivos();
    if (!(permisos.includes("vision") || permisos.includes("rostros") || permisos.includes("historial"))) throw new Error("Tu rol no puede ver las caras capturadas.");
    const desde = new Date(Date.now() - Math.max(1, Math.min(90, dias)) * 86_400_000);
    const filas = await prisma.$queryRaw<{ r: string; n: number; u: Date }[]>`
        select "rostroId" as r, count(*)::int as n, max(cuando) as u from "RostroPasada"
        where "deviceId" = ${deviceId} and cuando >= ${desde} group by 1 order by u desc limit 400`;
    const rostros = await prisma.rostro.findMany({ where: { id: { in: filas.map((f) => f.r) } }, select: { id: true, numero: true, apodo: true, foto: true, veces: true, userId: true } });
    const usuarios = await prisma.user.findMany({ where: { id: { in: rostros.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const nombreDe = new Map(usuarios.map((u) => [u.id, u.name]));
    const porId = new Map(rostros.map((r) => [r.id, r]));
    const detecciones = filas.flatMap((f) => {
        const r = porId.get(f.r);
        if (!r) return [];
        return [{ rostroId: r.id, codigo: codigoRostro(r.numero), nombre: (r.userId && nombreDe.get(r.userId)) || r.apodo || null, foto: imagenRostro(r.foto), veces: r.veces, aca: f.n, ultima: f.u.toISOString(), registrado: !!r.userId }];
    });
    return { total: detecciones.length, detecciones };
}
