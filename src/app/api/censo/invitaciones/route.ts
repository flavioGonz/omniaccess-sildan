import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { leerPlanilla, nuevaClave, type FilaPlanilla } from "@/lib/censo-invitaciones";
import { configCorreo, copiaFija, probarCorreo } from "@/lib/correo";
import { hayDesdeDondeMandar } from "@/lib/correo-administracion";
import { estadoDeGoteo, guardarGoteo, invitacionesDePersona, leerGoteoGuardado, mandarInvitacion } from "@/lib/censo-envio";
import { leerGoteo } from "@/lib/censo-goteo";
import { revisarDominio } from "@/lib/correo-dominio";
import { origenPublico } from "@/lib/origen-publico";

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
 * GET    — la lista, el resumen y si el dominio del remitente está en condiciones de mandar.
 *          `?resumen=1`: sólo en qué está cada invitación, sin claves — lo que usa el padrón.
 * POST   — la planilla (multipart, xlsx o csv): da de alta las invitaciones que faltan.
 * PUT    — { accion: "goteo" | "enviar" | "persona" | "probar" | "clave" } : poner en marcha o
 *          pausar el envío de a poco, mandar unas pocas ya, mandársela a una persona del padrón,
 *          probar el correo, prender o apagar la clave por lote.
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

const resumida = (f: { userId: string | null; email: string; enviadoAt: Date | null; usadoAt: Date | null; error: string | null; unitId?: string | null; lote?: string; nombre?: string }, miembros?: string[]) =>
    ({ userId: f.userId, email: f.email, enviadoAt: f.enviadoAt?.toISOString() || null, usadoAt: f.usadoAt?.toISOString() || null, error: f.error,
        unitId: f.unitId ?? null, lote: f.lote, nombre: f.nombre, ...(miembros ? { miembros } : {}) });

/**
 * Si lo que falta mandar pasa por el servidor general (Ajustes › Correo). Desde el 25/11 cada
 * administración manda desde su Gmail, y Gmail firma y autoriza lo suyo: el aviso de que el dominio
 * del servidor general (infratec.com.uy) manda a spam sólo vale para las invitaciones de lotes sin
 * administración. Con todas por las casillas de las administraciones, ese aviso en rojo asustaba
 * por un servidor que no se iba a usar (Nico: «debés arreglar eso en rojo, ya que el envío es desde
 * las cuentas de administraciones, que son Gmail»).
 */
const usaElServidorGeneral = (g: Awaited<ReturnType<typeof estadoDeGoteo>>) => g.porCuenta.some((c) => !c.administracionId && c.pendientes > 0);

