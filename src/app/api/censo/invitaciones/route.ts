import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { leerPlanilla, nuevaClave, type FilaPlanilla } from "@/lib/censo-invitaciones";
import { configCorreo, probarCorreo } from "@/lib/correo";
import { estadoDeGoteo, guardarGoteo, leerGoteoGuardado, mandarInvitacion } from "@/lib/censo-envio";
import { leerGoteo } from "@/lib/censo-goteo";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const PERMISO = "usuarios.editar";
/**
 * Cuántas se pueden mandar «ya», de un saque. Es para reenviarle a alguien o para una tanda de
 * prueba; el envío de todo el padrón va de a poco (accion «goteo»), que es lo que evita que 490
 * correos iguales salgan en cinco minutos y terminen en spam.
 */
const POR_TANDA = 25;

/**
 * Las invitaciones del censo: un lote, su correo y su clave.
 *
 * GET    — la lista y el resumen.
 * POST   — la planilla (multipart, xlsx o csv): da de alta las invitaciones que faltan.
 * PUT    — { accion: "goteo" | "enviar" | "probar" | "clave" } : poner en marcha o pausar el envío
 *          de a poco, mandar unas pocas ya, probar el correo, prender o apagar la clave por lote.
 * DELETE — ?id= : sacar una invitación.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
type Sesion = any;
async function permitido(): Promise<NextResponse | { sesion: Sesion; quien: string }> {
    const s: Sesion = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(PERMISO)) return NextResponse.json({ error: "Tu rol no puede manejar el censo." }, { status: 403 });
    return { sesion: s, quien: String(s.name || s.sub || "panel") };
}

const conClave = async () => (await prisma.setting.findUnique({ where: { key: "CENSO_CON_CLAVE" } }))?.value === "true";

export async function GET() {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const [filas, cfg] = await Promise.all([
        prisma.invitacionCenso.findMany({ orderBy: [{ enviadoAt: "asc" }, { lote: "asc" }], take: 2000 }),
        configCorreo(),
    ]);
    return NextResponse.json({
        conClave: await conClave(),
        correoListo: !!cfg,
        copiaAdmin: cfg?.copia || "",
        goteo: await estadoDeGoteo(),
        invitaciones: filas.map((f) => ({
            id: f.id, lote: f.lote, email: f.email, nombre: f.nombre, clave: f.clave,
            enviadoAt: f.enviadoAt?.toISOString() || null, usadoAt: f.usadoAt?.toISOString() || null,
            intentos: f.intentos, error: f.error,
        })),
    }, { headers: SIN_CACHE });
}

/** La planilla. Se acepta .xlsx y .csv, que es lo que manda una administración. */
export async function POST(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const form = await req.formData().catch(() => null);
    const archivo = form?.get("archivo");
    if (!(archivo instanceof File)) return NextResponse.json({ error: "Falta la planilla." }, { status: 400 });
    if (archivo.size > 4 * 1024 * 1024) return NextResponse.json({ error: "La planilla es muy grande (tope 4 MB)." }, { status: 400 });

    const buf = Buffer.from(await archivo.arrayBuffer());
    let filas: unknown[][] = [];
    try {
        if (/\.csv$/i.test(archivo.name)) {
            // El separador se adivina de la primera línea: una administración exporta con ; tanto como con ,
            const texto = buf.toString("utf8").replace(/^﻿/, "");
            const sep = (texto.split("\n")[0].match(/;/g)?.length || 0) > (texto.split("\n")[0].match(/,/g)?.length || 0) ? ";" : ",";
            filas = texto.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "")));
        } else {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf as unknown as ArrayBuffer);
            const hoja = wb.worksheets[0];
            if (!hoja) return NextResponse.json({ error: "La planilla no tiene ninguna hoja." }, { status: 400 });
            hoja.eachRow((fila) => {
                const vals = Array.isArray(fila.values) ? fila.values.slice(1) : [];
                // Una celda con hipervínculo viene como objeto {text, hyperlink}: lo que vale es el texto.
                filas.push(vals.map((v) => (v && typeof v === "object" ? ((v as { text?: string }).text ?? "") : v)));
            });
        }
    } catch {
        return NextResponse.json({ error: "No se pudo leer la planilla. Guardala como .xlsx o .csv." }, { status: 400 });
    }

    const lectura = leerPlanilla(filas);
    if (!lectura.filas.length) return NextResponse.json({ error: lectura.errores[0] || "No se encontró ningún lote con correo.", errores: lectura.errores }, { status: 400 });

    let nuevas = 0, actualizadas = 0;
    for (const f of lectura.filas as FilaPlanilla[]) {
        /* La invitación es por PERSONA (su correo) desde el 21/11: dos personas del mismo lote
           tienen cada una la suya. Esta planilla simple (lote, nombre, correo) sigue sirviendo
           para un barrio sin administraciones; el padrón de un complejo por etapas entra por
           Administraciones › Importar padrón, que además crea los lotes y las personas. */
        const hay = await prisma.invitacionCenso.findFirst({ where: { sitio: "", email: f.email }, select: { id: true, lote: true } });
        if (hay) {
            // La clave NO se cambia al reimportar: si ya se mandó el correo, cambiarla deja afuera
            // a quien lo recibió. Sólo se corrige el lote y el nombre.
            await prisma.invitacionCenso.update({ where: { id: hay.id }, data: { lote: f.lote, nombre: f.nombre } });
            if (hay.lote !== f.lote) actualizadas++;
        } else {
            await prisma.invitacionCenso.create({ data: { sitio: "", lote: f.lote, email: f.email, nombre: f.nombre, clave: nuevaClave() } });
            nuevas++;
        }
    }
    await auditar(q.sesion, "censo.importar-invitaciones", archivo.name, true, `${nuevas} nuevas, ${actualizadas} con el lote corregido, ${lectura.errores.length} avisos`);
    return NextResponse.json({ nuevas, actualizadas, repetidos: lectura.repetidos, errores: lectura.errores }, { headers: SIN_CACHE });
}

