"use client";

import { usePathname } from "next/navigation";
import AlertaIntrusionGlobal from "@/components/intrusion/AlertaIntrusionGlobal";

/**
 * Olivos: la alerta global de intrusion se impone en las vistas de pared que la necesitan
 * (Rotacion, Resumen, Salud), pero NO en Control LPR ni en Intrusion (que ya la muestra en sus canales): esa pantalla vive en la
 * garita y el perimetro de Olivos genera cruces de linea seguido; taparle la lectura al
 * guardia en cada uno le haria perder el semaforo y la matricula.
 */
export function AlertaSegunVista(props: { soloLectura?: boolean; decide?: boolean }) {
    const ruta = usePathname() || "";
    // En Intrusion la propia pared ya pone cada canal en rojo: la ventana encima la tapaba entera.
    if (ruta.startsWith("/monitor/lpr") || ruta.startsWith("/monitor/intrusion")) return null;
    return <AlertaIntrusionGlobal {...(props as any)} />;
}
