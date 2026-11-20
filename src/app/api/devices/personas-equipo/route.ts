import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { HikvisionDriver } from "@/lib/drivers/HikvisionDriver";
import {
    altaRostro, altaTarjeta, altaUsuario, borrarRostro, borrarTarjeta, borrarUsuario,
    buscarPersona, modificarUsuario, tarjetasDe, type EquipoHik,
} from "@/lib/rostros-equipo";

export const dynamic = "force-dynamic";
const VER = "dispositivos";
const EDITAR = "dispositivos.editar";

/**
 * Las PERSONAS de un control de acceso: crearlas, cambiarlas, borrarlas, y sus tarjetas y su cara.
 *
 * Hasta ahora sólo se podían manejar los rostros, y una cara no vive sola: cuelga de un usuario
 * del equipo. Faltaba el otro lado — el nombre, la vigencia y las tarjetas —, que es justamente lo
 * que hace que alguien pueda abrir una puerta.
 *
 * GET  ?deviceId=&legajo=   → la persona, sus tarjetas y si tiene cara.
 * GET  ?deviceId=&buscar=   → candidatos del padrón de OmniAccess para cargar de una.
 * POST { accion }           → alta | modificar | borrar | tarjeta.alta | tarjeta.borrar
 *                             | rostro.alta | rostro.borrar | padron
 *
 * Todo lo que escribe pide «Editar dispositivos» y queda en Auditoría: esto decide quién entra.
 */

async function equipo(id: string) {
    const d = await prisma.device.findUnique({
        where: { id },
        select: { id: true, name: true, ip: true, username: true, password: true, authType: true, httpPort: true, brand: true, deviceType: true },
    });
    return d && String(d.brand) === "HIKVISION" ? d : null;
}

