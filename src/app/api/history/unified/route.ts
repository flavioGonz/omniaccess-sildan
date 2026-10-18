import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { limitesDelDia } from "@/lib/fechas";
import { Prisma } from "@prisma/client";
import { clasesDe, RELECTURA_CON_CHAPA, VISION_IDS_MAX, type EmpresaFila, type VisionFila } from "@/lib/historial-vision";
import { empresasDeLecturas } from "@/lib/empresas-servidor";
import { esNoLeida } from "@/lib/relectura";
import { accesosDeObjetos, objetosPorTexto, type ObjetoParecido } from "@/lib/busqueda-vision";
import { NOMBRE_CLASE_REGLA } from "@/lib/vision-reglas";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";

export const dynamic = "force-dynamic";

/**
 * GET /api/history/unified
 *
 * Accesos y avistamientos en una sola lista, ordenados por momento.
 *
 * Estaban en dos tablas separadas porque son cosas distintas: un acceso decide si la
 * barrera abre, un avistamiento solo deja constancia. Esa diferencia sigue importando y
 * por eso cada fila dice de qué tipo es — pero tenerlas separadas obligaba a buscar la
 * misma matrícula dos veces, en dos pantallas, para reconstruir un solo recorrido.
 *
 * Se consultan las dos tablas por separado y se mezclan acá. No se hace en SQL con un
 * UNION porque los campos no se corresponden uno a uno (decisión y sentido de un lado,
 * confianza y estadía del otro), y forzarlos a un molde común los volvería mentirosos.
 */

type Fila = {
    id: string;
    tipo: "ACCESO" | "PASO" | "ESTACIONADO" | "VISTO" | "OV_CHAPA" | "OV_OBJETO";
    momento: string;
    plate: string | null;
    persona: string | null;
    camara: string | null;
    deviceId: string | null;
    /** Acceso: GRANT | DENY. Avistamiento: null. */
    decision: string | null;
    /** ENTRY | EXIT | INTERNAL */
    sentido: string | null;
    confianza: number | null;
    lecturas: number | null;
    foto: string | null;
    estDesde: string | null;
    /** Dónde cayó la chapa dentro del cuadro. Sin esto el visor no puede dibujar la retícula. */
    bbox: string | null;
    estCerrada: boolean;
    estHasta: string | null;
    detalles: string | null;
    /** Solo en las salidas: cuánto estuvo adentro desde su propia entrada. */
    permanencia: number | null;
    /**
     * Solo en las entradas permitidas: cuándo salió ese vehículo después de esta entrada.
     * `null` con `adentro: true` es "sigue adentro" y el contador de la tabla corre en vivo;
     * `adentro: false` sin salida es una entrada vieja a la que nunca se le registró la
     * salida, y ahí no hay nada que contar.
     */
    salida?: string | null;
    adentro?: boolean;
    /** El evento completo, para la ficha. Solo en los accesos. */
    raw: any | null;
    /** Lo que vio OmniVision en la foto (sólo accesos ya analizados). */
    vision?: VisionFila | null;
    /** La empresa (delivery, taxi…) de esa matrícula a esa hora, con su logo. */
    empresa?: EmpresaFila | null;
};

/**
 * Las columnas de fecha son `timestamp` sin zona y guardan UTC, pero la sesión de Postgres está
 * en America/Montevideo: un Date pasado a $queryRaw se compara como hora local y queda corrido
 * 3 h (ver vision-analisis.js). Se pasa como texto UTC sin zona, que es lo que la columna guarda.
 */
const sinZona = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

/*
 * Lo que OmniVision ve en las cámaras RTSP (18/10, Nico: «no veo las detecciones que realiza
 * OmniVision en las cámaras RTSP, las que no son LPR»). El historial juntaba accesos (cámaras LPR)
 * y lecturas del seguimiento; lo que OmniVision ve en el resto de las cámaras (ObjetoVisto) no
 * llegaba: en el lab, ~10.000 objetos en dos días, de los que en 8 leyó la chapa.
 *
 *   OV_CHAPA   un objeto en el que OmniVision leyó una matrícula (textos tipo «matricula»).
 *              Entra siempre, como una lectura más: es lo que se busca en un historial.
 *   OV_OBJETO  cualquier objeto (vehículo, persona…). Sólo si se lo pide en el filtro de tipos:
 *              son miles por día y taparían los accesos.
 *
 * Las cámaras LPR quedan afuera: lo que ven ya está en el historial como acceso, con su foto y su
 * análisis.
 */
type FilaOV = {
    id: string; deviceId: string | null; camara: string; clase: string; grupo: string; confianza: number;
    primeraVez: Date; cuadros: number; recorte: string | null; foto: string | null; atributos: any; caja: any; chapa: string | null; chapaConf: number | null; chapaCaja: any;
};

