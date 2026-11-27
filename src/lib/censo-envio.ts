import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getAppBranding } from "@/app/actions/settings";
import { CID_LOGO, LOGO_ALTO, LOGO_ANCHO, correoDeInvitacion, correoSirve } from "@/lib/censo-invitaciones";
import { enviarCorreo } from "@/lib/correo";
import { administracionesParaCorreo, lotesDeInvitacion, remitenteDe, remitenteDeLotes, type Remitente } from "@/lib/correo-administracion";
import { ZONA } from "@/lib/fechas";
import { sincronizarCopiasCenso, sincronizarInvitacionesPorLote } from "@/lib/censo-por-lote-servidor";
import { esOrigenLocal, origenPublico } from "@/lib/origen-publico";
import { readFile } from "node:fs/promises";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";
import { enHorario, esTopeDeGmail, estimarFin, FALLAS_PARA_PAUSAR, inicioDelDia, leerGoteo, mananaAlArranque, proximoEnvio, queToca, TOPE_DIARIO_POR_CUENTA, type Goteo } from "@/lib/censo-goteo";

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

/**
 * Lo que se manda: la invitación del lote (a su principal) o una copia del mismo código a otro
 * residente del lote (`copia`: el id de la fila de CopiaCenso; 25/11, «a todos los residentes»).
 */
type Inv = { id: string; lote: string; lotes: unknown; nombre: string; email: string; clave: string; copia?: string; recordatorio?: boolean; novedad?: boolean };

/** Una copia pendiente, con lo de su invitación, en la forma de lo que se manda. */
type CopiaConInv = { id: string; email: string; nombre: string; invitacion: { id: string; lote: string; lotes: unknown; clave: string } };
const comoEnvio = (c: CopiaConInv): Inv => ({ id: c.invitacion.id, lote: c.invitacion.lote, lotes: c.invitacion.lotes, clave: c.invitacion.clave, nombre: c.nombre, email: c.email, copia: c.id });
const CON_INV = { invitacion: { select: { id: true, lote: true, lotes: true, clave: true } } } as const;

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
/**
 * El manual del residente en PDF, que va adjunto en cada correo del censo (27/11, Nico: «el manual
 * debés adjuntarlo en los correos de censo, así tiene completo todo»). Vive en public/ (también se
 * baja desde el portal). Si falta, el correo sale igual, sin adjunto: no frena el envío.
 */
export const MANUAL_NOMBRE = "Manual del residente - OmniAccess.pdf";
let manual: Promise<Buffer | null> | null = null;
export function manualDelResidente(): Promise<Buffer | null> {
    manual ??= readFile(path.join(process.cwd(), "public", "manual-residente-omniaccess.pdf")).catch(() => { manual = null; return null; });
    return manual;
}

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
    /* Un enlace que sólo existe adentro del servidor no se manda (25/11: salieron con https://localhost:10001). */
    if (esOrigenLocal(origen)) return { ok: false, error: `La dirección de los enlaces (${origen}) no es pública: cargá la URL pública en Ajustes.` };
    const de = remitente || await remitenteDe(lotesDeInvitacion(inv.lotes));
    if (de.tipo === "sin-cuenta") return { ok: false, sinCuenta: true, error: `${de.nombre} todavía no tiene su cuenta de correo cargada (Administraciones › Correo).` };
    const [marca, imagen, pdf, ajustes] = await Promise.all([getAppBranding(), logoDelCorreo(), manualDelResidente(), leerAjustesVisitas().catch(() => null)]);
    const { asunto, texto, html } = correoDeInvitacion({
        barrio: marca.barrio || marca.name, lote: inv.lote, nombre: inv.nombre || undefined,
        lotes: (Array.isArray(inv.lotes) ? (inv.lotes as { nombre?: unknown }[]) : []).map((l) => String(l?.nombre || "")).filter(Boolean),
        clave: inv.clave, url: `${origen}/registro/${inv.clave}${inv.copia ? `?de=${encodeURIComponent(inv.copia)}` : ""}`, conLogo: !!imagen, recordatorio: !!inv.recordatorio, novedad: !!inv.novedad,
        altaDirecta: ajustes?.modo === "ABIERTO", conManual: !!pdf,
    });
    const r = await enviarCorreo({ para: inv.email, asunto, texto, html, enLinea: imagen ? [{ cid: CID_LOGO, nombre: "omniaccess.png", contenido: imagen }] : undefined,
        adjuntos: pdf ? [{ nombre: MANUAL_NOMBRE, contenido: pdf, tipo: "application/pdf" }] : undefined },
        { desde: de.tipo === "administracion" ? de.cuenta : null });
    const anota = r.ok ? { enviadoAt: new Date(), enviadoDesde: r.desde || null, intentos: { increment: 1 }, error: null } : { intentos: { increment: 1 }, error: r.error || "no se pudo" };
    if (inv.copia) await prisma.copiaCenso.update({ where: { id: inv.copia }, data: anota });
    else await prisma.invitacionCenso.update({ where: { id: inv.id }, data: anota });
    return r;
}