export async function GET(req: NextRequest) {
    const q = await permitido(); if (q instanceof NextResponse) return q;
    if (req.nextUrl.searchParams.get("resumen") === "1") {
        const [filas, cfg] = await Promise.all([
            prisma.invitacionCenso.findMany({ where: { sitio: "" }, select: { userId: true, email: true, enviadoAt: true, usadoAt: true, error: true, unitId: true, lote: true, nombre: true }, take: 5000 }),
            configCorreo(),
        ]);
        const dominio = cfg && usaElServidorGeneral(await estadoDeGoteo()) ? await revisarDominio({ desde: cfg.desde, host: cfg.host }).catch(() => null) : null;
        return NextResponse.json({
            correoListo: await hayDesdeDondeMandar(), copiaAdmin: await copiaFija(),
            /* El padrón no muestra el detalle del DNS, pero quien va a mandar tiene que saberlo. */
            aSpam: dominio?.estado === "mal" ? dominio.titulo : null,
            /* Un código por lote (25/11): con quiénes son de cada lote, el padrón muestra a cada persona el estado de su lote aunque el código le haya llegado a otra. */
            invitaciones: await (async () => {
                const vinc = await prisma.userUnidad.findMany({ where: { unitId: { in: filas.map((f) => f.unitId).filter((x): x is string => !!x) } }, select: { unitId: true, userId: true } });
                const miembros = new Map<string, string[]>();
                for (const v of vinc) miembros.set(v.unitId, [...(miembros.get(v.unitId) || []), v.userId]);
                return filas.map((f) => resumida(f, f.unitId ? miembros.get(f.unitId) || [] : undefined));
            })(),
        }, { headers: SIN_CACHE });
    }
    const [filas, cfg, goteo] = await Promise.all([
        prisma.invitacionCenso.findMany({ orderBy: [{ enviadoAt: "asc" }, { lote: "asc" }], take: 2000 }),
        configCorreo(), estadoDeGoteo(),
    ]);
    return NextResponse.json({
        conClave: await conClave(),
        /* Hay desde dónde mandar: el servidor general o alguna administración con su cuenta (25/11). */
        correoListo: await hayDesdeDondeMandar(),
        copiaAdmin: await copiaFija(),
        /* Si el dominio del remitente no autoriza a este servidor, los correos van a spam: se dice
           acá, antes de mandar. `?dns=1` vuelve a preguntarle al DNS (después de corregirlo). */
        dominio: cfg && usaElServidorGeneral(goteo) ? await revisarDominio({ desde: cfg.desde, host: cfg.host }, req.nextUrl.searchParams.get("dns") === "1").catch(() => null) : null,
        goteo,
        invitaciones: filas.map((f) => ({
            id: f.id, lote: f.lote, email: f.email, nombre: f.nombre, clave: f.clave,
            enviadoAt: f.enviadoAt?.toISOString() || null, usadoAt: f.usadoAt?.toISOString() || null,
            intentos: f.intentos, error: f.error, enviadoDesde: f.enviadoDesde,
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
        /* Esta planilla simple (lote, nombre, correo) sigue sirviendo para un barrio sin
           administraciones; el padrón de un complejo por etapas entra por Administraciones ›
           Importar padrón, que además crea los lotes y las personas. */
        /* Desde el 25/11, una por LOTE: el renglón dice a qué correo le llega el código de ese lote. */
        const unidad = await prisma.unit.findFirst({ where: { OR: [{ name: f.lote }, { lot: f.lote }] }, select: { id: true, name: true } });
        const hay = await prisma.invitacionCenso.findFirst({ where: { sitio: "", ...(unidad ? { unitId: unidad.id } : { lote: f.lote }) }, select: { id: true, email: true } });
        if (hay) {
            // La clave NO se cambia al reimportar: si ya se mandó el correo, cambiarla deja afuera
            // a quien lo recibió. Se corrige a quién le llega y el nombre.
            await prisma.invitacionCenso.update({ where: { id: hay.id }, data: { email: f.email, nombre: f.nombre, aMano: true } });
            if (hay.email !== f.email) actualizadas++;
        } else {
            await prisma.invitacionCenso.create({ data: { sitio: "", lote: unidad?.name || f.lote, unitId: unidad?.id || null, lotes: unidad ? [{ unitId: unidad.id, nombre: unidad.name, vinculo: "PROPIETARIO" }] : [], email: f.email, nombre: f.nombre, clave: nuevaClave(), aMano: true } });
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

    /* La dirección pública de este sitio: con ella se arman los enlaces (ver lib/origen-publico). Antes
       salía de `req.nextUrl.origin`, que detrás del proxy es localhost:10001, y así salieron los
       primeros correos del censo (25/11). Sin una dirección pública no se manda nada. */
    const origen = await origenPublico({ pedido: req.headers });
    const sinOrigen = () => NextResponse.json({ error: "No se sabe la dirección pública del sistema para armar los enlaces: cargala en Ajustes (URL pública, BASE_URL)." }, { status: 400 });

    if (b?.accion === "goteo") {
        const antes = await leerGoteoGuardado();
        const pedido = leerGoteo({ ...antes, ...(typeof b?.cadaSeg === "number" ? { cadaSeg: b.cadaSeg } : {}), ...(typeof b?.desde === "number" ? { desde: b.desde } : {}), ...(typeof b?.hasta === "number" ? { hasta: b.hasta } : {}) });
        const activo = typeof b?.activo === "boolean" ? b.activo : antes.activo;
        if (activo && !origen) return sinOrigen();
        if (activo && !(await hayDesdeDondeMandar())) return NextResponse.json({ error: "No hay desde dónde mandar: cargá la cuenta de correo de cada administración (Administraciones › Correo)." }, { status: 400 });
        /* Al ponerlo en marcha se empieza de cero: sin fallas arrastradas, sin motivo viejo, y el
           primero sale en la próxima vuelta. Al pausarlo queda dicho quién lo pausó. */
        const nuevo = activo && !antes.activo ? { ...pedido, activo: true, fallas: 0, motivo: null, proximo: null, origen: origen! }
            : !activo && antes.activo ? { ...pedido, activo: false, proximo: null, motivo: `Pausado por ${q.quien}.` }
                : { ...pedido, activo, origen: origen || antes.origen };
        await guardarGoteo(nuevo);
        if (activo !== antes.activo) await auditar(q.sesion, activo ? "censo.envio-de-a-poco.empezar" : "censo.envio-de-a-poco.pausar", `uno cada ${nuevo.cadaSeg} s, de ${nuevo.desde} a ${nuevo.hasta} h`, true, "");
        return NextResponse.json({ goteo: await estadoDeGoteo() }, { headers: SIN_CACHE });
    }

    if (b?.accion === "persona") {
        if (!(await hayDesdeDondeMandar())) return NextResponse.json({ error: "No hay desde dónde mandar: cargá la cuenta de correo de cada administración (Administraciones › Correo)." }, { status: 400 });
        if (!origen) return sinOrigen();
        /* Un código por lote (25/11): se le manda el de cada lote donde es la principal, uno por lote. */
        const r = await invitacionesDePersona(String(b?.userId || ""));
        if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
        let ok = 0; const fallas: string[] = [];
        for (const inv of r.invs) {
            const envio = await mandarInvitacion(inv, origen);
            await auditar(q.sesion, "censo.enviar-invitacion", `${inv.nombre || "sin nombre"} · ${inv.lote}`, envio.ok, envio.ok ? "desde el padrón" : envio.error || "no se pudo");
            if (envio.ok) ok++; else fallas.push(`${inv.lote}: ${envio.error || "el servidor de correo no lo aceptó"}`);
        }
        const como = await prisma.invitacionCenso.findFirst({ where: { id: { in: r.invs.map((i) => i.id) } }, orderBy: { enviadoAt: "desc" }, select: { userId: true, email: true, enviadoAt: true, usadoAt: true, error: true, unitId: true, lote: true, nombre: true } });
        return NextResponse.json({ ok: !fallas.length, enviadas: ok, error: fallas.length ? `No salió: ${fallas.join(" · ")}` : undefined, invitacion: como ? resumida(como) : null }, { status: fallas.length && !ok ? 502 : 200, headers: SIN_CACHE });
    }

    if (b?.accion === "enviar") {
        if (!(await hayDesdeDondeMandar())) return NextResponse.json({ error: "No hay desde dónde mandar: cargá la cuenta de correo de cada administración (Administraciones › Correo)." }, { status: 400 });
        const ids: string[] = Array.isArray(b?.ids) ? b.ids.slice(0, POR_TANDA) : [];
        const where = ids.length ? { id: { in: ids } } : { enviadoAt: null };
        /* Sin elegir cuáles, «enviar» son todas las que faltan — y si son más que una tanda, eso es
           un envío masivo: va de a poco o no va. */
        if (!ids.length && (await prisma.invitacionCenso.count({ where })) > POR_TANDA) {
            return NextResponse.json({ error: `Son más de ${POR_TANDA}: mandarlas todas juntas es la forma de terminar en spam. Usá el envío de a poco.` }, { status: 400 });
        }
        if (!origen) return sinOrigen();
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