/*
 * Las siluetas de las filas de OmniVision (18/10, Nico: «faltan las siluetas»). El registro guarda
 * la caja de cada objeto (0-1, como la capa) pero no el tamaño de la foto, y la capa lo necesita
 * para la proporción del dibujo y el tamaño de los rótulos: sin él, el recuadro cae corrido. Se lee del encabezado del
 * JPEG (los primeros KB, con Range) y se guarda por cámara: todas las fotos de una cámara salen del
 * mismo flujo. Se vuelve a mirar cada 10 minutos por si cambió el flujo.
 */
const BUCKET_VISION = process.env.VISION_BUCKET || "objetos";
const TAMANO_MS = 10 * 60_000;
const tamanoPorCamara = new Map<string, { t: number; w: number; h: number }>();
function tamanoJpeg(b: Uint8Array): { w: number; h: number } | null {
    let i = 2;
    while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC): ahí están alto y ancho.
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
}
async function tamanoDeFoto(camara: string, clave: string): Promise<{ w: number; h: number } | null> {
    const ya = tamanoPorCamara.get(camara);
    if (ya && Date.now() - ya.t < TAMANO_MS) return ya;
    try {
        const r = await (await getS3Client()).send(new GetObjectCommand({ Bucket: BUCKET_VISION, Key: clave, Range: "bytes=0-65535" }));
        const t = tamanoJpeg(await r.Body!.transformToByteArray());
        if (!t) return ya || null;
        const v = { t: Date.now(), ...t };
        tamanoPorCamara.set(camara, v);
        return v;
    } catch { return ya || null; }
}
async function objetosOmniVision(p: { soloChapas: boolean; desde: Date | null; hasta: Date | null; buscar: string; clases: string[]; grupos: string[]; camaras: string[]; limite: number }): Promise<FilaOV[]> {
    const q = p.buscar ? `%${p.buscar}%` : null;
    const qChapa = p.buscar ? `%${p.buscar.toUpperCase().replace(/[^A-Z0-9]/g, "")}%` : null;
    return prisma.$queryRaw<FilaOV[]>`
        SELECT o.id, o."deviceId", o.camara, o.clase, o.grupo, o.confianza, o."primeraVez", o.cuadros, o.recorte, o.foto, o.atributos, o.caja,
               m.texto AS chapa, m.conf AS "chapaConf", m.caja AS "chapaCaja"
          FROM "ObjetoVisto" o
          LEFT JOIN "Device" d ON d.id = o."deviceId"
          LEFT JOIN LATERAL (
               SELECT upper(regexp_replace(t->>'texto', '[^A-Za-z0-9]', '', 'g')) AS texto, (t->>'confianza')::float AS conf, t->'caja' AS caja
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.textos) = 'array' THEN o.textos ELSE '[]'::jsonb END) t
                WHERE t->>'tipo' = 'matricula' AND coalesce(t->>'texto', '') <> ''
                ORDER BY (t->>'confianza')::float DESC NULLS LAST LIMIT 1) m ON true
         WHERE (d.id IS NULL OR d."deviceType"::text <> 'LPR_CAMERA')
           ${p.soloChapas ? Prisma.sql`AND m.texto IS NOT NULL` : Prisma.empty}
           ${p.desde ? Prisma.sql`AND o."primeraVez" >= ${sinZona(p.desde)}::timestamp` : Prisma.empty}
           ${p.hasta ? Prisma.sql`AND o."primeraVez" <= ${sinZona(p.hasta)}::timestamp` : Prisma.empty}
           ${p.clases.length || p.grupos.length ? Prisma.sql`AND (o.clase = ANY(${p.clases}::text[]) OR o.grupo = ANY(${p.grupos}::text[]))` : Prisma.empty}
           ${p.camaras.length ? Prisma.sql`AND o.camara = ANY(${p.camaras}::text[])` : Prisma.empty}
           ${q ? Prisma.sql`AND (o.camara ILIKE ${q} OR o.clase ILIKE ${q} OR m.texto LIKE ${qChapa})` : Prisma.empty}
         ORDER BY o."primeraVez" DESC
         LIMIT ${p.limite}`;
}
/** «persona — ropa naranja, chaleco reflectivo»: los rasgos seguros; un «no» no se escribe. */
function rasgosOV(atributos: any): string[] {
    const out: string[] = [];
    for (const a of Array.isArray(atributos) ? atributos : []) {
        if (!a || a.dudoso || !a.valor || a.valor === "no") continue;
        out.push(a.valor === "sí" || a.valor === "si" ? String(a.nombre || a.id || "").toLowerCase() : a.id === "color" ? `color ${a.valor}` : a.id === "ropa" ? `ropa ${a.valor}` : String(a.valor));
    }
    return out.filter(Boolean);
}