/**
 * Las invitaciones que le tocan a UNA persona del padrón, para mandárselas desde su renglón (pedido
 * de Nico, 21/11: «en cada residente, un botón de enviarle la invitación al censo»).
 *
 * Desde el 25/11 el código es POR LOTE y le llega a la persona principal de cada lote (ver
 * lib/censo-por-lote). Se ponen al día los lotes de esta persona y se devuelven las invitaciones de
 * los lotes donde ella es la principal: una por lote. Si no es la principal de ninguno, se dice a
 * quién le llega el de su lote.
 */
export async function invitacionesDePersona(userId: string): Promise<{ invs: Inv[] } | { error: string }> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, unitId: true } });
    if (!u) return { error: "Esa persona ya no está en el padrón." };
    if (!correoSirve((u.email || "").trim().toLowerCase())) return { error: `${u.name} no tiene un correo cargado: cargalo en su ficha y volvé a enviar.` };
    const lotes = [...new Set([...(await prisma.userUnidad.findMany({ where: { userId }, select: { unitId: true } })).map((v) => v.unitId)])];
    if (!lotes.length) return { error: `${u.name} no está anotada en ningún lote: el censo carga los vehículos de un lote.` };
    await sincronizarInvitacionesPorLote({ simulacro: false, soloLotes: lotes });
    await sincronizarCopiasCenso({ soloLotes: lotes });
    /* Las de los lotes donde es la principal, y la copia del código de cada otro lote suyo (25/11: a todos). */
    const [invs, copias] = await Promise.all([
        prisma.invitacionCenso.findMany({ where: { sitio: "", unitId: { in: lotes }, userId } }),
        prisma.copiaCenso.findMany({ where: { userId, invitacion: { sitio: "", unitId: { in: lotes } } }, select: { id: true, email: true, nombre: true, ...CON_INV } }),
    ]);
    if (invs.length || copias.length) return { invs: [...invs, ...copias.map(comoEnvio)] };
    const deOtro = await prisma.invitacionCenso.findFirst({ where: { sitio: "", unitId: { in: lotes } }, select: { lote: true, nombre: true, email: true } });
    return { error: deOtro ? `El código de ${deOtro.lote} le llega a ${deOtro.nombre || deOtro.email}, que es la persona principal del lote. Se cambia en el cajón del lote.` : `Ninguno de los lotes de ${u.name} tiene a quién mandarle el código.` };
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

/**
 * A quiénes les toca el recordatorio pedido a la hora `desde` (ver Goteo.recordar): mandadas antes
 * de esa hora, sin error, y de un lote donde NADIE cargó todavía. Por lote y no por persona: si el
 * dueño ya completó el censo, recordarle a la esposa que lo complete es correo de más. Un
 * recordatorio que falla queda con su error y no se reintenta solo (como las invitaciones).
 */
const nadieCargo = { usadoAt: null, copias: { none: { usadoAt: { not: null } } } } as const;
/* Con «todos» (27/11, reenvío a todos) no se filtra por lote: el que ya cargó recibe la novedad. */
const porRecordarInv = (desde: Date, todos = false) => ({ sitio: "", enviadoAt: { lt: desde }, error: null, ...(todos ? {} : nadieCargo) });
const porRecordarCopia = (desde: Date, todos = false) => ({ enviadoAt: { lt: desde }, error: null, ...(todos ? {} : { usadoAt: null, invitacion: { sitio: "", ...nadieCargo } }), ...(todos ? { invitacion: { sitio: "" } } : {}) });
/** Cuántos recibirían el segundo correo pedido a la hora `desde` (ahora, si no hay uno en marcha). */
export async function contarPorRecordar(desde: Date, todos = false): Promise<number> {
    const [a, b] = await Promise.all([prisma.invitacionCenso.count({ where: porRecordarInv(desde, todos) }), prisma.copiaCenso.count({ where: porRecordarCopia(desde, todos) })]);
    return a + b;
}
/** Las invitaciones de lotes donde alguien ya cargó: a esos les va la novedad, no el recordatorio. */
async function invitacionesConCarga(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const f = await prisma.invitacionCenso.findMany({ where: { id: { in: ids }, OR: [{ usadoAt: { not: null } }, { copias: { some: { usadoAt: { not: null } } } }] }, select: { id: true } });
    return new Set(f.map((x) => x.id));
}

