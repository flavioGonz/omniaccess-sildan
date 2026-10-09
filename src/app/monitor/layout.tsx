import type { Metadata } from "next";
import { MarcoMonitor } from "@/components/monitor/MarcoMonitor";
import AlertaIntrusionGlobal from "@/components/intrusion/AlertaIntrusionGlobal";
import { getSession } from "@/app/actions/auth";
import { permisosDeSesion, puedeAbrir } from "@/lib/permisos";

export const metadata: Metadata = { title: "OmniAccess · Monitor" };
export const dynamic = "force-dynamic";

/**
 * El layout de las vistas de pantalla: sin el panel alrededor. El marco pone el encabezado,
 * la vitalidad y la pantalla completa; la alerta global se monta en modo sólo lectura para
 * que una intrusión confirmada se imponga sobre cualquier vista de la pared.
 */
export default async function MonitorLayout({ children }: { children: React.ReactNode }) {
    /*
     * Quién mira. Un enlace de pantalla es de sólo lectura; una persona que entró al panel y
     * tiene el monitor de intrusión puede decidir también desde acá (confirmar, falsa alarma,
     * resolver), con los mismos permisos que en el panel. Las acciones van por la sesión.
     */
    const sesion: any = await getSession().catch(() => null);
    const puedeDecidir = !!sesion && puedeAbrir(permisosDeSesion(sesion), "/admin/monitor-intrusion");
    return (
        <MarcoMonitor puedeDecidir={puedeDecidir}>
            {children}
            <AlertaIntrusionGlobal soloLectura decide={puedeDecidir} />
        </MarcoMonitor>
    );
}