export async function PUT(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const b = await req.json().catch(() => null);

    if (b?.accion === "probar") {
        const r = await probarCorreo();
        return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: SIN_CACHE });
    }

    if (b?.accion === "clave") {
        const valor = b?.valor === true;
        await prisma.setting.upsert({ where: { key: "CENSO_CON_CLAVE" }, update: { value: String(valor) }, create: { key: "CENSO_CON_CLAVE", value: String(valor) } });
        await auditar(q.sesion, "censo.clave-por-lote", valor ? "prendida" : "apagada", true, "");
        return NextResponse.json({ conClave: valor }, { headers: SIN_CACHE });
    }

    /* La dirección pública de este sitio, como la ve quien está en el panel: con ella se arman los enlaces. */
    const origen = req.nextUrl.origin.replace(/^http:/, req.headers.get("x-forwarded-proto") === "https" ? "https:" : "http:");

    if (b?.accion === "goteo") {
        const antes = await leerGoteoGuardado();
        const pedido = leerGoteo({ ...antes, ...(typeof b?.cadaSeg === "number" ? { cadaSeg: b.cadaSeg } : {}), ...(typeof b?.desde === "number" ? { desde: b.desde } : {}), ...(typeof b?.hasta === "number" ? { hasta: b.hasta } : {}) });
        const activo = typeof b?.activo === "boolean" ? b.activo : antes.activo;
        if (activo && !(await configCorreo())) return NextResponse.json({ error: "Falta configurar el servidor de correo (Ajustes → Correo)." }, { status: 400 });
        /* Al ponerlo en marcha se empieza de cero: sin fallas arrastradas, sin motivo viejo, y el
           primero sale en la próxima vuelta. Al pausarlo queda dicho quién lo pausó. */
        const nuevo = activo && !antes.activo ? { ...pedido, activo: true, fallas: 0, motivo: null, proximo: null, origen }
            : !activo && antes.activo ? { ...pedido, activo: false, proximo: null, motivo: `Pausado por ${q.quien}.` }
                : { ...pedido, activo, origen: antes.origen || origen };
        await guardarGoteo(nuevo);
        if (activo !== antes.activo) await auditar(q.sesion, activo ? "censo.envio-de-a-poco.empezar" : "censo.envio-de-a-poco.pausar", `uno cada ${nuevo.cadaSeg} s, de ${nuevo.desde} a ${nuevo.hasta} h`, true, "");
        return NextResponse.json({ goteo: await estadoDeGoteo() }, { headers: SIN_CACHE });
    }

    if (b?.accion === "enviar") {
        const cfg = await configCorreo();
        if (!cfg) return NextResponse.json({ error: "Falta configurar el servidor de correo (Ajustes → Correo)." }, { status: 400 });
        const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, POR_TANDA) : [];
        const where = ids.length ? { id: { in: ids } } : { enviadoAt: null };
        /* Sin elegir cuáles, «enviar» son todas las que faltan — y si son más que una tanda, eso es
           un envío masivo: va de a poco o no va. */
        if (!ids.length && (await prisma.invitacionCenso.count({ where })) > POR_TANDA) {
            return NextResponse.json({ error: `Son más de ${POR_TANDA}: mandarlas todas juntas es la forma de terminar en spam. Usá el envío de a poco.` }, { status: 400 });
        }
        const pendientes = await prisma.invitacionCenso.findMany({ where, orderBy: { lote: "asc" }, take: POR_TANDA });
        if (!pendientes.length) return NextResponse.json({ mandados: 0, fallados: 0, quedan: 0 }, { headers: SIN_CACHE });

        let mandados = 0, fallados = 0;
        for (const inv of pendientes) {
            const r = await mandarInvitacion(inv, origen);
            if (r.ok) mandados++; else fallados++;
        }
        const quedan = await prisma.invitacionCenso.count({ where: { enviadoAt: null } });
        await auditar(q.sesion, "censo.enviar-invitaciones", `${pendientes.length} lotes`, mandados > 0, `${mandados} mandados, ${fallados} fallados, quedan ${quedan}`);
        return NextResponse.json({ mandados, fallados, quedan }, { headers: SIN_CACHE });
    }

    return NextResponse.json({ error: "No sé qué hacer con eso." }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "Falta cuál." }, { status: 400 });
    const inv = await prisma.invitacionCenso.delete({ where: { id } }).catch(() => null);
    if (!inv) return NextResponse.json({ error: "Esa invitación ya no está." }, { status: 404 });
    await auditar(q.sesion, "censo.borrar-invitacion", `${inv.lote} · ${inv.email}`, true, "");
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
}
