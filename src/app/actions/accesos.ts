"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/app/actions/auth";
import { CLAVES_PERMISOS, PERMISOS_OPERADOR, esAdministrador, permisosDeSesion } from "@/lib/permisos";
import { uploadToS3 } from "@/lib/s3";
import bcrypt from "bcryptjs";

/**
 * Accesos al panel: los usuarios del sistema y los roles de la aplicación.
 *
 * Reemplaza a getAdminsList / saveAdmin / deleteAdmin, que sólo conocían dos roles fijos
 * (ADMIN / OPERATOR). Un usuario del sistema es el que tiene un rol de aplicación
 * (`appRoleId`); su `role` legado se mantiene en ADMIN u OPERATOR según el rol tenga todo o
 * no, porque varias pantallas viejas todavía preguntan `role === "ADMIN"`.
 *
 * Quién puede tocar esto: sólo quien tiene el permiso `accesos`. Se verifica acá, no sólo en
 * la pantalla, porque una acción de servidor se puede llamar sin pasar por la pantalla.
 */

const ROL_ADMIN_ID = "rol-administrador";
const ROL_OPERADOR_ID = "rol-operador";

async function exigirAccesos() {
    const s: any = await getSession();
    // Compatibilidad: una sesión vieja (sin perms) de un ADMIN legado también puede.
    if (!permisosDeSesion(s).includes("accesos")) throw new Error("No tenés permiso para administrar los accesos al panel.");
    return s;
}

/** Al arrancar: que existan los dos roles de sistema y que Administrador tenga TODO el catálogo. */
export async function asegurarRolesDeSistema() {
    await prisma.appRole.upsert({
        where: { id: ROL_ADMIN_ID },
        update: { permisos: CLAVES_PERMISOS, esSistema: true },
        create: { id: ROL_ADMIN_ID, nombre: "Administrador", descripcion: "Acceso total al panel, incluidos los accesos de otros usuarios.", permisos: CLAVES_PERMISOS, esSistema: true },
    });
    await prisma.appRole.upsert({
        where: { id: ROL_OPERADOR_ID },
        update: { esSistema: true },
        create: { id: ROL_OPERADOR_ID, nombre: "Operador", descripcion: "Opera el sistema sin tocar padrón, equipos ni ajustes.", permisos: PERMISOS_OPERADOR, esSistema: true },
    });
}

// ── Roles ──────────────────────────────────────────────────────────────────────────────

export type RolApp = { id: string; nombre: string; descripcion: string; permisos: string[]; esSistema: boolean; usuarios: number; createdAt: Date; updatedAt: Date };

export async function getRolesApp(): Promise<RolApp[]> {
    await asegurarRolesDeSistema();
    const roles = await prisma.appRole.findMany({ include: { _count: { select: { users: true } } }, orderBy: [{ esSistema: "desc" }, { nombre: "asc" }] });
    return roles.map((r) => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion, permisos: r.permisos, esSistema: r.esSistema, usuarios: r._count.users, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

export async function saveRolApp(data: { id?: string; nombre: string; descripcion?: string; permisos: string[] }) {
    await exigirAccesos();
    const nombre = (data.nombre || "").trim();
    if (!nombre) return { ok: false, error: "El rol necesita un nombre." };
    const permisos = [...new Set((data.permisos || []).filter((p) => CLAVES_PERMISOS.includes(p)))];
    try {
        if (data.id === ROL_ADMIN_ID) {
            // Administrador siempre tiene todo: si se le pudiera sacar "accesos" nadie podría volver a entrar a esta pantalla.
            const r = await prisma.appRole.update({ where: { id: data.id }, data: { descripcion: data.descripcion ?? "" } });
            return { ok: true, rol: r };
        }
        const r = data.id
            ? await prisma.appRole.update({ where: { id: data.id }, data: { nombre, descripcion: data.descripcion ?? "", permisos } })
            : await prisma.appRole.create({ data: { nombre, descripcion: data.descripcion ?? "", permisos } });
        // Los usuarios con este rol pasan a ADMIN/OPERATOR legado según lo que el rol tenga ahora.
        await prisma.user.updateMany({ where: { appRoleId: r.id }, data: { role: esAdministrador(r.permisos) ? "ADMIN" : "OPERATOR" } });
        revalidatePath("/admin/settings");
        return { ok: true, rol: r };
    } catch (e: any) {
        if (String(e?.code) === "P2002") return { ok: false, error: `Ya hay un rol que se llama "${nombre}".` };
        return { ok: false, error: e?.message || "No se pudo guardar el rol" };
    }
}

export async function duplicarRolApp(id: string) {
    await exigirAccesos();
    const base = await prisma.appRole.findUnique({ where: { id } });
    if (!base) return { ok: false, error: "El rol no existe" };
    let nombre = `${base.nombre} (copia)`; let n = 2;
    while (await prisma.appRole.findUnique({ where: { nombre } })) nombre = `${base.nombre} (copia ${n++})`;
    const r = await prisma.appRole.create({ data: { nombre, descripcion: base.descripcion, permisos: base.permisos } });
    revalidatePath("/admin/settings");
    return { ok: true, rol: r };
}

export async function deleteRolApp(id: string) {
    await exigirAccesos();
    const r = await prisma.appRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!r) return { ok: false, error: "El rol no existe" };
    if (r.esSistema) return { ok: false, error: "Los roles de sistema (Administrador, Operador) no se borran." };
    if (r._count.users > 0) return { ok: false, error: `${r._count.users} usuario${r._count.users === 1 ? " lo usa" : "s lo usan"}: asignales otro rol antes de borrarlo.` };
    await prisma.appRole.delete({ where: { id } });
    revalidatePath("/admin/settings");
    return { ok: true };
}

// ── Usuarios del sistema ────────────────────────────────────────────────────────────────

export type UsuarioSistema = {
    id: string; name: string; email: string | null; phone: string | null; cara: string | null;
    role: string; appRoleId: string | null; rolNombre: string | null; permisos: string[];
    tienePassword: boolean; createdAt: Date; updatedAt: Date; createdBy: string | null; esLider: boolean;
};

export async function getUsuariosSistema(): Promise<UsuarioSistema[]> {
    await asegurarRolesDeSistema();
    // Usuario del sistema = tiene rol de aplicación, o quedó con el role legado (por si alguno
    // no se migró). Nunca residentes.
    const users = await prisma.user.findMany({
        where: { OR: [{ appRoleId: { not: null } }, { role: { in: ["ADMIN", "OPERATOR"] as any } }] },
        include: { appRole: true, credentials: { where: { type: "PASSWORD" }, select: { id: true } } },
        orderBy: { name: "asc" },
    });
    return users.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone, cara: u.cara, role: String(u.role),
        appRoleId: u.appRoleId, rolNombre: u.appRole?.nombre || (u.role === "ADMIN" ? "Administrador" : u.role === "OPERATOR" ? "Operador" : null),
        permisos: u.appRole?.permisos || (u.role === "ADMIN" ? CLAVES_PERMISOS : PERMISOS_OPERADOR),
        tienePassword: u.credentials.length > 0, createdAt: u.createdAt, updatedAt: u.updatedAt, createdBy: u.createdBy,
        esLider: u.name === "fgonzalez",
    }));
}

