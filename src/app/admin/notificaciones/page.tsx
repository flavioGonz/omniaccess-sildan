import { redirect } from "next/navigation";

/**
 * El centro de notificaciones se mudó a Configuración → Notificaciones. Esta ruta queda
 * para los enlaces viejos (marcadores, la campana de versiones anteriores, avisos que la
 * citan) y lleva a la misma parte que se pedía.
 */
export default async function NotificacionesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
    const { tab } = await searchParams;
    redirect(`/admin/settings?seccion=notificaciones&tab=${encodeURIComponent(tab || "canales")}`);
}