/** Cómo va cada cuenta: desde qué casilla sale cada grupo, cuántas faltan y cuántas salieron. */
export type EnvioPorCuenta = {
    administracionId: string | null; nombre: string; cuenta: string | null; lista: boolean; pendientes: number; enviadas: number;
    /** Cuántas salieron hoy desde esta casilla, contra el tope diario; y si Gmail la frenó, hasta cuándo descansa. */
    hoy: number; tope: number; frenadaHasta: string | null;
};
/** Cuántas salieron hoy desde cada casilla (en la hora del barrio). */
async function enviadasHoyPorCuenta(ahora: Date): Promise<Map<string, number>> {
    const where = { enviadoAt: { gte: inicioDelDia(ahora, ZONA) }, enviadoDesde: { not: null } };
    const [a, b] = await Promise.all([
        prisma.invitacionCenso.groupBy({ by: ["enviadoDesde"], where, _count: { _all: true } }),
        prisma.copiaCenso.groupBy({ by: ["enviadoDesde"], where, _count: { _all: true } }),   // las copias salen de la misma casilla y cuentan para su tope
    ]);
    const m = new Map<string, number>();
    for (const f of [...a, ...b]) { const k = String(f.enviadoDesde).toLowerCase(); m.set(k, (m.get(k) || 0) + f._count._all); }
    return m;
}
export type EstadoGoteo = Goteo & { pendientes: number; conError: number; enHorario: boolean; terminaAt: string | null; porCuenta: EnvioPorCuenta[];
    /** Cuántos no completaron: los que recibirían el recordatorio ahora, o los que le quedan al que está en marcha. */
    porRecordar: number;
    /** Cuántos recibirían el reenvío a todos (ya cargaron o no): los que le quedan si está en marcha. */
    porRecordarTodos: number };
export async function estadoDeGoteo(): Promise<EstadoGoteo> {
    const [g, pi, pc, ei, ec, invs, copias, admins] = await Promise.all([
        leerGoteoGuardado(),
        prisma.invitacionCenso.count({ where: PENDIENTES }), prisma.copiaCenso.count({ where: PENDIENTES }),
        prisma.invitacionCenso.count({ where: { enviadoAt: null, intentos: { gte: INTENTOS_MAX } } }), prisma.copiaCenso.count({ where: { enviadoAt: null, intentos: { gte: INTENTOS_MAX } } }),
        prisma.invitacionCenso.findMany({ where: { sitio: "" }, select: { lotes: true, enviadoAt: true, intentos: true } }),
        prisma.copiaCenso.findMany({ select: { enviadoAt: true, intentos: true, invitacion: { select: { lotes: true } } } }),
        administracionesParaCorreo(),
    ]);
    /* Las copias (25/11, a todos) cuentan en cada casilla igual que las invitaciones: salen de la misma. */
    const corte = g.recordar ? new Date(g.recordar) : new Date();
    const [porRecordar, porRecordarTodos] = await Promise.all([contarPorRecordar(corte), contarPorRecordar(corte, true)]);
    const pendientes = pi + pc + (g.recordar ? (g.recordarA === "todos" ? porRecordarTodos : porRecordar) : 0), conError = ei + ec;
    const todas = [...invs, ...copias.map((c) => ({ lotes: c.invitacion.lotes, enviadoAt: c.enviadoAt, intentos: c.intentos }))];
    const ahora = new Date();
    const [unidades, hoy] = await Promise.all([
        prisma.unit.findMany({ where: { id: { in: [...new Set(todas.flatMap((i) => lotesDeInvitacion(i.lotes)))] } }, select: { id: true, administracionId: true } }),
        enviadasHoyPorCuenta(ahora),
    ]);
    const adminDeUnidad = new Map(unidades.map((u) => [u.id, u.administracionId]));
    const grupos = new Map<string, EnvioPorCuenta>();
    for (const i of todas) {
        const r = remitenteDeLotes(lotesDeInvitacion(i.lotes), adminDeUnidad, admins);
        const k = r.tipo === "general" ? "" : r.administracionId;
        if (!grupos.has(k)) {
            const cuenta = r.tipo === "general" ? null : admins.get(r.administracionId)?.correoCuenta || null;
            const frenada = cuenta ? g.frenadas[cuenta.toLowerCase()] : undefined;
            grupos.set(k, r.tipo === "general"
                ? { administracionId: null, nombre: "Sin administración", cuenta: null, lista: true, pendientes: 0, enviadas: 0, hoy: 0, tope: 0, frenadaHasta: null }
                : { administracionId: r.administracionId, nombre: r.nombre, cuenta, lista: r.tipo === "administracion", pendientes: 0, enviadas: 0,
                    hoy: cuenta ? hoy.get(cuenta.toLowerCase()) || 0 : 0, tope: TOPE_DIARIO_POR_CUENTA, frenadaHasta: frenada && Date.parse(frenada) > ahora.getTime() ? frenada : null });
        }
        const x = grupos.get(k)!;
        if (i.enviadoAt) x.enviadas++; else if (i.intentos < INTENTOS_MAX) x.pendientes++;
    }
    return { ...g, porRecordar, porRecordarTodos, pendientes, conError, enHorario: enHorario(g, ahora, ZONA), terminaAt: estimarFin(g, pendientes, ahora, ZONA)?.toISOString() || null,
        porCuenta: [...grupos.values()].sort((a, b) => (a.administracionId ? 0 : 1) - (b.administracionId ? 0 : 1) || a.nombre.localeCompare(b.nombre)) };
}

