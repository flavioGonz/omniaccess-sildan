import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion } from "@/lib/permisos";
import { auditar } from "@/lib/centrales/sesion";
import { prisma } from "@/lib/prisma";
import { altaRostro, borrarRostro, copiarRostro, daFotos, listarRostros, type EquipoHik, type RostroEquipo } from "@/lib/rostros-equipo";

export const dynamic = "force-dynamic";
const VER = "dispositivos";
const EDITAR = "dispositivos.editar";

/**
 * Los rostros cargados en un equipo Hikvision.
 *
 * GET  ?deviceId=            → la lista (FPID, nombre, si trae foto y si trae plantilla).
 * POST { accion: "borrar" }  → borra los FPID elegidos.
 * POST { accion: "copiar" }  → copia los FPID elegidos a otro equipo.
 * POST { accion: "alta" }    → carga una cara nueva (la foto va en base64).
 *
 * Todo lo que escribe pide «Editar dispositivos» y queda en Auditoría: cargar o borrar una cara
 * cambia quién puede entrar por una puerta, y eso tiene que poder explicarse después.
 */

async function equipo(id: string): Promise<(EquipoHik & { id: string; name: string; brand: string }) | null> {
    const d = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, ip: true, username: true, password: true, authType: true, httpPort: true, brand: true } });
    return d ? { ...d, brand: String(d.brand) } : null;
}

export async function GET(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(VER)) return NextResponse.json({ error: "Tu rol no puede ver los equipos." }, { status: 403 });

    const d = await equipo(String(req.nextUrl.searchParams.get("deviceId") || ""));
    if (!d) return NextResponse.json({ error: "Ese equipo no existe." }, { status: 404 });
    if (d.brand !== "HIKVISION") return NextResponse.json({ error: "Sólo se leen los rostros de equipos Hikvision." }, { status: 400 });

    try {
        const { rostros, total } = await listarRostros(d);
        /* Qué se puede hacer con ESTE equipo. `daFoto` se MIDE bajando una cara: el terminal
           declara una faceURL para las 71 y esa URL contesta 404, así que creerle llenaba la
           pantalla de imágenes rotas (ver `daFotos` en lib/rostros-equipo). */
        const foto = await daFotos(d, rostros);
        return NextResponse.json({
            total,
            daFoto: foto,
            daPlantilla: rostros.some((r) => !!r.modelo),
            rostros: rostros.map((r) => ({ fpid: r.fpid, nombre: r.nombre, foto: foto && !!r.fotoUrl, plantilla: !!r.modelo })),
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "No se pudieron leer los rostros" }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la sesión es el JWT crudo
    const s: any = await getSession().catch(() => null);
    if (!s) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
    if (!permisosDeSesion(s).includes(EDITAR)) return NextResponse.json({ error: "Tu rol no puede cambiar los rostros de un equipo." }, { status: 403 });

    const b = await req.json().catch(() => null) as { accion?: string; deviceId?: string; destinoId?: string; fpids?: string[]; fpid?: string; nombre?: string; jpegB64?: string } | null;
    const d = await equipo(String(b?.deviceId || ""));
    if (!d) return NextResponse.json({ error: "Ese equipo no existe." }, { status: 404 });

    if (b?.accion === "alta") {
        if (!b.fpid || !b.jpegB64) return NextResponse.json({ error: "Falta el legajo o la foto." }, { status: 400 });
        const r = await altaRostro(d, b.fpid, b.nombre || null, Buffer.from(b.jpegB64, "base64"));
        await auditar(s, "equipos.rostro.alta", d.id, r.ok, `${d.name} · ${b.fpid}${r.error ? ` · ${r.error}` : ""}`);
        return NextResponse.json(r, { status: r.ok ? 200 : 502 });
    }

    const fpids = (b?.fpids || []).map(String).filter(Boolean);
    if (!fpids.length) return NextResponse.json({ error: "No se eligió ningún rostro." }, { status: 400 });

    if (b?.accion === "borrar") {
        const hechos: { fpid: string; ok: boolean; error?: string }[] = [];
        for (const f of fpids) hechos.push({ fpid: f, ...(await borrarRostro(d, f)) });
        const ok = hechos.filter((x) => x.ok).length;
        await auditar(s, "equipos.rostro.borrar", d.id, ok === fpids.length, `${d.name} · ${ok} de ${fpids.length} borrados`);
        return NextResponse.json({ ok: ok === fpids.length, hechos });
    }

    if (b?.accion === "copiar") {
        const destino = await equipo(String(b?.destinoId || ""));
        if (!destino) return NextResponse.json({ error: "No se eligió a qué equipo copiarlos." }, { status: 400 });
        const { rostros } = await listarRostros(d);
        const porFpid = new Map<string, RostroEquipo>(rostros.map((r) => [r.fpid, r]));
        const hechos: { fpid: string; ok: boolean; via?: string; error?: string }[] = [];
        for (const f of fpids) {
            const r = porFpid.get(f);
            if (!r) { hechos.push({ fpid: f, ok: false, error: "ya no está en el equipo de origen" }); continue; }
            hechos.push({ fpid: f, ...(await copiarRostro(d, destino, r)) });
        }
        const ok = hechos.filter((x) => x.ok).length;
        await auditar(s, "equipos.rostro.copiar", d.id, ok === fpids.length, `${d.name} → ${destino.name} · ${ok} de ${fpids.length}`);
        return NextResponse.json({ ok: ok === fpids.length, hechos });
    }

    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
