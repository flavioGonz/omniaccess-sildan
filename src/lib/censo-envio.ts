import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getAppBranding } from "@/app/actions/settings";
import { CID_LOGO, LOGO_ALTO, LOGO_ANCHO, correoDeInvitacion, correoSirve, nuevaClave } from "@/lib/censo-invitaciones";
import { enviarCorreo } from "@/lib/correo";
import { administracionesParaCorreo, lotesDeInvitacion, remitenteDe, remitenteDeLotes, type Remitente } from "@/lib/correo-administracion";
import { ZONA } from "@/lib/fechas";
import { estimarFin, FALLAS_PARA_PAUSAR, leerGoteo, proximoEnvio, queToca, enHorario, type Goteo } from "@/lib/censo-goteo";

/**
 * Mandar las invitaciones del censo: una, y de a poco (ver censo-goteo.ts para el porqué).
 *
 * El envío de a poco no lo empuja el navegador de quien lo puso en marcha —si cierra la pestaña
 * se cortaría a la mitad— sino el servidor: el proceso de despachos llama a `vueltaDeGoteo` cada
 * medio minuto, y esa vuelta manda UNA si toca. El estado vive en el ajuste CENSO_GOTEO.
 */

const AJUSTE = "CENSO_GOTEO";
/** Con tres intentos fallidos una invitación se deja: su correo está mal, y reintentarla frena a las demás. */
export const INTENTOS_MAX = 3;

type Inv = { id: string; lote: string; lotes: unknown; nombre: string; email: string; clave: string };

/** La tinta de la marca: el fondo de la barra del correo y del logo que va sobre ella. */
const TINTA = "#0a0e14";
let logo: Promise<Buffer | null> | null = null;
/**
 * El logo que va en la cabecera del correo.
 *
 * Sale de `marca-omniaccess-v2.png`, que es el logo vigente (el mismo que marca los clips; ver
 * `claude/marca-omniaccess.md`), y no de un archivo propio del correo: un segundo archivo es la
 * forma de que un día queden dos épocas de la marca conviviendo, como pasó con el censo el 18/11.
 *
 * Se aplana sobre la tinta en vez de viajar transparente: si un programa de correo le saca el fondo
 * a la barra, un logo blanco transparente desaparece; aplanado se lee igual.
 *
 * `null` si no se pudo armar: el correo sale con la marca escrita, no deja de salir.
 */
export function logoDelCorreo(): Promise<Buffer | null> {
    logo ??= sharp(path.join(process.cwd(), "public", "marca-omniaccess-v2.png"))
        .trim()
        .resize(LOGO_ANCHO * 3, LOGO_ALTO * 3, { fit: "contain", background: TINTA })
        .flatten({ background: TINTA })
        .png({ compressionLevel: 9, palette: true })
        .toBuffer()
        .catch(() => { logo = null; return null; });
    return logo;
}

/**
 * Manda una invitación y anota en su fila cómo le fue, y desde qué cuenta salió.
 *
 * Sale desde la cuenta de la administración de sus lotes (lib/correo-administracion). Si esa
 * administración todavía no tiene cuenta, NO sale y no cuenta como intento: no es culpa del correo
 * de esa persona, y gastarle los tres intentos la dejaría afuera cuando la cuenta se cargue.
 */
export async function mandarInvitacion(inv: Inv, origen: string, remitente?: Remitente): Promise<{ ok: boolean; error?: string; sinCuenta?: boolean }> {
    const de = remitente || await remitenteDe(lotesDeInvitacion(inv.lotes));
    if (de.tipo === "sin-cuenta") return { ok: false, sinCuenta: true, error: `${de.nombre} todavía no tiene su cuenta de correo cargada (Administraciones › Correo).` };
    const [marca, imagen] = await Promise.all([getAppBranding(), logoDelCorreo()]);
    const { asunto, texto, html } = correoDeInvitacion({
        barrio: marca.barrio || marca.name, lote: inv.lote, nombre: inv.nombre || undefined,
        lotes: (Array.isArray(inv.lotes) ? (inv.lotes as { nombre?: unknown }[]) : []).map((l) => String(l?.nombre || "")).filter(Boolean),
        clave: inv.clave, url: `${origen}/registro/${inv.clave}`, conLogo: !!imagen,
    });
    const r = await enviarCorreo({ para: inv.email, asunto, texto, html, enLinea: imagen ? [{ cid: CID_LOGO, nombre: "omniaccess.png", contenido: imagen }] : undefined },
        { desde: de.tipo === "administracion" ? de.cuenta : null });
    if (r.ok) await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { enviadoAt: new Date(), enviadoDesde: r.desde || null, intentos: { increment: 1 }, error: null } });
    else await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { intentos: { increment: 1 }, error: r.error || "no se pudo" } });
    return r;
}

/**
 * La invitación de UNA persona del padrón, para mandársela desde su renglón (pedido de Nico, 21/11:
 * «en cada residente, un botón de enviarle la invitación al censo»).
 *
 * Si ya tiene una —la que le dejó el padrón— es ésa, con su clave: cambiársela dejaría sin efecto
 * el correo que ya recibió. Si no tiene (un residente cargado a mano), se le arma con sus lotes.
 * Sin correo o sin lote no hay invitación posible, y se dice cuál de las dos cosas falta.
 */
