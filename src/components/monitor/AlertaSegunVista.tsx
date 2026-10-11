"use client";

import { usePathname } from "next/navigation";
import AlertaIntrusionGlobal from "@/components/intrusion/AlertaIntrusionGlobal";

/**
 * Olivos: la alerta global de intrusion se impone en las vistas de pared que la necesitan
 * (Intrusion, Rotacion, Resumen, Salud), pero NO en Control LPR: esa pantalla vive en la
 * garita y el perimetro de Olivos genera cruces de linea seguido; taparle la lectura al
 * guardia en cada uno le haria perder el semaforo y la matricula.
 */
export function AlertaSegunVista(props: { soloLectura?: boolean; decide?: boolean }) {
    const ruta = usePathname() || "";
    if (ruta.startsWith("/monitor/lpr")) return null;
    return <AlertaIntrusionGlobal {...(props as any)} />;
}
