import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { sincronizarInvitacionesPorLote } from "@/lib/censo-por-lote-servidor";
import { auditarLotes } from "@/lib/lote-auditoria";
import { codigoDeNombreViejo, compartenNombre, leerPadron, leerPadronDeLotes, mismoNombre, nombresCompatibles, type Padron } from "@/lib/padron-planilla";

/**
 * Llevar la planilla del padrón a la base (21/11, Nico: «tomar esa info y crear los lotes,
 * verificar lo que ya tenemos cargado, no borrar nada, crear los usuarios faltantes, actualizar»).
 *
 * Las reglas, que son promesas:
 *
 *  · **No borra nada.** Ni un lote, ni una persona, ni una invitación. Lo que está en la base y ya
 *    no figura en la planilla se INFORMA, y lo decide una persona.
 *  · **Se puede correr de nuevo.** La planilla va a tener una v9: volver a importarla actualiza lo
 *    que cambió y crea lo que falta. Un lote es su administración y su código; una persona es su
 *    correo.
 *  · **Una clave ya creada no cambia nunca.** Si el correo con la clave ya salió, cambiarla deja
 *    afuera a quien lo recibió.
 *  · **Lo que alguien escribió a mano no se pisa**: el nombre de una persona que ya existía, la
 *    descripción de un lote que ya la tenía, el lote principal de alguien que ya tenía uno.
 *  · **No manda correos.** Deja las invitaciones listas; mandarlas es otro paso, que hace una
 *    persona desde el Censo.
 *
 * Con `simulacro` hace todo el recorrido y no escribe: devuelve el mismo informe que devolvería al
 * aplicar. Es lo que se mira antes de tocar el padrón de cuatrocientas familias.
 */

export type InformePadron = {
    simulacro: boolean;
    administraciones: { nuevas: number; total: number };
    lotes: { nuevos: number; actualizados: number; iguales: number; adoptados: string[] };
    personas: { nuevas: number; reconocidas: number; completadas: number };
    vinculos: { nuevos: number; cambiados: number };
    invitaciones: { nuevas: number; actualizadas: number; iguales: number };
    /** Lo que la base tiene y la planilla no: se informa, no se toca. */
    fueraDeLaPlanilla: { lotes: string[]; invitaciones: number };
    porAdministracion: { sigla: string; nombre: string; lotes: number; terrenos: number; conPersonas: number; personas: number }[];
    /** Sólo con una planilla validada: lo que se corrigió para que la base diga lo mismo que ella. */
    correcciones: {
        nombres: number; principales: number;
        /** Vínculos persona–lote que la planilla ya no tiene, de gente que cargó el padrón: se quitaron. */
        vinculosQuitados: number; lotesConBajas: string[];
        /** Los mismos, de gente cargada a mano en el panel: se informan y quedan. */
        vinculosAMano: number;
        /** Personas que cargó el padrón y que la planilla ya no nombra: quedan, sin lote. */
        sinLote: number;
        /** Invitaciones de correos que la planilla ya no tiene. Sin enviar: se quitan (si no, el envío del censo les escribiría). Enviadas: quedan. */
        invitacionesQuitadas: number; invitacionesYaEnviadas: number;
    } | null;
    avisos: string[];
};

/** Las dos hojas que valen, como listas de filas. Se buscan por nombre; el orden de las hojas cambia entre versiones. */
export async function hojasDelPadron(buf: Buffer | ArrayBuffer): Promise<{ lotes: unknown[][]; envios: unknown[][]; unica: unknown[][]; hojas: string[] }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    const filasDe = (hoja: ExcelJS.Worksheet | undefined): unknown[][] => {
        const out: unknown[][] = [];
        hoja?.eachRow((fila) => {
            const vals = Array.isArray(fila.values) ? fila.values.slice(1) : [];
            /* Una celda con hipervínculo o con fórmula viene como objeto: lo que vale es su texto o su resultado. */
            out.push(vals.map((v) => (v && typeof v === "object" && !(v instanceof Date) ? ((v as { text?: unknown; result?: unknown }).text ?? (v as { result?: unknown }).result ?? "") : v)));
        });
        return out;
    };
    const por = (re: RegExp) => wb.worksheets.find((h) => re.test(h.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()));
    return { lotes: filasDe(por(/^buscar lote/)), envios: filasDe(por(/^envio de codigos/)), unica: filasDe(por(/^lotes$/)), hojas: wb.worksheets.map((h) => h.name) };
}