/**
 * Los accesos cuya foto cumple el filtro OmniVision, de los más nuevos, hasta VISION_IDS_MAX.
 * Varias opciones se suman (persona O moto): es lo que se espera de tildar dos casillas.
 */
async function idsVision(ids: string[], desde: Date | null, hasta: Date | null): Promise<{ ids: string[]; truncado: boolean }> {
    const { clases, grupos, releida } = clasesDe(ids);
    const partes: Prisma.Sql[] = [];
    const rango = Prisma.sql`${desde ? Prisma.sql`AND e.timestamp >= ${sinZona(desde)}::timestamp` : Prisma.empty} ${hasta ? Prisma.sql`AND e.timestamp <= ${sinZona(hasta)}::timestamp` : Prisma.empty}`;
    if (clases.length || grupos.length) {
        partes.push(Prisma.sql`
            SELECT e.id, e.timestamp FROM "AnalisisFoto" a JOIN "AccessEvent" e ON e.id = a."accessEventId"
            WHERE a.estado = 'OK' ${rango} AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(a.analisis->'objetos', '[]'::jsonb)) o
                WHERE o->>'clase' = ANY(${clases}::text[]) OR o->>'grupo' = ANY(${grupos}::text[]))`);
    }
    if (releida) {
        partes.push(Prisma.sql`
            SELECT e.id, e.timestamp FROM "Relectura" r JOIN "AccessEvent" e ON e.id = r."accessEventId"
            WHERE r.estado = ANY(${RELECTURA_CON_CHAPA}::text[]) ${rango}`);
    }
    if (!partes.length) return { ids: [], truncado: false };
    const filas = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM (${Prisma.join(partes, " UNION ")}) x ORDER BY timestamp DESC LIMIT ${VISION_IDS_MAX + 1}`;
    return { ids: filas.slice(0, VISION_IDS_MAX).map((f) => f.id), truncado: filas.length > VISION_IDS_MAX };
}

/** Palabras que no dicen nada de un objeto: «persona CON chaleco», «auto DE color blanco». */
const PALABRAS_VACIAS = new Set(["con", "de", "del", "y", "en", "la", "el", "los", "las", "un", "una", "color", "que", "sin"]);
/**
 * La raíz de una palabra para comparar sin género ni número: «blanca», «blancos» y «blanco» dan
 * «blanc». OmniVision escribe los colores en masculino («blanco») y el operador escribe como habla
 * («moto blanca»). Sin tildes, porque el análisis las tiene («sedán») y el que busca a veces no.
 */
function raiz(p: string) {
    let w = p.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9ñ]/g, "");
    if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
    if (w.length >= 4 && /[aoe]$/.test(w)) w = w.slice(0, -1);
    return w;
}

/**
 * Los accesos donde OmniVision vio lo que se busca, de los más nuevos, hasta VISION_IDS_MAX.
 *
 * El buscador miraba sólo la matrícula, la persona y la cámara: «moto blanca» o «persona con
 * chaleco» no encontraba nada aunque OmniVision lo hubiera visto en la foto. Ahora TODAS las
 * palabras tienen que estar en el MISMO objeto (su nombre, su clase o sus rasgos seguros: «moto
 * blanca» es una moto blanca, no una moto y algo blanco), y además se busca la chapa que releyó
 * OmniVision en las NO_LEIDA. Los rasgos sí/no cuentan por su nombre sólo cuando son «sí».
 */
async function idsBusquedaVision(buscar: string, desde: Date | null, hasta: Date | null): Promise<string[]> {
    const palabras = [...new Set(buscar.split(/\s+/).map((p) => p.trim()).filter((p) => p && !PALABRAS_VACIAS.has(p.toLowerCase())).map(raiz).filter((p) => p.length >= 2))].slice(0, 6);
    const rango = Prisma.sql`${desde ? Prisma.sql`AND e.timestamp >= ${sinZona(desde)}::timestamp` : Prisma.empty} ${hasta ? Prisma.sql`AND e.timestamp <= ${sinZona(hasta)}::timestamp` : Prisma.empty}`;
    const partes: Prisma.Sql[] = [];
    if (palabras.length) {
        partes.push(Prisma.sql`
            SELECT e.id, e.timestamp FROM "AnalisisFoto" a JOIN "AccessEvent" e ON e.id = a."accessEventId"
            WHERE a.estado = 'OK' ${rango} AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(a.analisis->'objetos', '[]'::jsonb)) o,
                LATERAL (SELECT translate(lower(concat_ws(' ', o->>'nombre', o->>'clase', o->>'grupo',
                    (SELECT string_agg(CASE WHEN t->>'valor' IN ('sí', 'si') THEN t->>'nombre' WHEN t->>'valor' = 'no' THEN '' ELSE t->>'valor' END, ' ')
                       FROM jsonb_array_elements(COALESCE(o->'atributos', '[]'::jsonb)) t
                      WHERE COALESCE((t->>'dudoso')::boolean, false) = false))), 'áéíóúüñ', 'aeiouun') AS txt) x
                WHERE (SELECT bool_and(x.txt LIKE '%' || w || '%') FROM unnest(${palabras}::text[]) w))`);
    }
    const chapa = buscar.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (chapa.length >= 3) {
        partes.push(Prisma.sql`
            SELECT e.id, e.timestamp FROM "Relectura" r JOIN "AccessEvent" e ON e.id = r."accessEventId"
            WHERE r.estado = ANY(${RELECTURA_CON_CHAPA}::text[]) AND r.plate LIKE ${"%" + chapa + "%"} ${rango}`);
    }
    if (!partes.length) return [];
    const filas = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM (${Prisma.join(partes, " UNION ")}) x ORDER BY timestamp DESC LIMIT ${VISION_IDS_MAX}`.catch(() => []);
    return filas.map((f) => f.id);
}