export async function saveUsuarioSistema(formData: FormData) {
    const sesion: any = await exigirAccesos();
    const id = (formData.get("id") as string) || "";
    const name = ((formData.get("name") as string) || "").trim();
    const email = ((formData.get("email") as string) || "").trim();
    const phone = ((formData.get("phone") as string) || "").trim();
    const password = (formData.get("password") as string) || "";
    const appRoleId = (formData.get("appRoleId") as string) || "";
    const photoFile = formData.get("photo") as File | null;
    const currentPhoto = (formData.get("currentPhoto") as string) || "";
    if (!name) return { ok: false, error: "El usuario (login) es obligatorio." };
    if (!appRoleId) return { ok: false, error: "Elegí un rol." };
    const rol = await prisma.appRole.findUnique({ where: { id: appRoleId } });
    if (!rol) return { ok: false, error: "El rol elegido no existe." };
    if (!id && !password) return { ok: false, error: "Un usuario nuevo necesita contraseña." };

    let photoPath = currentPhoto;
    if (photoFile && photoFile.size > 0) {
        try {
            const buffer = Buffer.from(await photoFile.arrayBuffer());
            const fileName = `admin-${Date.now()}-${photoFile.name.replace(/[^a-zA-Z0-9.]/g, "_")}`;
            photoPath = await uploadToS3(buffer, fileName, photoFile.type || "image/jpeg", "face");
        } catch (e: any) { return { ok: false, error: `No se pudo guardar la foto: ${e?.message || e}` }; }
    }

    const data: any = {
        name, email: email || null, phone: phone || null, cara: photoPath || null,
        appRoleId,
        // El role legado acompaña al rol de aplicación (pantallas viejas preguntan por ADMIN).
        role: esAdministrador(rol.permisos) ? "ADMIN" : "OPERATOR",
    };
    try {
        let user;
        if (id) {
            // Nadie se saca a sí mismo el permiso de accesos: se quedaría afuera de esta pantalla.
            if (id === sesion?.sub && !rol.permisos.includes("accesos")) return { ok: false, error: "No podés quitarte a vos mismo el permiso de Accesos al panel." };
            user = await prisma.user.update({ where: { id }, data });
        } else {
            const existe = await prisma.user.findFirst({ where: { name } });
            if (existe) return { ok: false, error: `El usuario "${name}" ya existe.` };
            user = await prisma.user.create({ data: { ...data, createdBy: sesion?.name || null } });
        }
        if (password) {
            await prisma.credential.deleteMany({ where: { userId: user.id, type: "PASSWORD" } });
            // Se guarda ya con hash: el login aceptaba texto plano y lo migraba al primer ingreso,
            // pero no hay motivo para que la clave viva en claro ni un día.
            await prisma.credential.create({ data: { userId: user.id, type: "PASSWORD", value: await bcrypt.hash(password, 12) } });
        }
        revalidatePath("/admin/settings");
        return { ok: true, user };
    } catch (e: any) {
        return { ok: false, error: e?.message || "No se pudo guardar" };
    }
}

export async function deleteUsuarioSistema(id: string) {
    const sesion: any = await exigirAccesos();
    if (id === sesion?.sub) return { ok: false, error: "No podés borrar tu propio usuario mientras estás adentro." };
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return { ok: false, error: "El usuario no existe" };
    if (u.name === "fgonzalez") return { ok: false, error: "El usuario líder no se borra desde acá." };
    await prisma.user.delete({ where: { id } });
    revalidatePath("/admin/settings");
    return { ok: true };
}