export async function importarPadronDesdeLibro(buf: Buffer | ArrayBuffer, o: { simulacro: boolean; quien: string }): Promise<InformePadron> {
    const h = await hojasDelPadron(buf);
    /* La planilla auditada del 24/11 viene en una sola hoja, «Lotes», con la gente adentro de cada lote. */
    if (h.unica.length && !h.lotes.length) return importarPadron(leerPadronDeLotes(h.unica), o);
    return importarPadron(leerPadron(h), o);
}

export async function importarPadron(padron: Padron, o: { simulacro: boolean; quien: string }): Promise<InformePadron> {
    const escribir = !o.simulacro;
    const inf: InformePadron = {
        simulacro: o.simulacro,
        administraciones: { nuevas: 0, total: 0 },
        lotes: { nuevos: 0, actualizados: 0, iguales: 0, adoptados: [] },
        personas: { nuevas: 0, reconocidas: 0, completadas: 0 },
        vinculos: { nuevos: 0, cambiados: 0 },
        invitaciones: { nuevas: 0, actualizadas: 0, iguales: 0 },
        fueraDeLaPlanilla: { lotes: [], invitaciones: 0 },
        porAdministracion: [],
        correcciones: padron.validada ? { nombres: 0, principales: 0, vinculosQuitados: 0, lotesConBajas: [], vinculosAMano: 0, sinLote: 0, invitacionesQuitadas: 0, invitacionesYaEnviadas: 0 } : null,
        avisos: [...padron.avisos],
    };
    const corr = inf.correcciones;

    // ── Las administraciones ──
    const admins = await prisma.administracion.findMany();
    const adminDe = new Map(admins.map((a) => [a.sigla, a.id]));
    for (const a of padron.administraciones) {
        if (adminDe.has(a.sigla)) continue;
        inf.administraciones.nuevas++;
        /* En el simulacro no hay id: se usa uno de mentira para seguir el recorrido. */
        adminDe.set(a.sigla, escribir ? (await prisma.administracion.create({ data: { nombre: a.nombre, sigla: a.sigla, orden: a.orden }, select: { id: true } })).id : `simulacro:${a.sigla}`);
    }
    inf.administraciones.total = adminDe.size;

    // ── Los lotes ──
    const unidades = await prisma.unit.findMany({ select: { id: true, name: true, lot: true, description: true, administracionId: true, manzana: true, solar: true, subunidad: true, edificio: true, areaM2: true, titular: true, situacion: true, type: true, users: { select: { name: true } } } });
    const siglaDe = new Map([...adminDe].map(([sigla, id]) => [id, sigla]));
    const unidadDe = new Map<string, string>();            // «sigla|código» → id de la unidad
    const ya = new Map(unidades.filter((u) => u.administracionId && u.lot).map((u) => [`${siglaDe.get(u.administracionId!)}|${u.lot}`, u]));
    const enPlanilla = new Set(padron.lotes.map((l) => `${l.sigla}|${l.codigo}`));

    /* Lo que estaba cargado antes de que existieran las administraciones («L1», «J11»): se busca
       cuál de los lotes de la planilla es. El código solo no alcanza —«L 1» está en dos etapas—,
       así que decide la gente: el lote cuyos titulares o contactos comparten apellido con quienes
       viven en esa unidad. Si no se puede decidir, la unidad queda como está y se avisa. */
    const personasDeLote = new Map<string, string[]>();
    for (const p of padron.personas) for (const v of p.vinculos) { const k = `${v.sigla}|${v.codigo}`; personasDeLote.set(k, [...(personasDeLote.get(k) || []), p.nombre]); }
    const adoptar = new Map<string, (typeof unidades)[number]>();
    for (const u of unidades.filter((x) => !x.administracionId)) {
        const codigo = codigoDeNombreViejo(u.name);
        if (!codigo) continue;
        const candidatos = padron.lotes.filter((l) => l.codigo === codigo && !ya.has(`${l.sigla}|${l.codigo}`) && !adoptar.has(`${l.sigla}|${l.codigo}`));
        if (!candidatos.length) continue;
        const gente = u.users.map((x) => x.name).join(" ");
        const porGente = candidatos.filter((l) => compartenNombre(gente, [l.titular, ...(personasDeLote.get(`${l.sigla}|${l.codigo}`) || [])].join(" ")));
        /* Sólo se reconoce por la GENTE, o si la unidad está vacía y hay un único lote posible.
           La primera versión además la reconocía «porque hay un solo lote con ese código», y con
           la planilla real eso iba a renombrar once unidades cuyos residentes no comparten una
           sola palabra con los titulares ni con los contactos de ese lote: gente cargada a mano
           (¿de prueba?, ¿de otro lote?) habría quedado viviendo en la casa de otra familia. Que
           el código coincida no prueba que sea la misma casa. */
        const elegido = porGente.length === 1 ? porGente[0] : !u.users.length && candidatos.length === 1 ? candidatos[0] : null;
        if (!elegido) {
            inf.avisos.push(u.users.length && !porGente.length
                ? `La unidad «${u.name}» ya estaba cargada con ${u.users.length} ${u.users.length === 1 ? "persona que no figura" : "personas que no figuran"} en la planilla para ${candidatos.map((l) => l.nombre).join(" ni ")}: quedó como estaba, con su gente, y el lote de la planilla se creó aparte. Hay que decidir a mano si es el mismo.`
                : `La unidad «${u.name}», que ya estaba cargada, puede ser ${candidatos.map((l) => l.nombre).join(" o ")}: no se pudo decidir cuál por quienes viven ahí. Quedó como estaba.`);
            continue;
        }
        adoptar.set(`${elegido.sigla}|${elegido.codigo}`, u);
        inf.lotes.adoptados.push(`${u.name} → ${elegido.nombre}`);
    }

    for (const l of padron.lotes) {
        const clave = `${l.sigla}|${l.codigo}`;
        const administracionId = adminDe.get(l.sigla)!;
        /* Sólo lo que la planilla trae: lo `undefined` (columna que esta planilla no tiene) no se toca. */
        const todo = { name: l.nombre, lot: l.codigo, administracionId, manzana: l.manzana, solar: l.solar, subunidad: l.subunidad, edificio: l.edificio, areaM2: l.areaM2, titular: l.titular, situacion: l.situacion };
        const datos = Object.fromEntries(Object.entries(todo).filter(([, v]) => v !== undefined)) as Partial<typeof todo> & { name: string; lot: string; administracionId: string };
        const u = ya.get(clave) || adoptar.get(clave);
        if (!u) {
            inf.lotes.nuevos++;
            unidadDe.set(clave, escribir ? (await prisma.unit.create({ data: { ...datos, type: "CASA", description: l.observaciones }, select: { id: true } })).id : `simulacro:${clave}`);
            continue;
        }
        unidadDe.set(clave, u.id);
        const cambia = (Object.keys(datos) as (keyof typeof datos)[]).some((k) => (u[k] ?? null) !== (datos[k] ?? null));
        /* La descripción sólo se completa si estaba vacía: lo que alguien escribió ahí no se pisa. */
        const conDescripcion = !u.description?.trim() && l.observaciones ? { description: l.observaciones } : {};
        if (!cambia && !Object.keys(conDescripcion).length) { inf.lotes.iguales++; continue; }
        inf.lotes.actualizados++;
        if (escribir) await prisma.unit.update({ where: { id: u.id }, data: { ...datos, ...conDescripcion } });
    }
    inf.fueraDeLaPlanilla.lotes = unidades.filter((u) => u.administracionId && u.lot && !enPlanilla.has(`${siglaDe.get(u.administracionId)}|${u.lot}`)).map((u) => u.name);

    // ── Las personas ──
    const usuarios = await prisma.user.findMany({ select: { id: true, name: true, email: true, unitId: true, role: true, createdBy: true } });
    /** La cargó una planilla del padrón (y no una persona en el panel): una planilla validada la puede corregir. */
    const delPadron = (x: { createdBy: string | null }) => /^padr[oó]n/i.test(x.createdBy || "");
    const enLaPlanilla = new Set<string>();          // «userId|unitId» que la planilla nombra
    const principalDe = new Map<string, string[]>(); // userId → sus lotes según la planilla
    const porCorreo = new Map(usuarios.filter((u) => u.email?.trim()).map((u) => [u.email!.trim().toLowerCase(), u]));
    const vinculosYa = new Map((await prisma.userUnidad.findMany({ select: { id: true, userId: true, unitId: true, vinculo: true } })).map((v) => [`${v.userId}|${v.unitId}`, v]));
    const tomados = new Set<string>();

    for (const p of padron.personas) {
        const suyos = p.vinculos.map((v) => ({ ...v, unitId: unidadDe.get(`${v.sigla}|${v.codigo}`)!, nombre: `${v.codigo} (${v.sigla})` })).filter((v) => v.unitId);
        if (!suyos.length) continue;
        const nombre = p.nombre || p.email;

        /* ¿Ya está? Por el correo; si no, por el nombre escrito igual entre los residentes que no
           tienen correo (los que se cargaron a mano antes del censo). Con dos que se llaman igual
           no se elige: se crea aparte y se avisa. */
        let u = porCorreo.get(p.email) || null;
        if (!u && p.nombre) {
            const iguales = usuarios.filter((x) => !x.email?.trim() && x.role === "RESIDENT" && !tomados.has(x.id) && mismoNombre(x.name, p.nombre));
            if (iguales.length === 1) u = iguales[0];
            else if (iguales.length > 1) inf.avisos.push(`Hay ${iguales.length} residentes sin correo que se llaman igual que un contacto de ${suyos[0].nombre}: no se eligió ninguno y se creó la persona aparte.`);
        }
        if (!u && p.nombre) {
            /* Y entre los que ya viven en SU lote, el que se llama igual pero escrito más corto o
               más largo («Juan Pérez» / «Juan Martín Pérez García»): es quien se cargó a mano
               antes. Fuera del mismo lote esta comparación no se hace. */
            const casas = new Set(suyos.map((v) => v.unitId));
            const vecinos = usuarios.filter((x) => !x.email?.trim() && x.role === "RESIDENT" && !tomados.has(x.id) && x.unitId && casas.has(x.unitId) && nombresCompatibles(x.name, p.nombre));
            if (vecinos.length === 1) u = vecinos[0];
        }
        let userId: string;
        if (u) {
            tomados.add(u.id); userId = u.id;
            inf.personas.reconocidas++;
            /* Con una planilla validada, el nombre de quien cargó el padrón se corrige; el de alguien
               cargado a mano en el panel, no. */
            const corregirNombre = corr && delPadron(u) && p.nombre && !mismoNombre(u.name, p.nombre) ? { name: p.nombre } : {};
            if (corregirNombre.name) corr!.nombres++;
            const completar = { ...(!u.email?.trim() ? { email: p.email } : {}), ...(!u.unitId ? { unitId: suyos[0].unitId } : {}), ...corregirNombre };
            if (Object.keys(completar).length) { inf.personas.completadas++; if (escribir) await prisma.user.update({ where: { id: u.id }, data: completar }); }
        } else {
            inf.personas.nuevas++;
            userId = escribir
                ? (await prisma.user.create({ data: { name: nombre, email: p.email, role: "RESIDENT", unitId: suyos[0].unitId, createdBy: `padrón (${o.quien})`, observations: p.observaciones }, select: { id: true } })).id
                : `simulacro:${p.email}`;
        }

        principalDe.set(userId, suyos.map((v) => v.unitId));
        for (const v of suyos) {
            enLaPlanilla.add(`${userId}|${v.unitId}`);
            const hay = vinculosYa.get(`${userId}|${v.unitId}`);
            if (!hay) { inf.vinculos.nuevos++; if (escribir) await prisma.userUnidad.create({ data: { userId, unitId: v.unitId, vinculo: v.vinculo } }); }
            else if (hay.vinculo !== v.vinculo) { inf.vinculos.cambiados++; if (escribir) await prisma.userUnidad.update({ where: { id: hay.id }, data: { vinculo: v.vinculo } }); }
        }
    }

    /*
     * ── Planilla validada: que la base diga lo mismo que ella (24/11) ──
     *
     * Nico: «esta planilla acaba de ser auditada y validada… estamos a punto de configurar el SMTP para
     * enviar el censo a todos». Con una planilla de trabajo (la v8) lo que faltaba se informaba y no se
     * tocaba. Con una auditada eso no alcanza: una invitación de alguien que vendió la casa saldría con
     * el envío del censo. Se corrige SÓLO lo que cargó una planilla; lo cargado a mano se informa.
     *   · Vínculo persona–lote que la planilla ya no tiene (de gente del padrón) → se quita.
     *   · Su lote principal, si quedó apuntando a un lote que ya no es suyo → el primero de los suyos, o ninguno.
     *   · Invitación de un correo que la planilla ya no tiene → sin enviar, se quita; enviada, queda.
     * Las personas no se borran: quien ya no figura queda en el padrón, sin lote.
     */
    if (corr) {
        const lotesPlanilla = new Set(padron.lotes.map((l) => unidadDe.get(`${l.sigla}|${l.codigo}`)).filter((x): x is string => !!x));
        const porId = new Map(usuarios.map((x) => [x.id, x]));
        const nombreLote = new Map(padron.lotes.map((l) => [unidadDe.get(`${l.sigla}|${l.codigo}`), l.nombre]));
        const bajas = new Set<string>();
        for (const v of vinculosYa.values()) {
            if (!lotesPlanilla.has(v.unitId) || enLaPlanilla.has(`${v.userId}|${v.unitId}`)) continue;
            const x = porId.get(v.userId);
            if (!x || !delPadron(x)) { corr.vinculosAMano++; continue; }
            corr.vinculosQuitados++;
            bajas.add(nombreLote.get(v.unitId) || v.unitId);
            if (escribir) await prisma.userUnidad.delete({ where: { id: v.id } }).catch(() => { });
        }
        corr.lotesConBajas = [...bajas].sort();
        for (const x of usuarios) {
            if (!delPadron(x)) continue;
            const suyos = principalDe.get(x.id) || [];
            if (!suyos.length) {
                /* Ya no figura: queda en el padrón, sin lote si el que tenía era de la planilla. */
                if (x.unitId && lotesPlanilla.has(x.unitId)) { corr.sinLote++; if (escribir) await prisma.user.update({ where: { id: x.id }, data: { unitId: null } }); }
                continue;
            }
            if (x.unitId && lotesPlanilla.has(x.unitId) && !suyos.includes(x.unitId)) { corr.principales++; if (escribir) await prisma.user.update({ where: { id: x.id }, data: { unitId: suyos[0] } }); }
        }
    }

    /*
     * ── Las invitaciones del censo: una por LOTE, a su correo principal (25/11) ──
     *
     * Nico: «es un código por lote, no por cada integrante; cada lote tiene un correo principal». El
     * principal es el que la planilla nombra primero en el lote (ver lib/censo-por-lote). Las viejas
     * por persona pasan a ser de su primer lote con la misma clave; las de quien no es principal de
     * ningún lote se quitan si no se usaron. En el simulacro se calcula sobre lo que ya está en la base
     * (las personas nuevas de esta planilla todavía no existen), así que es aproximado.
     */
    const preferidos = new Map<string, string>();
    for (const l of padron.lotes) { const id = unidadDe.get(`${l.sigla}|${l.codigo}`); if (id && l.principal) preferidos.set(id, l.principal); }
    const censo = await sincronizarInvitacionesPorLote({ simulacro: !escribir, preferidos });
    inf.invitaciones.nuevas = censo.nuevas;
    inf.invitaciones.actualizadas = censo.convertidas + censo.actualizadas;
    inf.invitaciones.iguales = censo.iguales;
    inf.fueraDeLaPlanilla.invitaciones = censo.usadasQueQuedan;
    if (corr) corr.invitacionesQuitadas = censo.borradas;

    // ── El resumen por administración, de la planilla ──
    for (const a of padron.administraciones) {
        const suyos = padron.lotes.filter((l) => l.sigla === a.sigla);
        const gente = padron.personas.filter((p) => p.vinculos.some((v) => v.sigla === a.sigla));
        const conGente = new Set(gente.flatMap((p) => p.vinculos.filter((v) => v.sigla === a.sigla).map((v) => v.codigo)));
        inf.porAdministracion.push({ sigla: a.sigla, nombre: a.nombre, lotes: suyos.length, terrenos: suyos.filter((l) => l.situacion === "TERRENO").length, conPersonas: conGente.size, personas: gente.length });
    }
    // La gente que la planilla sumó a cada lote queda en su historial, firmada por quien la cargó.
    if (escribir) await auditarLotes({ quien: o.quien, origen: "padron" });
    return inf;
}