/** Qué vio OmniVision en cada acceso de la lista: clases (con cuántas) y la relectura, si hubo. */
async function visionDe(ids: string[]): Promise<Map<string, VisionFila>> {
    const m = new Map<string, VisionFila>();
    if (!ids.length) return m;
    const [analisis, relecturas] = await Promise.all([
        prisma.analisisFoto.findMany({ where: { accessEventId: { in: ids }, estado: "OK" }, select: { accessEventId: true, analisis: true } }),
        // Todas, también las que no leyeron: la fila dice «OmniVision no la leyó» en vez de nada.
        prisma.relectura.findMany({ where: { accessEventId: { in: ids } }, select: { accessEventId: true, plate: true, estado: true, confianza: true } }),
    ]);
    for (const a of analisis) {
        const cuenta = new Map<string, { clase: string; nombre: string; n: number }>();
        for (const o of ((a.analisis as any)?.objetos || []) as any[]) {
            const k = String(o?.clase || "");
            if (!k) continue;
            const c = cuenta.get(k) || { clase: k, nombre: String(o?.nombre || k), n: 0 };
            c.n++; cuenta.set(k, c);
        }
        const an = a.analisis as any;
        m.set(a.accessEventId, {
            vio: [...cuenta.values()].sort((x, y) => y.n - x.n), releida: null,
            // Entero, para dibujar las siluetas sobre la captura (si trae medidas: sin ellas no hay dónde ponerlas).
            analisis: an?.ancho && an?.alto ? { ancho: an.ancho, alto: an.alto, objetos: an.objetos || [] } : null,
        });
    }
    for (const r of relecturas) {
        const conChapa = RELECTURA_CON_CHAPA.includes(r.estado) && !!r.plate;
        m.set(r.accessEventId, { ...(m.get(r.accessEventId) || { vio: [] }), releida: { plate: conChapa ? r.plate : null, estado: r.estado, confianza: r.confianza } });
    }
    return m;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/**
 * Cuántas de las pistas más parecidas traen sus accesos a la tabla: las mismas 60 que muestra
 * OmniVision › Buscar. Con 200 (todo lo que pasa el corte) «camioneta blanca» traía camionetas
 * de noche de cualquier color: el corte separa «posible» de «nada», no «parecido» de «no tanto».
 */
const PARECIDOS_MAX = 60;
/** Cuántas pistas parecidas se muestran en la franja de arriba del historial: una fila de miniaturas. */
const OBJETOS_EN_FRANJA = 12;

/**
 * Hasta cuánto atrás se busca la entrada de una salida, y hasta cuánto se da por "sigue
 * adentro" una entrada sin salida. Pasado eso lo más probable es que la salida no se haya
 * leído (cámara caída, chapa sucia), y un contador corriendo en 9 días sería una mentira
 * con aire de dato.
 */
const VENTANA_PERMANENCIA_MS = 36 * 3600 * 1000;

/** Una fecha de `<input type="date">` (día entero del barrio) o un instante completo. */
const leerLimite = (v: string | null, extremo: "inicio" | "fin"): Date | null => {
    if (!v) return null;
    const dia = limitesDelDia(v);
    if (dia) return dia[extremo];
    const d = new Date(v);
    return isNaN(+d) ? null : d;
};

export async function GET(req: NextRequest) {
    const auth = await verifyApiAuth();
    if (!auth.authenticated) return unauthorizedResponse();

    const sp = req.nextUrl.searchParams;
    const take = Math.min(Number(sp.get("take") || 60), 200);
    const skip = Math.max(Number(sp.get("skip") || 0), 0);
    const buscar = (sp.get("search") || "").trim();
    const desde = leerLimite(sp.get("from"), "inicio");
    const hasta = leerLimite(sp.get("to"), "fin");

    /**
     * Los filtros de acceso: con qué se identificó, si abrió, en qué sentido.
     *
     * La página los tenía como botones desde que se unificó el historial, pero nunca
     * viajaban hasta acá: cambiaban un estado que alimentaba la consulta vieja. Se apretaba
     * "Denegados" y seguían saliendo todos, con el botón encendido.
     */
    const identificacion = sp.get("type") || "ALL";
    const decision = sp.get("decision") || "ALL";
    const sentido = sp.get("direction") || "ALL";

    // Qué tipos se quieren ver. Sin filtro, todos.
    const tipos = (sp.get("tipos") || "").split(",").map((t) => t.trim()).filter(Boolean);
    /** Filtro OmniVision (ids de lib/historial-vision). Sólo aplica a accesos: el seguimiento no tiene análisis. */
    const vision = (sp.get("vision") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const quiere = (t: string) => tipos.length === 0 || tipos.includes(t);
    /*
     * Las cámaras, filtradas en el servidor (cam=… repetido: los nombres pueden tener comas). Antes
     * el filtro se aplicaba sólo sobre lo ya cargado, así que elegir una cámara con pocas lecturas
     * mostraba lo que hubiera entre las primeras 60 filas: casi siempre nada.
     */
    const camaras = sp.getAll("cam").map((c) => c.trim()).filter(Boolean).slice(0, 50);

    const rango: any = {};
    if (desde && !isNaN(+desde)) rango.gte = desde;
    if (hasta && !isNaN(+hasta)) rango.lte = hasta;
    const porFecha = Object.keys(rango).length ? { timestamp: rango } : {};

    /**
     * Cuántas se le piden a cada tabla.
     *
     * De más, porque cuál aporta cada fila del resultado mezclado no se sabe hasta
     * mezclarlas: si se pidieran `take` a cada una y todas las de la página salieran de
     * una sola, faltarían filas.
     *
     * Y UNA MÁS, que es lo que estaba mal. `hay` se contesta comparando el largo de la
     * lista mezclada contra `skip + take`, pero la lista estaba recortada justo en ese
     * número: con una sola fuente aportando —que es exactamente el caso de este barrio,
     * 108 lecturas interiores y ningún acceso todavía— el largo nunca podía SUPERARLO, y
     * `hay` daba false para siempre. La tabla se plantaba en 60 registros y no había
     * botón ni scroll que trajera el resto, porque desde el servidor no había resto.
     *
     * Pedir una de más es la forma barata de contestar "¿queda algo?" sin contar las dos
     * tablas enteras con los mismos filtros.
     */
    const cuantas = skip + take + 1;

    const pedirAccesos = quiere("ACCESO");
    const porVision = vision.length && pedirAccesos ? await idsVision(vision, desde, hasta) : null;
    /*
     * Además de las palabras exactas, la búsqueda por cómo se ve, la misma de OmniVision › Buscar:
     * la frase contra la huella de cada pista que vio OmniVision, y de ahí a los accesos de esa
     * cámara en ese rato. Sólo con algo que parezca una descripción: una matrícula («SCW8055») no
     * se describe, y mandarla a SigLIP sólo trae ruido. Si omni-vision no contesta, se busca igual
     * con lo demás y se dice.
     */
    const pareceDescripcion = buscar.length >= 3 && /[a-záéíóúñ]{3,}/i.test(buscar) && !/^[A-Z]{2,4}\s?-?\d{3,5}$/i.test(buscar);
    const [porBusquedaVision, semantica] = await Promise.all([
        buscar && pedirAccesos ? idsBusquedaVision(buscar, desde, hasta) : Promise.resolve([] as string[]),
        pareceDescripcion
            ? objetosPorTexto(buscar, { desde, hasta, limite: PARECIDOS_MAX }).then((objetos) => ({ objetos, error: null as string | null })).catch((e) => ({ objetos: [] as ObjetoParecido[], error: String(e?.message || e) }))
            : Promise.resolve(null),
    ]);
    const porSemantica = semantica?.objetos.length && pedirAccesos ? await accesosDeObjetos(semantica.objetos).catch(() => [] as string[]) : [];

    /**
     * Qué estados de seguimiento entran.
     *
     * Antes eran dos y se resolvia con un ternario: o estacionados, o pasadas. Con VISTO
     * en el medio ese ternario mentia — pedir "vistos" traia pasadas — asi que la lista se
     * arma y se consulta con un `in`, que es lo que la pregunta era desde el principio.
     */
    const estadosPedidos = ["PASO", "ESTACIONADO", "VISTO"].filter(quiere);
    // Con el filtro OmniVision sólo quedan accesos: las lecturas del seguimiento no se analizan.
    const pedirTrack = estadosPedidos.length > 0 && !vision.length;

    /* OmniVision en cámaras RTSP (ver objetosOmniVision). Los filtros propios de un acceso (con qué
       se identificó, si abrió, en qué sentido) no aplican: con alguno puesto, no entran. */
    // PLATE no cuenta: en un barrio sólo con LPR viene puesto siempre (es el módulo), y lo de OmniVision también es por chapa.
    const filtrosDeAcceso = ["FACE", "TAG"].includes(identificacion) || ["GRANT", "DENY"].includes(decision) || ["ENTRY", "EXIT"].includes(sentido);
    // Con cámaras elegidas (y sin tipos), también los objetos: son de esas cámaras, no miles.
    const quiereOVObjetos = tipos.includes("OV_OBJETO") || (camaras.length > 0 && tipos.length === 0);
    const pedirOV = !filtrosDeAcceso && (quiere("OV_CHAPA") || quiereOVObjetos);
    const { clases: clasesOV, grupos: gruposOV } = clasesDe(vision);

    const [accesos, avistamientos, objetosOV] = await Promise.all([
        pedirAccesos
            ? prisma.accessEvent.findMany({
                where: {
                    ...porFecha,
                    ...(porVision ? { id: { in: porVision.ids } } : {}),
                    ...(camaras.length ? { AND: [{ OR: [{ device: { name: { in: camaras } } }, { location: { in: camaras } }] }] } : {}),
                    // Son enums de Prisma; un valor inventado en la URL no rompe la consulta, se ignora.
                    ...(["PLATE", "FACE", "TAG"].includes(identificacion) ? { accessType: identificacion as any } : {}),
                    ...(["GRANT", "DENY"].includes(decision) ? { decision: decision as any } : {}),
                    ...(["ENTRY", "EXIT"].includes(sentido) ? { direction: sentido as any } : {}),
                    ...(buscar
                        ? {
                            OR: [
                                { plateDetected: { contains: buscar, mode: "insensitive" } },
                                { plateNumber: { contains: buscar, mode: "insensitive" } },
                                { location: { contains: buscar, mode: "insensitive" } },
                                { user: { name: { contains: buscar, mode: "insensitive" } } },
                                // Lo que vio OmniVision en la foto, y la chapa que releyó (ver idsBusquedaVision).
                                ...(porBusquedaVision.length ? [{ id: { in: porBusquedaVision } }] : []),
                                // Lo que se parece a la frase según OmniVision (ver busqueda-vision).
                                ...(porSemantica.length ? [{ id: { in: porSemantica } }] : []),
                            ],
                        }
                        : {}),
                },
                orderBy: { timestamp: "desc" },
                take: cuantas,
                include: { user: { select: { name: true } }, device: { select: { name: true } } },
            })
            : Promise.resolve([] as any[]),
        pedirTrack
            ? prisma.plateSighting.findMany({
                where: {
                    source: "TRACK",
                    ...porFecha,
                    ...(camaras.length ? { cameraName: { in: camaras } } : {}),
                    ...(tipos.length ? { estado: { in: estadosPedidos } } : {}),
                    ...(buscar
                        ? {
                            OR: [
                                { plate: { contains: buscar, mode: "insensitive" } },
                                { cameraName: { contains: buscar, mode: "insensitive" } },
                            ],
                        }
                        : {}),
                },
                orderBy: { timestamp: "desc" },
                take: cuantas,
            })
            : Promise.resolve([] as any[]),
        pedirOV
            ? objetosOmniVision({ soloChapas: !quiereOVObjetos, desde, hasta, buscar, clases: clasesOV, grupos: gruposOV, camaras, limite: cuantas }).catch((e) => { console.error("[historial] OmniVision RTSP:", e?.message); return [] as FilaOV[]; })
            : Promise.resolve([] as FilaOV[]),
    ]);

    const filas: Fila[] = [
        ...accesos.map((a: any): Fila => ({
            id: `a_${a.id}`,
            tipo: "ACCESO",
            momento: a.timestamp.toISOString(),
            plate: a.plateDetected || a.plateNumber || null,
            persona: a.user?.name || null,
            camara: a.device?.name || a.location || null,
            deviceId: a.deviceId || null,
            decision: a.decision || null,
            sentido: a.direction || null,
            confianza: null,
            lecturas: null,
            foto: a.snapshotPath || a.imagePath || null,
            estDesde: null,
            bbox: null,
            estCerrada: false,
            estHasta: null,
            detalles: a.details || null,
            permanencia: null,
            raw: a,
        })),
        ...avistamientos.map((s: any): Fila => ({
            id: `s_${s.id}`,
            tipo: s.estado === "ESTACIONADO" ? "ESTACIONADO" : s.estado === "VISTO" ? "VISTO" : "PASO",
            momento: s.timestamp.toISOString(),
            plate: s.plate,
            persona: null,
            camara: s.cameraName || s.deviceId || null,
            deviceId: s.deviceId || null,
            decision: null,
            sentido: s.eventType || "INTERNAL",
            confianza: s.confidence ?? null,
            lecturas: s.reads ?? null,
            foto: s.snapshotUrl || null,
            estDesde: s.estDesde ? s.estDesde.toISOString() : null,
            bbox: s.bbox || null,
            estCerrada: !!s.estCerrada,
            estHasta: s.estHasta ? s.estHasta.toISOString() : null,
            detalles: null,
            permanencia: null,
            raw: null,
        })),
        ...objetosOV
            // Con el filtro de tipos puesto, cada fila tiene que ser de un tipo pedido (una chapa con «sólo objetos» también entra: es un objeto).
            .filter((o) => tipos.length === 0 || (o.chapa ? quiere("OV_CHAPA") || quiereOVObjetos : quiereOVObjetos))
            .map((o): Fila => {
                const nombre = NOMBRE_CLASE_REGLA[o.clase] || o.clase;
                const rasgos = rasgosOV(o.atributos);
                return {
                    id: `o_${o.id}`,
                    tipo: o.chapa ? "OV_CHAPA" : "OV_OBJETO",
                    momento: new Date(o.primeraVez).toISOString(),
                    plate: o.chapa,
                    // Sin chapa, lo que se puede decir del objeto va en la columna de identificación.
                    persona: `${nombre}${rasgos.length ? ` — ${rasgos.join(", ")}` : ""}`,
                    camara: o.camara,
                    deviceId: o.deviceId,
                    decision: null,
                    sentido: null,
                    confianza: o.chapa ? o.chapaConf : o.confianza,
                    lecturas: o.cuadros ?? null,
                    foto: o.foto || o.recorte ? `/api/vision/imagen/${o.foto || o.recorte}` : null,
                    estDesde: null, bbox: null, estCerrada: false, estHasta: null,
                    detalles: null, permanencia: null, raw: null,
                    vision: { vio: [{ clase: o.clase, nombre, n: 1 }], releida: null, analisis: null },
                    // Para armar la silueta después de paginar (ver tamanoDeFoto): no viaja al navegador.
                    _ov: { camara: o.camara, foto: o.foto, caja: o.caja, clase: o.clase, grupo: o.grupo, nombre, confianza: o.confianza, atributos: o.atributos, chapaCaja: o.chapaCaja },
                } as Fila;
            }),
    ];

    filas.sort((a, b) => b.momento.localeCompare(a.momento));
    const pagina = filas.slice(skip, skip + take);

    const vistas = await visionDe(pagina.filter((f) => f.tipo === "ACCESO" && f.raw?.id).map((f) => f.raw.id)).catch(() => new Map<string, VisionFila>());
    for (const f of pagina) if (f.tipo === "ACCESO" && f.raw?.id) f.vision = vistas.get(f.raw.id) || null;
    // Las filas de OmniVision: su objeto como análisis de la foto, para la capa de siluetas (un recuadro: el registro no guarda contorno).
    await Promise.all(pagina.filter((f) => (f as any)._ov).map(async (f) => {
        const o = (f as any)._ov; delete (f as any)._ov;
        const c = Array.isArray(o.caja) && o.caja.length === 4 ? o.caja.map(Number) : null;
        if (!o.foto || !c || !f.vision) return;
        const t = await tamanoDeFoto(o.camara, o.foto);
        if (!t) return;
        // Dónde está la chapa (vision-worker la guarda desde el 18/10): el visor la marca y acerca, como en LPR.
        const cc = Array.isArray(o.chapaCaja) && o.chapaCaja.length === 4 ? o.chapaCaja.map(Number) : null;
        if (cc && cc[2] > cc[0] && cc[3] > cc[1]) f.bbox = JSON.stringify({ x: cc[0], y: cc[1], w: cc[2] - cc[0], h: cc[3] - cc[1], ar: t.w / t.h });
        f.vision.analisis = {
            ancho: t.w, alto: t.h,
            objetos: [{ clase: o.clase, nombre: o.nombre, grupo: o.grupo, confianza: o.confianza, caja: c as [number, number, number, number], silueta: null, atributos: Array.isArray(o.atributos) ? o.atributos : null }],
        };
    }));
    // El logo de la empresa: de la visita abierta a esa hora, o del proveedor dueño del vehículo.
    const conChapa = pagina.filter((f) => f.plate && !esNoLeida(f.plate));
    const empresas = await empresasDeLecturas(conChapa.map((f) => ({ clave: f.id, plate: f.plate as string, momento: new Date(f.momento) }))).catch(() => new Map());
    for (const f of conChapa) f.empresa = empresas.get(f.id) || null;

    /**
     * Permanencia de las salidas: cuánto estuvo adentro ese mismo vehículo.
     *
     * Se calcula solo para las salidas de ESTA página y con UNA consulta, no una por
     * fila. Antes salía de tener todos los eventos cargados en el navegador, que dejó de
     * ser cierto al paginar: mirar la página siguiente no puede cambiar el dato.
     */
    const salidas = pagina.filter((f) => f.tipo === "ACCESO" && f.sentido === "EXIT" && f.plate);
    if (salidas.length) {
        const chapas = [...new Set(salidas.map((f) => norm(f.plate as string)))];
        const masVieja = new Date(Math.min(...salidas.map((f) => +new Date(f.momento))) - VENTANA_PERMANENCIA_MS);
        const entradas = await prisma.accessEvent.findMany({
            where: { direction: "ENTRY", timestamp: { gte: masVieja }, plateDetected: { in: chapas } },
            orderBy: { timestamp: "desc" },
            select: { plateDetected: true, timestamp: true },
            take: 500,
        });
        for (const f of salidas) {
            const chapa = norm(f.plate as string);
            const salio = +new Date(f.momento);
            const entro = entradas.find((e) => norm(e.plateDetected || "") === chapa && +e.timestamp < salio);
            if (entro) f.permanencia = Math.round((salio - +entro.timestamp) / 1000);
        }
    }

    /**
     * Tiempo adentro de las entradas: la salida posterior de ese mismo vehículo, si la hubo.
     *
     * Es el dato que alimenta la columna "Tiempo": una entrada sin salida dentro de la
     * ventana cuenta en vivo; con salida, queda quieta en su total. Misma idea que la
     * permanencia pero mirada desde la entrada, y con una sola consulta por página.
     */
    const entradas = pagina.filter((f) => f.tipo === "ACCESO" && f.sentido === "ENTRY" && f.decision !== "DENY" && f.plate);
    if (entradas.length) {
        const chapas = [...new Set(entradas.map((f) => norm(f.plate as string)))];
        const masVieja = new Date(Math.min(...entradas.map((f) => +new Date(f.momento))));
        const salidasPost = await prisma.accessEvent.findMany({
            where: { direction: "EXIT", timestamp: { gte: masVieja }, plateDetected: { in: chapas } },
            orderBy: { timestamp: "asc" },
            select: { plateDetected: true, timestamp: true },
            take: 500,
        });
        const ahora = Date.now();
        for (const f of entradas) {
            const chapa = norm(f.plate as string);
            const entro = +new Date(f.momento);
            const salio = salidasPost.find((e) => norm(e.plateDetected || "") === chapa && +e.timestamp > entro);
            if (salio) { f.salida = salio.timestamp.toISOString(); f.adentro = false; }
            else { f.salida = null; f.adentro = ahora - entro <= VENTANA_PERMANENCIA_MS; }
        }
    }

    // `hay` dice si conviene pedir otra página: sobró al menos una de las que se pidieron
    // de más. Un total exacto exigiría contar las dos tablas con los mismos filtros y no
    // cambia nada de lo que se puede hacer con el resultado.
    return NextResponse.json({
        filas: pagina,
        hay: filas.length > skip + take,
        enPagina: pagina.length,
        /** El filtro OmniVision llegó al tope: se miraron sólo las VISION_IDS_MAX lecturas más nuevas. */
        visionTruncado: !!porVision?.truncado,
        /**
         * Lo que OmniVision vio parecido a la frase, sea o no un acceso: las mejores pistas, para
         * mostrarlas arriba de la tabla. Sólo en la primera página.
         */
        omnivision: semantica && skip === 0 ? {
            error: semantica.error,
            total: semantica.objetos.length,
            accesos: porSemantica.length,
            objetos: semantica.objetos.slice(0, OBJETOS_EN_FRANJA).map((o) => ({
                id: o.id, camara: o.camara, clase: o.clase, grupo: o.grupo, momento: o.primeraVez.toISOString(), recorte: o.recorte, prob: Math.round(o.prob * 1000) / 1000,
            })),
        } : null,
    });
}
