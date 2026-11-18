import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { getAppBranding } from "@/app/actions/settings";
import { correoDeInvitacion, leerPlanilla, nuevaClave, type FilaPlanilla } from "@/lib/censo-invitaciones";
import { configCorreo, enviarCorreo, probarCorreo } from "@/lib/correo";

export const dynamic = "force-dynamic";
const SIN_CACHE = { "Cache-Control": "no-store" };
const PERMISO = "usuarios.editar";
/** Un envío por vuelta: más que esto no entra en el tiempo de una petición y el servidor de correo corta. */
const POR_TANDA = 25;

/**
 * Las invitaciones del censo: un lote, su correo y su clave.
 *
 * GET    — la lista y el resumen.
 * POST   — la planilla (multipart, xlsx o csv): da de alta las invitaciones que faltan.
 * PUT    — { accion: "enviar" | "probar" | "clave" } : mandar la tanda, probar el correo, prender
 *          o apagar la clave por lote.
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
        const hay = await prisma.invitacionCenso.findFirst({ where: { sitio: "", lote: f.lote }, select: { id: true, email: true } });
        if (hay) {
            // La clave NO se cambia al reimportar: si ya se mandó el correo, cambiarla deja afuera
            // a quien lo recibió. Sólo se corrige el correo y el nombre.
            await prisma.invitacionCenso.update({ where: { id: hay.id }, data: { email: f.email, nombre: f.nombre } });
            if (hay.email !== f.email) actualizadas++;
        } else {
            await prisma.invitacionCenso.create({ data: { sitio: "", lote: f.lote, email: f.email, nombre: f.nombre, clave: nuevaClave() } });
            nuevas++;
        }
    }
    await auditar(q.sesion, "censo.importar-invitaciones", archivo.name, true, `${nuevas} nuevas, ${actualizadas} con el correo corregido, ${lectura.errores.length} avisos`);
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

    if (b?.accion === "enviar") {
        const cfg = await configCorreo();
        if (!cfg) return NextResponse.json({ error: "Falta configurar el servidor de correo (Ajustes → Correo)." }, { status: 400 });
        const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, POR_TANDA) : [];
        const where = ids.length ? { id: { in: ids } } : { enviadoAt: null };
        const pendientes = await prisma.invitacionCenso.findMany({ where, orderBy: { lote: "asc" }, take: POR_TANDA });
        if (!pendientes.length) return NextResponse.json({ mandados: 0, fallados: 0, quedan: 0 }, { headers: SIN_CACHE });

        const marca = await getAppBranding();
        const origen = req.nextUrl.origin.replace(/^http:/, req.headers.get("x-forwarded-proto") === "https" ? "https:" : "http:");
        let mandados = 0, fallados = 0;
        for (const inv of pendientes) {
            const { asunto, texto, html } = correoDeInvitacion({
                barrio: marca.barrio || marca.name, lote: inv.lote, nombre: inv.nombre || undefined,
                clave: inv.clave, url: `${origen}/registro/${inv.clave}`,
            });
            const r = await enviarCorreo({ para: inv.email, asunto, texto, html });
            if (r.ok) { mandados++; await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { enviadoAt: new Date(), intentos: { increment: 1 }, error: null } }); }
            else { fallados++; await prisma.invitacionCenso.update({ where: { id: inv.id }, data: { intentos: { increment: 1 }, error: r.error || "no se pudo" } }); }
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
