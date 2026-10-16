import { prisma } from "@/lib/prisma";
import { normalizarMatricula } from "@/lib/lista-negra";
import { leerAjustesVisitas } from "@/lib/visitas/ajustes";
import { esPaseLibre, NOMBRE_PASE_LIBRE } from "@/lib/visitas/ajustes-base";

/**
 * Quién está adentro del barrio ahora (Monitor LPR › las cuatro tarjetas de presencia).
 *
 * Pedido de Nico (16/10): «autos de residentes dentro, residentes dentro, autos de visitas
 * dentro, visitas dentro», y al tocar cada una la lista con hora de ingreso y tiempo de estadía,
 * «para manejar mejor quién está dentro y quién no».
 *
 * El criterio, y por qué:
 *  · Una matrícula está adentro si su ÚLTIMA lectura (de cualquier cámara) fue una entrada. La
 *    cámara interior también cuenta: verla adentro es la mejor prueba que hay.
 *  · En barrio CERRADO sólo valen las lecturas permitidas (una denegada no entró). En ABIERTO
 *    valen todas: no hay barrera que decida.
 *  · La salida no siempre se lee (San Nicolás, barrio abierto: ~55 % de las entradas no se ve
 *    salir). Por eso hay dos ventanas: un residente se busca 7 días para atrás (vive ahí); un
 *    vehículo que no es del barrio, 16 horas — pasado eso se da por ido aunque no se haya visto.
 *    Y por eso existe la marca a mano (MarcaPresencia): el guardia dice «salió» y vale hasta la
 *    próxima lectura de esa chapa.
 *  · Lo que no se pudo confirmar va marcado `estimado`: la pantalla no debe presentar como cierto
 *    algo que es una suposición.
 */

/** Cuánto para atrás se busca la última lectura de un auto de residente. */
export const VENTANA_RESIDENTES_DIAS = 7;
/** Cuánto para atrás se busca la de un vehículo que no es del barrio: después de esto se da por ido. */
export const VENTANA_VISITAS_HORAS = 16;
/** Una entrada de residente más vieja que esto, sin otra lectura después, es una suposición. */
const ESTIMADO_RESIDENTE_HORAS = 24;
/** Una entrada de visita más vieja que esto, sin otra lectura después, es una suposición. */
const ESTIMADO_VISITA_HORAS = 6;

/** Lo que la cámara manda cuando NO leyó una chapa: no es una matrícula. Mismo criterio que el monitor. */
const NO_ES_CHAPA = new Set(["", "NOLEIDA", "NOLEIDO", "UNKNOWN", "SINLECTURA", "SINMATRICULA", "NONE", "NULL", "DOOROPEN", "DOORCLOSE"]);

export type ClasePresencia = "residente" | "personal" | "proveedor" | "visita" | "invitado" | "lista_blanca" | "no_registrado";

export const NOMBRE_CLASE_PRESENCIA: Record<ClasePresencia, string> = {
    residente: "Residente", personal: "Personal", proveedor: "Proveedor", visita: "Visita",
    invitado: "Invitado", lista_blanca: "Lista blanca", no_registrado: "No registrado",
};

export type AutoAdentro = {
    plate: string;
    clase: ClasePresencia;
    persona: string | null;
    userId: string | null;
    unidad: string | null;
    /** Desde cuándo está adentro: la entrada que lo dejó adentro (o la marca a mano). */
    entrada: string;
    /** La última vez que alguna cámara lo vio (puede ser una interior, después de entrar). */
    vistoUltimo: string;
    camara: string | null;
    accessEventId: string | null;
    /** No se pudo confirmar: la entrada es vieja y no hubo otra lectura. */
    estimado: boolean;
    /** Lo dejó adentro una marca a mano, no una lectura. */
    marcaManual: boolean;
    /** Si tiene una visita registrada abierta. */
    visitaId: string | null;
    tipoVisita: string | null;
};

export type ResidenteAdentro = { userId: string; nombre: string; unidad: string | null; entrada: string; autos: string[]; estimado: boolean };

export type VisitaAdentro = {
    id: string; plate: string | null; nombre: string | null; empresa: string | null; tipo: string; tipoNombre: string;
    lote: string | null; origen: string; entrada: string; vence: string; excedida: boolean;
};

export type Presencia = {
    modo: "ABIERTO" | "CERRADO";
    autosResidentes: AutoAdentro[];
    residentes: ResidenteAdentro[];
    autosVisitas: AutoAdentro[];
    visitas: VisitaAdentro[];
    ventanas: { residentesDias: number; visitasHoras: number };
    calculado: string;
};

const ROL_A_CLASE: Record<string, ClasePresencia> = {
    RESIDENT: "residente", STAFF: "personal", SECURITY: "personal", OPERATOR: "personal", ADMIN: "personal",
    PROVIDER: "proveedor", VISITOR: "visita", TEMPORARY_VISITOR: "visita", WHITELISTED: "lista_blanca",
};

type Fila = { p: string; dir: string; t: Date; id: string; camara: string | null; userId: string | null; entrada: Date | null };

