import { redirect } from "next/navigation";
import { getEnabledModules } from "@/app/actions/modules";
import { getSession } from "@/app/actions/auth";
import { inicioPara } from "@/lib/landing";
import { permisosDeSesion } from "@/lib/permisos";

/** El inicio del panel: el monitor del modo, o la primera pantalla que el rol pueda abrir (lib/landing). */
export default async function AdminPage() {
    const [modules, sesion] = await Promise.all([getEnabledModules(), getSession()]);
    redirect(inicioPara(modules, permisosDeSesion(sesion as any)));
}