export async function GET(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s || !permisosDeSesion(s).includes(VER)) return NextResponse.json({ error: "Tu rol no puede ver los equipos." }, { status: 403 });

    const q = req.nextUrl.searchParams;
    const buscar = (q.get("buscar") || "").trim();
    if (buscar) {
        /* Candidatos del padrón para cargar de una: con su cara y sus tarjetas, que es lo que se
           va a empujar al equipo. Pocos y ordenados por nombre: esto es un buscador, no un listado. */
        const gente = await prisma.user.findMany({
            where: { name: { contains: buscar, mode: "insensitive" } },
            select: { id: true, name: true, apartment: true, cara: true, legajoEquipos: true, credentials: { where: { type: "TAG" }, select: { value: true } } },
            orderBy: { name: "asc" }, take: 8,
        });
        return NextResponse.json({
            gente: gente.map((u) => ({
                id: u.id, nombre: u.name, unidad: u.apartment, conCara: !!u.cara,
                legajo: u.legajoEquipos, tarjetas: u.credentials.map((c) => c.value),
            })),
        }, { headers: { "Cache-Control": "no-store" } });
    }

    const d = await equipo(String(q.get("deviceId") || ""));
    if (!d) return NextResponse.json({ error: "Ese equipo no existe o no es Hikvision." }, { status: 404 });
    const legajo = String(q.get("legajo") || "");
    if (!legajo) return NextResponse.json({ error: "Falta el legajo." }, { status: 400 });

    const [persona, tarjetas] = await Promise.all([buscarPersona(d as EquipoHik, legajo), tarjetasDe(d as EquipoHik, legajo)]);
    return NextResponse.json({ persona, tarjetas }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(EDITAR)) return NextResponse.json({ error: "Tu rol no puede cambiar las personas de un equipo." }, { status: 403 });

    const b = await req.json().catch(() => null) as {
        accion?: string; deviceId?: string; legajo?: string; nombre?: string | null;
        desde?: string | null; hasta?: string | null; tarjeta?: string; jpegB64?: string; userId?: string;
    } | null;
    const d = await equipo(String(b?.deviceId || ""));
    if (!d) return NextResponse.json({ error: "Ese equipo no existe o no es Hikvision." }, { status: 404 });
    const eq = d as EquipoHik;
    const legajo = String(b?.legajo || "").trim();
    const fin = async (accion: string, r: { ok: boolean; error?: string }, detalle: string) => {
        await auditar(s, accion, d.id, r.ok, `${d.name} · ${detalle}${r.error ? ` · ${r.error}` : ""}`);
        return NextResponse.json(r, { status: r.ok ? 200 : 502 });
    };

    switch (b?.accion) {
        case "alta": {
            if (!legajo) return NextResponse.json({ error: "Falta el número de la persona." }, { status: 400 });
            /* Si ese número ya está ocupado, NO se pisa: sería cambiarle el nombre a otro. */
            if (await buscarPersona(eq, legajo)) return NextResponse.json({ error: `El equipo ya tiene una persona con el número ${legajo}.` }, { status: 409 });
            const r = await altaUsuario(eq, legajo, b.nombre || null);
            if (r.ok && (b.desde || b.hasta)) await modificarUsuario(eq, legajo, { desde: b.desde, hasta: b.hasta });
            if (r.ok && b.tarjeta) await altaTarjeta(eq, legajo, b.tarjeta);
            if (r.ok && b.jpegB64) await altaRostro(eq, legajo, b.nombre || null, Buffer.from(b.jpegB64, "base64"));
            return fin("equipos.persona.alta", r, legajo);
        }
        case "modificar": {
            if (!legajo) return NextResponse.json({ error: "Falta el número de la persona." }, { status: 400 });
            const r = await modificarUsuario(eq, legajo, { nombre: b.nombre, desde: b.desde, hasta: b.hasta });
            return fin("equipos.persona.modificar", r, legajo);
        }
        case "borrar": {
            if (!legajo) return NextResponse.json({ error: "Falta el número de la persona." }, { status: 400 });
            const r = await borrarUsuario(eq, legajo);
            return fin("equipos.persona.borrar", r, legajo);
        }
        case "tarjeta.alta": {
            if (!legajo || !b.tarjeta) return NextResponse.json({ error: "Falta el número de la persona o de la tarjeta." }, { status: 400 });
            const r = await altaTarjeta(eq, legajo, String(b.tarjeta));
            return fin("equipos.tarjeta.alta", r, `${legajo} · ${b.tarjeta}`);
        }
        case "tarjeta.borrar": {
            if (!b.tarjeta) return NextResponse.json({ error: "Falta el número de la tarjeta." }, { status: 400 });
            const r = await borrarTarjeta(eq, String(b.tarjeta));
            return fin("equipos.tarjeta.borrar", r, String(b.tarjeta));
        }
        case "rostro.alta": {
            if (!legajo || !b.jpegB64) return NextResponse.json({ error: "Falta el número de la persona o la foto." }, { status: 400 });
            const r = await altaRostro(eq, legajo, b.nombre || null, Buffer.from(b.jpegB64, "base64"));
            return fin("equipos.rostro.alta", r, legajo);
        }
        case "rostro.borrar": {
            if (!legajo) return NextResponse.json({ error: "Falta el número de la persona." }, { status: 400 });
            const r = await borrarRostro(eq, legajo);
            return fin("equipos.rostro.borrar", r, legajo);
        }
        case "padron": {
            /* Traer a alguien del padrón es el MISMO camino que la sincronización: así el número
               se elige con la regla medida y la cara sale de donde ya está, en vez de pedirle a
               una persona que invente un legajo y vuelva a subir una foto que ya tenemos. */
            const u = await prisma.user.findUnique({ where: { id: String(b.userId || "") }, include: { credentials: true } });
            if (!u) return NextResponse.json({ error: "Esa persona no está en el padrón." }, { status: 404 });
            const dev = await prisma.device.findUnique({ where: { id: d.id } });
            const res = await new HikvisionDriver().sincronizarPersona(u, dev!);
            const ok = res.persona;
            await auditar(s, "equipos.persona.padron", d.id, ok, `${d.name} · ${u.name} → ${res.legajo}${res.avisos.length ? ` · ${res.avisos.join(" · ")}` : ""}`);
            return NextResponse.json({ ok, ...res }, { status: ok ? 200 : 502 });
        }
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
