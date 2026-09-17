"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationBell } from "@/components/ui/notification-bell";
import { contarAlertasActivas } from "@/app/actions/alertas";

/** Campana del panel: cuenta alertas de equipos abiertas y camaras caidas. */
export default function AlertBell({ className }: { className?: string }) {
    const router = useRouter();
    const [count, setCount] = useState(0);
    const [criticas, setCriticas] = useState(0);

    useEffect(() => {
        let vivo = true;
        const leer = async () => {
            try {
                const r = await contarAlertasActivas();
                if (!vivo) return;
                setCount(r.total);
                setCriticas(r.criticas);
            } catch { }
        };
        leer();
        const t = setInterval(leer, 30000);
        return () => { vivo = false; clearInterval(t); };
    }, []);

    return (
        <div
            className={className}
            title={count === 0 ? "Sin alertas abiertas" : `${count} alerta(s) abierta(s)`}
            onClick={() => router.push("/admin/notificaciones")}
        >
            <NotificationBell
                count={count}
                max={99}
                size={30}
                color={criticas > 0 ? "red" : "orange"}
            />
        </div>
    );
}
