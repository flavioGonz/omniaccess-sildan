import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/lista-negra";
import { atenderAviso } from "@/lib/visitas/registro";
import { ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { avisarPorSocket } from "@/lib/avisar";
import { registrarGestion } from "@/lib/gestion-alarma";

/**
 * Gestión de alarmas (16/10, Nico: «un panel de gestión centralizado de todos los tipos de
 * alarmas»). Junta en una sola lista lo que hasta ahora vivía en cuatro pantallas:
 *
 *  · intrusión — las analíticas de las cámaras y los NVR (Detection, sin movimiento).
 *  · lpr       — las lecturas de matrículas en lista negra o en búsqueda (AccessEvent).
 *  · patron    — los avisos de patrones a la guardia: visita excedida, da vueltas, primera vez
 *                de noche… (AvisoGuardia).
 *  · vision    — los avisos de las reglas de OmniVision: sentido contrario, merodeo, objeto
 *                retirado… (AvisoGuardia con tipo VISION_*).
 *
 * Cada una se atiende donde se guarda: la intrusión en Detection (acknowledged + ackKind), los
 * avisos en AvisoGuardia (atendidoAt), y las lecturas —que no se tocan— en AlarmaAtendida.
 */

export type FuenteAlarma = "intrusion" | "lpr" | "patron" | "vision";
export type TonoAlarma = "mal" | "aviso" | "info" | "neutro";

export type Alarma = {
    /** «d:<id>» intrusión · «a:<id>» aviso · «l:<id>» lectura. */
    id: string;
    fuente: FuenteAlarma;
    tipo: string;
    titulo: string;
    detalle: string | null;
    ts: string;
    camara: string | null;
    deviceId: string | null;
    plate: string | null;
    foto: string | null;
    tono: TonoAlarma;
    estado: "pendiente" | "atendida";
    atendidaPor: string | null;
    atendidaAt: string | null;
    /** real | falsa | null. */
    resultado: string | null;
    /** Lo que escribió el operador sobre la gestión de esta alarma. */
    nota: string | null;
    notaPor: string | null;
    notaAt: string | null;
    accessEventId: string | null;
    /**
     * «Se quedó en la zona» (OmniVision): desde cuándo está y, cuando se fue, hasta cuándo y cómo
     * terminó (salio · no-se-ve · reinicio; ver vision-reglas.js cerrarAvisoEstadia). Sin `hasta`,
     * sigue ahí y el panel cuenta en vivo.
     */
    estadia?: {
        desde: string; hasta: string | null; segundos: number | null; como: string | null; umbral: number | null;
        /** Si se lo vio llegar (null en los avisos de antes del 21/10, que no lo sabían). */
        llegada: boolean | null;
        /** Cuándo quedó quieto: el fin de la maniobra de estacionar. */
        quieto: string | null;
        /** Las veces que se lo dio por ido y volvió a tomarse en el mismo lugar. */
        reabierta: number;
    } | null;
    /**
     * El evento de OmniVision detrás de un aviso VISION_* (EventoVision): de qué cámara es, cuándo
     * pasó y qué era. Con esto la ficha de la alarma abre la ventana de la detección, con su
     * grabación y su clip (20/10, Nico: «no tengo la ficha en el modal de eventos»). Antes el aviso
     * llegaba sin cámara (deviceId null) y la ficha no tenía qué abrir.
     */
    vision?: {
        eventoId: string; ts: string; clase: string | null;
        /** El tipo del evento (PERMANENCIA, MERODEO…) y el de la regla que lo disparó. */
        tipo: string; reglaTipo: string | null;
        /** Lo de la regla que explica el evento: su dibujo y sus números (ver lib/comportamientos). */
        zona: [number, number][] | null; linea: { a: [number, number]; b: [number, number] } | null;
        segundos: number | null; maximo: number | null; horario: { desde: string; hasta: string } | null;
        /** La caja de quien la disparó y el cuadro SIN marcas: la pantalla dibuja encima, en vivo. */
        caja: number[] | null; fotoCruda: string | null;
    } | null;
};

export const NOMBRE_FUENTE: Record<FuenteAlarma, string> = { intrusion: "Intrusión", lpr: "LPR", patron: "Patrones", vision: "OmniVision" };

/** Rangos que ofrece la pantalla, en horas. */
export const RANGOS_ALARMAS_H = [24, 72, 168] as const;
/**
 * Avisos que no son alarmas: «entró sin registrarse» se escribe por cada auto sin padrón en un
 * barrio abierto (274 de 286 avisos pendientes en San Nicolás el 16/10) y tapaba todo lo demás.
 * Esos autos ya están en «Desconocidos dentro».
 */
const AVISOS_QUE_NO_SON_ALARMA = ["SIN_REGISTRAR"];
/** Cuántas trae cada fuente como mucho: la lista es para atender, no un historial. */
const MAX_POR_FUENTE = 400;

const NOMBRE_INTRUSION: Record<string, string> = { LINECROSS: "Cruce de línea", INTRUSION: "Intrusión", REGION_ENTER: "Entra a zona", REGION_EXIT: "Sale de zona", OTHER: "Evento de cámara" };

export async function listarAlarmas(horas: number): Promise<Alarma[]> {
    const desde = new Date(Date.now() - horas * 3_600_000);
    const [dets, avisos, vigiladas] = await Promise.all([
        prisma.detection.findMany({ where: { timestamp: { gte: desde }, type: { not: "MOTION" } }, orderBy: { timestamp: "desc" }, take: MAX_POR_FUENTE }).catch(() => []),
        prisma.avisoGuardia.findMany({ where: { creado: { gte: desde }, tipo: { notIn: AVISOS_QUE_NO_SON_ALARMA } }, orderBy: { creado: "desc" }, take: MAX_POR_FUENTE }).catch(() => []),
        prisma.plateWatch.findMany({ where: { active: true, category: { in: ["BLACKLISTED", "SEARCH"] } }, select: { plate: true, category: true, motivo: true, label: true } }).catch(() => []),
    ]);
    const vig = new Map(vigiladas.map((v) => [normalizarMatricula(v.plate), v]));
    const chapas = [...vig.keys()].filter(Boolean) as string[];
    const lecturas = chapas.length ? await prisma.accessEvent.findMany({
        where: { timestamp: { gte: desde }, plateDetected: { in: chapas } }, orderBy: { timestamp: "desc" }, take: MAX_POR_FUENTE,
        select: { id: true, timestamp: true, plateDetected: true, direction: true, snapshotPath: true, imagePath: true, deviceId: true, device: { select: { name: true } } },
    }).catch(() => []) : [];
    const ids = [...new Set(dets.map((d) => d.deviceId).filter(Boolean))] as string[];
    const [devs, atendidas] = await Promise.all([
        ids.length ? prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).catch(() => []) : Promise.resolve([]),
        prisma.alarmaAtendida.findMany({ where: { clave: { in: [...dets.map((d) => `d:${d.id}`), ...avisos.map((a) => `a:${a.id}`), ...lecturas.map((l) => `l:${l.id}`)] } } }).catch(() => []),
    ]);
    const nombre = new Map(devs.map((d) => [d.id, d.name]));
    const atendida = new Map(atendidas.map((a) => [a.clave, a]));
    /*
     * La foto de los avisos de patrones (16/10, Nico: «hay fotos que no llegan»). Sólo los de
     * OmniVision traen la foto en `datos`; «primera vez de noche», «fuera de rutina» y compañía
     * guardan el evento de acceso que los disparó, y la foto es la de ese evento. Los que no
     * tienen evento («se quedó más de lo habitual») usan la última lectura de su chapa antes del
     * aviso. Medido en San Nicolás: 13 de 17 avisos del día tenían la foto disponible y salían sin ella.
     */
    const evIds = [...new Set(avisos.map((a) => a.accessEventId).filter(Boolean))] as string[];
    const chapasSinEvento = [...new Set(avisos.filter((a) => !a.accessEventId && a.plate && !(a.datos as any)?.foto).map((a) => normalizarMatricula(a.plate!)).filter(Boolean))] as string[];
    const [evFotos, lecturasChapa] = await Promise.all([
        evIds.length ? prisma.accessEvent.findMany({ where: { id: { in: evIds } }, select: { id: true, snapshotPath: true, imagePath: true } }).catch(() => []) : Promise.resolve([]),
        chapasSinEvento.length ? prisma.accessEvent.findMany({ where: { plateDetected: { in: chapasSinEvento }, timestamp: { gte: new Date(desde.getTime() - 7 * 86_400_000) }, OR: [{ snapshotPath: { not: null } }, { imagePath: { not: null } }] }, orderBy: { timestamp: "desc" }, take: 500, select: { plateDetected: true, timestamp: true, snapshotPath: true, imagePath: true } }).catch(() => []) : Promise.resolve([]),
    ]);
    const fotoEvento = new Map(evFotos.map((e) => [e.id, e.snapshotPath || e.imagePath || null]));
    // El evento de OmniVision de cada aviso VISION_*: por el id que guarda vision-reglas en `datos`, o por avisoId.
    const avisosVision = avisos.filter((a) => a.tipo.startsWith("VISION_"));
    const idsEvVision = [...new Set(avisosVision.map((a) => (a.datos as any)?.eventoId).filter((x) => typeof x === "string"))] as string[];
    const evVision = avisosVision.length ? await prisma.eventoVision.findMany({
        where: { OR: [{ id: { in: idsEvVision } }, { avisoId: { in: avisosVision.map((a) => a.id) } }] },
        select: { id: true, avisoId: true, deviceId: true, ts: true, clase: true, tipo: true, reglaId: true, caja: true, foto: true },
    }).catch(() => []) : [];
    // Las reglas, para dibujar y explicar cada aviso de OmniVision con lo que de verdad lo disparó.
    const reglasVision: any[] = avisosVision.length ? await prisma.setting.findUnique({ where: { key: "VISION_REGLAS" } })
        .then((f) => { try { const x = JSON.parse(f?.value || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } }).catch(() => []) : [];
    const reglaPorId = new Map(reglasVision.filter((r) => r && r.id).map((r) => [r.id, r]));
    const visionDe = (a: (typeof avisos)[number]) => {
        if (!a.tipo.startsWith("VISION_")) return null;
        const id = (a.datos as any)?.eventoId;
        return evVision.find((e) => e.id === id) || evVision.find((e) => e.avisoId === a.id) || null;
    };
    const fotoDeAviso = (a: (typeof avisos)[number]): string | null => {
        const f = (a.datos as any)?.foto;
        if (typeof f === "string" && f) return f.startsWith("/") ? f : `/api/vision/imagen/${f}`;
        if (a.accessEventId && fotoEvento.get(a.accessEventId)) return fotoEvento.get(a.accessEventId)!;
        const ch = a.plate ? normalizarMatricula(a.plate) : null;
        const l = ch ? lecturasChapa.find((x) => x.plateDetected === ch && x.timestamp <= a.creado) : null;
        return l ? l.snapshotPath || l.imagePath || null : null;
    };
    /*
     * La foto de una detección sin captura de la cámara: el cuadro propio de OmniVision, si lo
     * sacó. Antes se ponía /api/snapshot/<cámara>, que es la imagen de AHORA: una foto de la calle
     * vacía horas después, con aire de ser la de la alarma.
     */
    const fotoDeDeteccion = (d: (typeof dets)[number]): string | null =>
        d.snapshotPath || ((d as any).verifAnalisis?.propio?.foto ? `/api/monitor/intrusion/verificacion/${d.id}` : null);

    const out: Alarma[] = [];
    for (const d of dets) {
        out.push({
            id: `d:${d.id}`, fuente: "intrusion", tipo: d.type, titulo: NOMBRE_INTRUSION[d.type] || "Evento de cámara",
            detalle: d.label === "human" ? "Persona" : d.label === "vehicle" ? "Vehículo" : d.label || null,
            ts: d.timestamp.toISOString(), camara: (d.deviceId && nombre.get(d.deviceId)) || null, deviceId: d.deviceId, plate: null,
            foto: fotoDeDeteccion(d),
            tono: d.type === "LINECROSS" || d.type === "INTRUSION" ? "mal" : "aviso",
            estado: d.acknowledged ? "atendida" : "pendiente", atendidaPor: null, atendidaAt: d.ackAt?.toISOString() || null,
            resultado: d.ackKind === "false" ? "falsa" : d.ackKind === "real" ? "real" : null, accessEventId: null,
            ...notaDe(atendida.get(`d:${d.id}`)),
        });
    }
    for (const a of avisos) {
        const et = ETIQUETA_AVISO[a.tipo as TipoAviso];
        const ev = visionDe(a);
        out.push({
            id: `a:${a.id}`, fuente: a.tipo.startsWith("VISION_") ? "vision" : "patron", tipo: a.tipo, titulo: et?.titulo || a.tipo,
            detalle: a.motivo, ts: a.creado.toISOString(), camara: a.camara, deviceId: ev?.deviceId || null, plate: a.plate,
            vision: ev ? visionDeEvento(ev, reglaPorId.get(ev.reglaId || (a.datos as any)?.reglaId), a.datos) : null,
            foto: fotoDeAviso(a),
            tono: (et?.tono as TonoAlarma) || "aviso",
            estado: a.atendidoAt ? "atendida" : "pendiente", atendidaPor: a.atendidoPor, atendidaAt: a.atendidoAt?.toISOString() || null,
            resultado: (atendida.get(`a:${a.id}`)?.resultado as string) || null, accessEventId: a.accessEventId,
            estadia: estadiaDe(a.datos),
            // La nota de gestión; si no hay, la que dejó quien la atendió desde Visitas.
            ...notaDe(atendida.get(`a:${a.id}`), a.nota ? { nota: a.nota, por: a.atendidoPor, ts: a.atendidoAt } : null),
        });
    }
    for (const l of lecturas) {
        const ch = normalizarMatricula(l.plateDetected) || "";
        const v = vig.get(ch);
        const at = atendida.get(`l:${l.id}`);
        out.push({
            id: `l:${l.id}`, fuente: "lpr", tipo: v?.category === "SEARCH" ? "EN_BUSQUEDA" : "LISTA_NEGRA",
            titulo: v?.category === "SEARCH" ? "En búsqueda" : "Lista negra",
            detalle: [v?.motivo || v?.label, l.direction === "EXIT" ? "salida" : "entrada"].filter(Boolean).join(" · ") || null,
            ts: l.timestamp.toISOString(), camara: l.device?.name || null, deviceId: l.deviceId, plate: ch,
            foto: l.snapshotPath || l.imagePath || null, tono: v?.category === "SEARCH" ? "aviso" : "mal",
            estado: at?.atendida ? "atendida" : "pendiente", atendidaPor: at?.atendida ? at.por || null : null, atendidaAt: at?.atendida ? at.ts.toISOString() : null,
            resultado: at?.resultado || null, accessEventId: l.id,
            ...notaDe(at),
        });
    }
    return out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

function estadiaDe(datos: unknown): Alarma["estadia"] {
    const d = (datos || {}) as any;
    if (typeof d.desde !== "string") return null;
    return {
        desde: d.desde, hasta: typeof d.hasta === "string" ? d.hasta : null, segundos: Number.isFinite(d.segundos) ? d.segundos : null, como: d.como || null, umbral: Number.isFinite(d.umbral) ? d.umbral : null,
        llegada: typeof d.llegada === "boolean" ? d.llegada : null, quieto: typeof d.quieto === "string" ? d.quieto : null, reabierta: Number.isFinite(d.reabierta) ? d.reabierta : 0,
    };
}

const punto = (p: unknown): [number, number] | null => (Array.isArray(p) && p.length >= 2 && p.every((x) => Number.isFinite(x)) ? [Number(p[0]), Number(p[1])] : null);
function visionDeEvento(ev: { id: string; ts: Date; clase: string | null; tipo: string; caja: unknown; foto: string | null }, r: any, datos: unknown): NonNullable<Alarma["vision"]> {
    const d = (datos || {}) as any;
    const zonaR = Array.isArray(r?.zona) ? r.zona : Array.isArray(d.zona) ? d.zona : null;
    const zona = zonaR ? (zonaR.map(punto).filter(Boolean) as [number, number][]) : null;
    const a = punto(r?.linea?.a), b = punto(r?.linea?.b);
    const caja = Array.isArray(ev.caja) && ev.caja.length === 4 ? (ev.caja as number[]) : Array.isArray(d.caja) && d.caja.length === 4 ? d.caja : null;
    // EventoVision.foto es el cuadro crudo sólo cuando el evento guardó caja (ver vision-reglas `marcar`):
    // la fila y la aglomeración guardan la marcada, y dibujar encima sería marcar dos veces.
    const cruda = caja ? ev.foto || (typeof d.fotoCruda === "string" ? d.fotoCruda : null) : null;
    return {
        eventoId: ev.id, ts: ev.ts.toISOString(), clase: ev.clase, tipo: ev.tipo, reglaTipo: r?.tipo || null,
        zona: zona && zona.length >= 3 ? zona : null, linea: a && b ? { a, b } : null,
        segundos: Number.isFinite(r?.segundos) ? r.segundos : Number.isFinite(d.umbral) ? d.umbral : null,
        maximo: Number.isFinite(r?.maximo) ? r.maximo : null, horario: r?.horario || null,
        caja, fotoCruda: cruda ? (cruda.startsWith("/") ? cruda : `/api/vision/imagen/${cruda}`) : null,
    };
}

type FilaGestion = { nota: string | null; por: string | null; ts: Date; resultado?: string | null } | null | undefined;
function notaDe(g: FilaGestion, previa?: { nota: string; por: string | null; ts: Date | null } | null) {
    if (g?.nota) return { nota: g.nota, notaPor: g.por, notaAt: g.ts.toISOString() };
    if (previa) return { nota: previa.nota, notaPor: previa.por, notaAt: previa.ts?.toISOString() || null };
    return { nota: null, notaPor: null, notaAt: null };
}

/** Lo que se decidió de un auto adentro (Atípicos, Desconocidos…): se guarda sobre su última lectura, `l:<evento>`. */
export type GestionAuto = { resultado: "real" | "falsa" | null; atendida: boolean; nota: string | null; por: string | null; ts: string };

/**
 * La gestión de las lecturas que muestran las listas de quién está adentro (20/10, Nico: «no sé
 * cómo moderar las alarmas LPR… las de intrusión sí»). Un atípico no es una fila de alarma: es un
 * auto adentro con su última lectura. La decisión (real / falsa) y la nota se guardan sobre esa
 * lectura con la misma clave que una alarma LPR (`l:<id del evento>`), así una lectura de lista
 * negra marcada en Alarmas aparece marcada también en Atípicos, y al revés.
 */
export async function gestionesDeLecturas(eventos: (string | null | undefined)[]): Promise<Record<string, GestionAuto>> {
    const claves = [...new Set(eventos.filter(Boolean))].map((id) => `l:${id}`);
    if (!claves.length) return {};
    const filas = await prisma.alarmaAtendida.findMany({ where: { clave: { in: claves } } }).catch(() => []);
    return Object.fromEntries(filas.map((g) => [g.clave.slice(2), {
        resultado: g.resultado === "real" || g.resultado === "falsa" ? g.resultado : null,
        atendida: !!g.atendida, nota: g.nota || null, por: g.por || null, ts: g.ts.toISOString(),
    }]));
}

/** La gestión guardada de una alarma (la ficha de intrusión la pide al abrirse). */
export async function leerGestion(id: string) {
    const g = await prisma.alarmaAtendida.findUnique({ where: { clave: id } }).catch(() => null);
    return g ? { nota: g.nota, por: g.por, ts: g.ts.toISOString(), resultado: g.resultado, atendida: g.atendida } : null;
}

/**
 * Gestionar una alarma: decidir (real / falsa / atendida) y/o anotar qué se hizo.
 *
 *  · `atender`: la da por atendida, con `resultado` real o falsa (intrusión y LPR) o sin él. En
 *    intrusión y avisos se marca además en su propia fila, para que el monitor de intrusión y
 *    Visitas lo vean igual.
 *  · `nota`: el texto del operador. Se puede escribir antes de decidir («se mandó el móvil») y
 *    corregir después; la última versión queda, con quién y cuándo.
 *
 * Una nota sola no cierra la alarma. Devuelve false si la alarma no existe.
 */
export async function gestionarAlarma(id: string, g: { atender: boolean; resultado: "real" | "falsa" | null; nota: string | null }, por: string | null): Promise<boolean> {
    const [pref, rid] = [id.slice(0, 2), id.slice(2)];
    if (!rid || rid.length > 64 || !["d:", "a:", "l:"].includes(pref)) return false;
    const existe = pref === "d:" ? await prisma.detection.count({ where: { id: rid } }) : pref === "a:" ? await prisma.avisoGuardia.count({ where: { id: rid } }) : await prisma.accessEvent.count({ where: { id: rid } });
    if (!existe) return false;
    if (g.atender && pref === "d:") {
        // Corrige también una ya atendida: «era falsa» después de haberla confirmado.
        await prisma.detection.update({ where: { id: rid }, data: { acknowledged: true, ackKind: g.resultado === "falsa" ? "false" : "real", ackAt: new Date() } });
    }
    if (g.atender && pref === "a:") {
        await atenderAviso(rid, por, [g.resultado === "falsa" ? "Falsa alarma" : g.resultado === "real" ? "Real" : null, g.nota].filter(Boolean).join(" · ") || null);
    }
    const previa = await prisma.alarmaAtendida.findUnique({ where: { clave: id } }).catch(() => null);
    const datos = {
        ...(g.nota !== null ? { nota: g.nota || null } : {}),
        ...(g.atender ? { resultado: g.resultado, atendida: true } : {}),
        por, ts: new Date(),
    };
    if (previa) await prisma.alarmaAtendida.update({ where: { clave: id }, data: datos });
    else await prisma.alarmaAtendida.create({ data: { clave: id, atendida: g.atender, resultado: g.atender ? g.resultado : null, nota: g.nota || null, por } });
    // La bitácora (lib/gestion-alarma): qué se decidió y la nota, con quién.
    if (g.atender) await registrarGestion(id, g.resultado === "real" ? "MARCO_REAL" : g.resultado === "falsa" ? "MARCO_FALSA" : "ATENDIO", por);
    if (g.nota) await registrarGestion(id, "NOTA", por, { detalle: g.nota });
    // Con el resultado y quién: la pila de avisos deja una «real» como alarma activa (20/10).
    avisarPorSocket("alarma_atendida", { id, resultado: g.atender ? g.resultado : undefined, por });
    return true;
}

/**
 * Cuánto tiempo una alarma confirmada real sigue «activa» si nadie la desactiva. Es un tope de
 * seguridad para que una pantalla no quede con una alarma de ayer encendida; lo normal es que la
 * guardia la desactive cuando la resolvió.
 */
export const HORAS_ALARMA_ACTIVA = 12;
export type AlarmaActiva = Alarma & { confirmadaPor: string | null; confirmadaAt: string };

/**
 * Las alarmas confirmadas como reales que nadie desactivó todavía (20/10, Nico: «cuando es real,
 * sólo se va … pretendo que quede una alarma activa animada en el lugar de la notificación,
 * indicando quién la confirmó, y la foto del evento»).
 *
 * Sale de lo que ya se guarda: la decisión (AlarmaAtendida, resultado «real») y la bitácora
 * (AlarmaGestion): una DESACTIVO posterior a la confirmación la apaga; si después alguien la vuelve
 * a marcar real, vuelve a estar activa. Las intrusiones no van: tienen su propia alarma en curso
 * (la cámara en atención, AlertaIntrusionGlobal) y saldrían dos veces.
 */
export async function alarmasActivas(): Promise<AlarmaActiva[]> {
    const desde = new Date(Date.now() - HORAS_ALARMA_ACTIVA * 3_600_000);
    const reales = await prisma.alarmaAtendida.findMany({
        where: { resultado: "real", atendida: true, ts: { gte: desde }, NOT: { clave: { startsWith: "d:" } } },
        select: { clave: true, por: true, ts: true },
    }).catch(() => []);
    if (!reales.length) return [];
    const cierres = await prisma.alarmaGestion.findMany({ where: { clave: { in: reales.map((r) => r.clave) }, accion: "DESACTIVO" }, select: { clave: true, ts: true } }).catch(() => []);
    const abiertas = reales.filter((r) => !cierres.some((c) => c.clave === r.clave && c.ts >= r.ts));
    if (!abiertas.length) return [];
    // La alarma pudo haberse abierto antes de confirmarse: se mira un día más para atrás.
    const todas = await listarAlarmas(HORAS_ALARMA_ACTIVA + 24);
    const porClave = new Map(todas.map((a) => [a.id, a]));
    return abiertas.flatMap((r) => {
        const a = porClave.get(r.clave);
        return a ? [{ ...a, confirmadaPor: r.por, confirmadaAt: r.ts.toISOString() }] : [];
    }).sort((x, y) => y.confirmadaAt.localeCompare(x.confirmadaAt));
}
