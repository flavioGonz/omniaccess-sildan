import type { Metadata } from "next";
import { MarcoMonitor } from "@/components/monitor/MarcoMonitor";
import AlertaIntrusionGlobal from "@/components/intrusion/AlertaIntrusionGlobal";

export const metadata: Metadata = { title: "OmniAccess · Monitor" };
export const dynamic = "force-dynamic";

/**
 * El layout de las vistas de pantalla: sin el panel alrededor. El marco pone el encabezado,
 * la vitalidad y la pantalla completa; la alerta global se monta en modo sólo lectura para
 * que una intrusión confirmada se imponga sobre cualquier vista de la pared.
 */
export default function MonitorLayout({ children }: { children: React.ReactNode }) {
    return (
        <MarcoMonitor>
            {children}
            <AlertaIntrusionGlobal soloLectura />
        </MarcoMonitor>
    );
}