export async function calcularPresencia(): Promise<Presencia> {
    const aj = await leerAjustesVisitas();
    const abierto = aj.modo === "ABIERTO";
    const ahora = Date.now();
    const desde = new Date(ahora - VENTANA_RESIDENTES_DIAS * 86_400_000);
    const desdeVisitas = ahora - VENTANA_VISITAS_HORAS * 3_600_000;

    // La última lectura de cada chapa en la ventana larga, y la última ENTRADA de esa chapa (para
    // «desde cuándo»: un auto que entró a las 8 y la interior lo vio a las 11 está adentro desde las 8).
    const soloPermitidas = abierto ? "" : `AND e.decision = 'GRANT'`;
    const filas = await prisma.$queryRawUnsafe<Fila[]>(`
        SELECT DISTINCT ON (p) p, dir, t, id, camara, "userId",
               max(t) FILTER (WHERE dir = 'ENTRY') OVER (PARTITION BY p) AS entrada
          FROM (SELECT upper(regexp_replace(e."plateDetected", '[^A-Za-z0-9]', '', 'g')) AS p, e.direction::text AS dir,
                       e.timestamp AS t, e.id, d.name AS camara, e."userId"
                  FROM "AccessEvent" e LEFT JOIN "Device" d ON d.id = e."deviceId"
                 WHERE e.timestamp >= $1 AND e."plateDetected" IS NOT NULL ${soloPermitidas}) x
         WHERE length(p) >= 5
         ORDER BY p, t DESC`, desde);

    const [marcas, visitasAbiertas] = await Promise.all([
        prisma.marcaPresencia.findMany({ where: { ts: { gte: desde } }, orderBy: { ts: "desc" } }).catch(() => []),
        prisma.visita.findMany({ where: { sale: null }, orderBy: { entra: "desc" }, take: 500 }).catch(() => []),
    ]);
    const marcaDe = new Map<string, { estado: string; ts: Date }>();
    for (const m of marcas) if (!marcaDe.has(m.plate)) marcaDe.set(m.plate, { estado: m.estado, ts: m.ts });

    // Quién es cada chapa: padrón (vehículo o credencial), y si no, la persona de la lectura.
    const chapas = [...new Set([...filas.map((f) => f.p), ...[...marcaDe.entries()].filter(([, m]) => m.estado === "ADENTRO").map(([p]) => p)])].filter((p) => !NO_ES_CHAPA.has(p));
    const sel = { user: { select: { id: true, name: true, role: true, unit: { select: { name: true } } } } } as const;
    const [vehs, creds, blancas, invitadas] = chapas.length ? await Promise.all([
        prisma.$queryRaw<{ p: string; userId: string | null }[]>`SELECT upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) AS p, "userId" FROM "Vehicle" WHERE upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g')) = ANY(${chapas})`.catch(() => []),
        prisma.$queryRaw<{ p: string; userId: string | null }[]>`SELECT upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) AS p, "userId" FROM "Credential" WHERE type = 'PLATE' AND upper(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) = ANY(${chapas})`.catch(() => []),
        prisma.plateWatch.findMany({ where: { plate: { in: chapas }, active: true, category: "WHITELISTED" }, select: { plate: true } }).catch(() => []),
        prisma.guestPlate.findMany({ where: { plate: { in: chapas }, guest: { invitation: { status: "ACTIVE" as any, validFrom: { lte: new Date() }, validTo: { gte: new Date() } } } }, select: { plate: true } }).catch(() => []),
    ]) : [[], [], [], []];
    const duenoDe = new Map<string, string>();
    for (const c of creds) if (c.userId) duenoDe.set(c.p, c.userId);
    for (const v of vehs) if (v.userId) duenoDe.set(v.p, v.userId); // el vehículo manda sobre la credencial
    const userIds = [...new Set([...duenoDe.values(), ...filas.map((f) => f.userId).filter(Boolean) as string[]])];
    const usuarios = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: sel.user.select }).catch(() => []) : [];
    const usuario = new Map(usuarios.map((u) => [u.id, u]));
    const blanca = new Set(blancas.map((b) => normalizarMatricula(b.plate)));
    const invitada = new Set(invitadas.map((g) => normalizarMatricula(g.plate)));
    const visitaPorChapa = new Map(visitasAbiertas.filter((v) => v.plate).map((v) => [v.plate!, v]));

    const autos: AutoAdentro[] = [];
    const porChapa = new Map(filas.map((f) => [f.p, f]));
    for (const p of chapas) {
        const f = porChapa.get(p);
        const m = marcaDe.get(p);
        const marcaManda = !!m && (!f || m.ts > f.t);
        let adentro: boolean, entrada: Date | null, visto: Date;
        if (marcaManda) { adentro = m!.estado === "ADENTRO"; entrada = m!.ts; visto = f ? f.t : m!.ts; }
        else { adentro = !!f && (f.dir === "ENTRY" || (!!f.entrada && f.entrada >= f.t)); entrada = f?.entrada || f?.t || null; visto = f!.t; }
        if (!adentro || !entrada) continue;

        const uid = duenoDe.get(p) || f?.userId || null;
        const u = uid ? usuario.get(uid) : undefined;
        const visita = visitaPorChapa.get(p);
        let clase: ClasePresencia = u ? (ROL_A_CLASE[String(u.role)] || "no_registrado") : "no_registrado";
        if (clase === "no_registrado" || clase === "visita") {
            if (visita) clase = "visita";
            else if (invitada.has(p)) clase = "invitado";
            else if (blanca.has(p)) clase = "lista_blanca";
        }
        if (String(u?.role) === "BLACKLISTED") clase = "no_registrado";
        // Fuera de la ventana corta, un vehículo que no es del barrio se da por ido.
        if (clase !== "residente" && !visita && !marcaManda && visto.getTime() < desdeVisitas) continue;
        const horasDesdeVisto = (ahora - visto.getTime()) / 3_600_000;
        autos.push({
            plate: p, clase, persona: u?.name || visita?.nombre || null, userId: u?.id || null, unidad: u?.unit?.name || visita?.loteNombre || null,
            entrada: entrada.toISOString(), vistoUltimo: visto.toISOString(), camara: f?.camara || null, accessEventId: f?.id || null,
            estimado: !marcaManda && horasDesdeVisto > (clase === "residente" ? ESTIMADO_RESIDENTE_HORAS : ESTIMADO_VISITA_HORAS),
            marcaManual: marcaManda, visitaId: visita?.id || null, tipoVisita: visita?.tipo || null,
        });
    }
    autos.sort((a, b) => (a.entrada < b.entrada ? 1 : -1));
    const autosResidentes = autos.filter((a) => a.clase === "residente");
    const autosVisitas = autos.filter((a) => a.clase !== "residente");

    // Residentes adentro: los dueños de los autos de residentes adentro, más los que entraron a pie
    // (rostro o tarjeta) y cuya última pasada con su persona fue una entrada.
    const residentes = new Map<string, ResidenteAdentro>();
    for (const a of autosResidentes) {
        if (!a.userId) continue;
        const r = residentes.get(a.userId);
        if (r) { r.autos.push(a.plate); if (a.entrada < r.entrada) r.entrada = a.entrada; r.estimado = r.estimado && a.estimado; }
        else residentes.set(a.userId, { userId: a.userId, nombre: a.persona || "Residente", unidad: a.unidad, entrada: a.entrada, autos: [a.plate], estimado: a.estimado });
    }
    const aPie = await prisma.$queryRawUnsafe<{ userId: string; dir: string; t: Date }[]>(`
        SELECT DISTINCT ON (e."userId") e."userId", e.direction::text AS dir, e.timestamp AS t
          FROM "AccessEvent" e JOIN "User" u ON u.id = e."userId"
         WHERE e.timestamp >= $1 AND u.role = 'RESIDENT' AND e."accessType" IS NOT NULL AND e."accessType"::text <> 'PLATE' ${soloPermitidas}
         ORDER BY e."userId", e.timestamp DESC`, desde).catch(() => []);
    const faltan = aPie.filter((x) => x.dir === "ENTRY" && !residentes.has(x.userId));
    if (faltan.length) {
        const us = await prisma.user.findMany({ where: { id: { in: faltan.map((x) => x.userId) } }, select: { id: true, name: true, unit: { select: { name: true } } } }).catch(() => []);
        const uu = new Map(us.map((u) => [u.id, u]));
        for (const x of faltan) {
            const u = uu.get(x.userId); if (!u) continue;
            residentes.set(x.userId, { userId: x.userId, nombre: u.name, unidad: u.unit?.name || null, entrada: x.t.toISOString(), autos: [], estimado: (ahora - x.t.getTime()) / 3_600_000 > ESTIMADO_RESIDENTE_HORAS });
        }
    }

    const tipos = new Map(aj.tipos.map((t) => [t.clave, t.nombre]));
    const visitas: VisitaAdentro[] = visitasAbiertas.map((v) => ({
        id: v.id, plate: v.plate, nombre: v.nombre, empresa: v.empresa, tipo: v.tipo,
        tipoNombre: tipos.get(v.tipo) || (esPaseLibre(v.tipo) ? NOMBRE_PASE_LIBRE : v.tipo), lote: v.loteNombre, origen: v.origen,
        entrada: v.entra.toISOString(), vence: v.vence.toISOString(), excedida: v.vence.getTime() < ahora,
    }));

    return {
        modo: abierto ? "ABIERTO" : "CERRADO",
        autosResidentes,
        residentes: [...residentes.values()].sort((a, b) => (a.entrada < b.entrada ? 1 : -1)),
        autosVisitas,
        visitas,
        ventanas: { residentesDias: VENTANA_RESIDENTES_DIAS, visitasHoras: VENTANA_VISITAS_HORAS },
        calculado: new Date().toISOString(),
    };
}

/** Una corrección a mano: la chapa salió (o está adentro) desde ahora. */
export async function marcarPresencia(plate: string, estado: "AFUERA" | "ADENTRO", por: string | null) {
    const p = normalizarMatricula(plate);
    if (!p || p.length < 5 || NO_ES_CHAPA.has(p)) return null;
    return prisma.marcaPresencia.create({ data: { plate: p, estado, por } });
}