export async function invitacionDePersona(userId: string): Promise<{ inv: Inv } | { error: string }> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, unit: { select: { id: true, name: true } } } });
    if (!u) return { error: "Esa persona ya no está en el padrón." };
    const email = (u.email || "").trim().toLowerCase();
    if (!correoSirve(email)) return { error: `${u.name} no tiene un correo cargado: cargalo en su ficha y volvé a enviar.` };

    /* Sus lotes: los del padrón (puede tener varios) y, si no hay ninguno anotado ahí, su unidad. */
    const vinculos = await prisma.userUnidad.findMany({ where: { userId }, select: { vinculo: true, unit: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
    const lotes = vinculos.length
        ? vinculos.map((v) => ({ unitId: v.unit.id, nombre: v.unit.name, vinculo: v.vinculo }))
        : u.unit ? [{ unitId: u.unit.id, nombre: u.unit.name, vinculo: "PROPIETARIO" }] : [];

    let inv = await prisma.invitacionCenso.findFirst({ where: { sitio: "", userId } })
        ?? await prisma.invitacionCenso.findFirst({ where: { sitio: "", email } });
    if (!inv) {
        if (!lotes.length) return { error: `${u.name} no tiene ningún lote asignado: el censo carga los vehículos de un lote.` };
        const lote = lotes.map((l) => l.nombre).join(", ");
        // La clave es única: si justo sale una repetida, la base la rechaza y se prueba con otra.
        for (let vuelta = 0; vuelta < 5 && !inv; vuelta++) {
            inv = await prisma.invitacionCenso.create({ data: { sitio: "", email, nombre: u.name, lote, lotes, userId, clave: nuevaClave() } }).catch(() => null);
        }
        if (!inv) return { error: "No se pudo armar la invitación. Probá de nuevo." };
        return { inv };
    }
    /* La encontró por el correo y es de otra persona del padrón (dos que comparten casilla): va a
       la misma bandeja, así que se manda tal cual, sin pasarla de dueño ni cambiarle los lotes. */
    if (inv.userId && inv.userId !== userId) return { inv };
    /* Ya tenía. Se la pone al día con lo que el padrón dice hoy —el correo, si lo cambió; los lotes—
       y la clave no se toca. El correo sólo se cambia si no hay otra invitación con ese mismo. */
    const otra = inv.email !== email ? await prisma.invitacionCenso.findFirst({ where: { sitio: "", email, NOT: { id: inv.id } }, select: { id: true } }) : null;
    inv = await prisma.invitacionCenso.update({
        where: { id: inv.id },
        data: {
            userId, ...(inv.nombre ? {} : { nombre: u.name }),
            ...(inv.email !== email && !otra ? { email } : {}),
            ...(lotes.length ? { lotes, lote: lotes.map((l) => l.nombre).join(", ") } : {}),
        },
    });
    if (inv.email !== email) return { error: `Hay otra invitación con el correo ${email}: borrá la que sobra en Censo › Invitaciones.` };
    return { inv };
}

export async function leerGoteoGuardado(): Promise<Goteo> {
    return leerGoteo((await prisma.setting.findUnique({ where: { key: AJUSTE } }).catch(() => null))?.value);
}
export async function guardarGoteo(g: Goteo): Promise<void> {
    const value = JSON.stringify(g);
    await prisma.setting.upsert({ where: { key: AJUSTE }, create: { key: AJUSTE, value }, update: { value } });
}

/** Las que todavía se pueden mandar: sin enviar y sin haber fallado tres veces. */
const PENDIENTES = { enviadoAt: null, intentos: { lt: INTENTOS_MAX } } as const;

/** Cómo va cada cuenta: desde qué casilla sale cada grupo, cuántas faltan y cuántas salieron. */
export type EnvioPorCuenta = { administracionId: string | null; nombre: string; cuenta: string | null; lista: boolean; pendientes: number; enviadas: number };
export type EstadoGoteo = Goteo & { pendientes: number; conError: number; enHorario: boolean; terminaAt: string | null; porCuenta: EnvioPorCuenta[] };
export async function estadoDeGoteo(): Promise<EstadoGoteo> {
    const [g, pendientes, conError, todas, admins] = await Promise.all([
        leerGoteoGuardado(), prisma.invitacionCenso.count({ where: PENDIENTES }), prisma.invitacionCenso.count({ where: { enviadoAt: null, intentos: { gte: INTENTOS_MAX } } }),
        prisma.invitacionCenso.findMany({ where: { sitio: "" }, select: { lotes: true, enviadoAt: true, intentos: true } }),
        administracionesParaCorreo(),
    ]);
    const unidades = await prisma.unit.findMany({ where: { id: { in: [...new Set(todas.flatMap((i) => lotesDeInvitacion(i.lotes)))] } }, select: { id: true, administracionId: true } });
    const adminDeUnidad = new Map(unidades.map((u) => [u.id, u.administracionId]));
    const grupos = new Map<string, EnvioPorCuenta>();
    for (const i of todas) {
        const r = remitenteDeLotes(lotesDeInvitacion(i.lotes), adminDeUnidad, admins);
        const k = r.tipo === "general" ? "" : r.administracionId;
        if (!grupos.has(k)) grupos.set(k, r.tipo === "general"
            ? { administracionId: null, nombre: "Sin administración", cuenta: null, lista: true, pendientes: 0, enviadas: 0 }
            : { administracionId: r.administracionId, nombre: r.nombre, cuenta: admins.get(r.administracionId)?.correoCuenta || null, lista: r.tipo === "administracion", pendientes: 0, enviadas: 0 });
        const x = grupos.get(k)!;
        if (i.enviadoAt) x.enviadas++; else if (i.intentos < INTENTOS_MAX) x.pendientes++;
    }
    const ahora = new Date();
    return { ...g, pendientes, conError, enHorario: enHorario(g, ahora, ZONA), terminaAt: estimarFin(g, pendientes, ahora, ZONA)?.toISOString() || null,
        porCuenta: [...grupos.values()].sort((a, b) => (a.administracionId ? 0 : 1) - (b.administracionId ? 0 : 1) || a.nombre.localeCompare(b.nombre)) };
}

let enVuelta = false;
/** Una vuelta: manda UNA si toca. La llama el proceso de despachos cada medio minuto. */
export async function vueltaDeGoteo(): Promise<{ que: string; lote?: string; error?: string }> {
    if (enVuelta) return { que: "ocupado" };
    enVuelta = true;
    try {
        const g = await leerGoteoGuardado();
        const ahora = new Date();
        const que = queToca(g, ahora, ZONA);
        if (que !== "enviar") return { que };
        /* El orden es el de la clave, que es al azar: así no salen seguidos los dos del mismo lote
           ni toda una manzana en fila, y el orden no cambia entre una vuelta y la otra. */
        /* La primera que tenga desde dónde salir: las de una administración sin cuenta esperan, y
           las demás siguen (25/11: cada administración manda desde su casilla). */
        const pendientes = await prisma.invitacionCenso.findMany({ where: PENDIENTES, orderBy: { clave: "asc" } });
        const [admins, unidades] = await Promise.all([
            administracionesParaCorreo(),
            prisma.unit.findMany({ where: { id: { in: [...new Set(pendientes.flatMap((p) => lotesDeInvitacion(p.lotes)))] } }, select: { id: true, administracionId: true } }),
        ]);
        const adminDeUnidad = new Map(unidades.map((u) => [u.id, u.administracionId]));
        let remitente: Remitente | null = null;
        const sinCuenta = new Set<string>();
        const inv = pendientes.find((p) => {
            const r = remitenteDeLotes(lotesDeInvitacion(p.lotes), adminDeUnidad, admins);
            if (r.tipo === "sin-cuenta") { sinCuenta.add(r.nombre); return false; }
            remitente = r; return true;
        });
        if (!inv && sinCuenta.size) {
            await guardarGoteo({ ...g, activo: false, proximo: null, motivo: `Esperando las cuentas de correo de ${[...sinCuenta].join(", ")}: cargalas en Administraciones › Correo y volvé a ponerlo en marcha.` });
            return { que: "sin-cuenta" };
        }
        if (!inv) {
            const conError = await prisma.invitacionCenso.count({ where: { enviadoAt: null } });
            await guardarGoteo({ ...g, activo: false, proximo: null, fallas: 0, motivo: conError ? `Terminó. Quedaron ${conError} sin poder enviarse: mirá el motivo de cada una en la lista.` : "Terminó: se enviaron todas." });
            return { que: "terminado" };
        }
        if (!g.origen) { await guardarGoteo({ ...g, activo: false, motivo: "No se sabe con qué dirección armar los enlaces: volvé a ponerlo en marcha desde esta pantalla." }); return { que: "sin-origen" }; }
        /* El próximo se anota ANTES de mandar: si esta vuelta tarda, la siguiente no manda otro encima. */
        await guardarGoteo({ ...g, proximo: proximoEnvio(g, ahora).toISOString() });
        const r = await mandarInvitacion(inv, g.origen, remitente || undefined);
        const ahoraG = await leerGoteoGuardado();                 // pudieron pausarlo mientras se mandaba
        if (r.ok) { await guardarGoteo({ ...ahoraG, fallas: 0, motivo: null }); return { que: "enviado", lote: inv.lote }; }
        const fallas = ahoraG.fallas + 1;
        await guardarGoteo(fallas >= FALLAS_PARA_PAUSAR
            ? { ...ahoraG, activo: false, fallas, proximo: null, motivo: `Se frenó solo: ${fallas} envíos seguidos fallaron. El último dijo: «${r.error || "sin detalle"}».` }
            : { ...ahoraG, fallas });
        return { que: "fallo", lote: inv.lote, error: r.error };
    } finally { enVuelta = false; }
}