/**
 * Los del segundo correo, en orden, cada uno con lo que le toca: «recordatorio» si su lote no cargó,
 * «novedad» si ya cargó (sólo con el reenvío a todos).
 */
async function segundoCorreo(desde: Date, todos: boolean): Promise<Inv[]> {
    const [invs, copias] = await Promise.all([
        prisma.invitacionCenso.findMany({ where: porRecordarInv(desde, todos), orderBy: { clave: "asc" } }),
        prisma.copiaCenso.findMany({ where: porRecordarCopia(desde, todos), orderBy: { email: "asc" }, select: { id: true, email: true, nombre: true, ...CON_INV } }),
    ]);
    const lista: Inv[] = [...invs, ...copias.map(comoEnvio)];
    const conCarga = todos ? await invitacionesConCarga([...new Set(lista.map((i) => i.id))]) : new Set<string>();
    return lista.map((i) => (conCarga.has(i.id) ? { ...i, novedad: true } : { ...i, recordatorio: true }));
}

let enVuelta = false;
/** Cada cuánto el envío de a poco vuelve a armar las copias (ver sincronizarCopiasCenso). */
const COPIAS_CADA_MS = 10 * 60 * 1000;
let copiasAlDia = 0;
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
        /* Cada tanto se ponen al día las copias (25/11): quien se suma al padrón después también recibe el código de su lote. */
        if (Date.now() - copiasAlDia > COPIAS_CADA_MS) { copiasAlDia = Date.now(); await sincronizarCopiasCenso().catch(() => null); }
        /* Primero las invitaciones (a la principal de cada lote) y después las copias al resto. Las
           copias van por correo, que también es un orden que no deja juntos a los del mismo lote. */
        const pendientes: Inv[] = [
            ...await prisma.invitacionCenso.findMany({ where: PENDIENTES, orderBy: { clave: "asc" } }),
            ...(await prisma.copiaCenso.findMany({ where: PENDIENTES, orderBy: { email: "asc" }, select: { id: true, email: true, nombre: true, ...CON_INV } })).map(comoEnvio),
            /* Y al final, si se pidió, el recordatorio a los lotes que no completaron (27/11). */
            ...(g.recordar ? await segundoCorreo(new Date(g.recordar), g.recordarA === "todos") : []),
        ];
        const [admins, unidades] = await Promise.all([
            administracionesParaCorreo(),
            prisma.unit.findMany({ where: { id: { in: [...new Set(pendientes.flatMap((p) => lotesDeInvitacion(p.lotes)))] } }, select: { id: true, administracionId: true } }),
        ]);
        const adminDeUnidad = new Map(unidades.map((u) => [u.id, u.administracionId]));
        /* El tope por casilla (ver TOPE_DIARIO_POR_CUENTA): la que ya mandó lo suyo hoy, o la que Gmail
           frenó, se saltea; las invitaciones de las otras siguen saliendo. */
        const hoy = await enviadasHoyPorCuenta(ahora);
        const descansa = (cuenta: string) => {
            const c = cuenta.toLowerCase(), f = g.frenadas[c];
            return (hoy.get(c) || 0) >= TOPE_DIARIO_POR_CUENTA || (!!f && Date.parse(f) > ahora.getTime());
        };
        let remitente: Remitente | null = null;
        const sinCuenta = new Set<string>(), enTope = new Set<string>();
        const inv = pendientes.find((p) => {
            const r = remitenteDeLotes(lotesDeInvitacion(p.lotes), adminDeUnidad, admins);
            if (r.tipo === "sin-cuenta") { sinCuenta.add(r.nombre); return false; }
            if (r.tipo === "administracion" && descansa(r.cuenta.cuenta)) { enTope.add(r.nombre); return false; }
            remitente = r; return true;
        });
        if (!inv && enTope.size) {
            /* No se apaga: se duerme hasta mañana a la hora de arranque, y ahí sigue solo. */
            const manana = mananaAlArranque(g, ahora, ZONA);
            await guardarGoteo({ ...g, proximo: manana.toISOString(), motivo: `Hoy ya salió lo de cada casilla (hasta ${TOPE_DIARIO_POR_CUENTA} por día): ${[...enTope].join(", ")}. Sigue solo mañana a las ${g.desde}.` });
            return { que: "tope" };
        }
        if (!inv && sinCuenta.size) {
            await guardarGoteo({ ...g, activo: false, proximo: null, motivo: `Esperando las cuentas de correo de ${[...sinCuenta].join(", ")}: cargalas en Administraciones › Correo y volvé a ponerlo en marcha.` });
            return { que: "sin-cuenta" };
        }
        if (!inv) {
            const conError = await prisma.invitacionCenso.count({ where: { enviadoAt: null } }) + await prisma.copiaCenso.count({ where: { enviadoAt: null } });
            await guardarGoteo({ ...g, activo: false, proximo: null, fallas: 0, recordar: null, recordarA: "pendientes", motivo: conError ? `Terminó. Quedaron ${conError} sin poder enviarse: mirá el motivo de cada una en la lista.` : g.recordar ? (g.recordarA === "todos" ? "Terminó: se reenvió a todos." : "Terminó: se mandó el recordatorio a todos los que no habían completado.") : "Terminó: se enviaron todas." });
            return { que: "terminado" };
        }
        /* La dirección de los enlaces: nunca una local (ver lib/origen-publico; 25/11 salieron con localhost). */
        const origen = await origenPublico({ guardado: g.origen });
        if (!origen) { await guardarGoteo({ ...g, activo: false, motivo: "No se sabe la dirección pública para armar los enlaces: cargala en Ajustes (URL pública, BASE_URL) y volvé a ponerlo en marcha." }); return { que: "sin-origen" }; }
        /* El próximo se anota ANTES de mandar: si esta vuelta tarda, la siguiente no manda otro encima. */
        await guardarGoteo({ ...g, proximo: proximoEnvio(g, ahora).toISOString() });
        const r = await mandarInvitacion(inv, origen, remitente || undefined);
        const ahoraG = await leerGoteoGuardado();                 // pudieron pausarlo mientras se mandaba
        if (r.ok) { await guardarGoteo({ ...ahoraG, fallas: 0, motivo: null }); return { que: "enviado", lote: inv.lote }; }
        /* Gmail frenó la casilla por tope: no es culpa de esta invitación (se le devuelve el intento) ni
           de las otras casillas (no suma a las fallas que frenan todo). Esa casilla descansa hasta mañana. */
        const de = remitente as Remitente | null;
        if (de?.tipo === "administracion" && esTopeDeGmail(r.error)) {
            const devuelve = { intentos: { decrement: 1 }, error: null };
            await (inv.copia ? prisma.copiaCenso.update({ where: { id: inv.copia }, data: devuelve }) : prisma.invitacionCenso.update({ where: { id: inv.id }, data: devuelve })).catch(() => null);
            await guardarGoteo({ ...ahoraG, frenadas: { ...ahoraG.frenadas, [de.cuenta.cuenta.toLowerCase()]: mananaAlArranque(ahoraG, new Date(), ZONA).toISOString() } });
            return { que: "frenada", lote: inv.lote, error: r.error };
        }
        const fallas = ahoraG.fallas + 1;
        await guardarGoteo(fallas >= FALLAS_PARA_PAUSAR
            ? { ...ahoraG, activo: false, fallas, proximo: null, motivo: `Se frenó solo: ${fallas} envíos seguidos fallaron. El último dijo: «${r.error || "sin detalle"}».` }
            : { ...ahoraG, fallas });
        return { que: "fallo", lote: inv.lote, error: r.error };
    } finally { enVuelta = false; }
}
