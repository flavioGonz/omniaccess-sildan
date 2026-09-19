import React from "react";
/*
 * Una sola tipografia en toda la aplicacion, tambien aca.
 *
 * Esta ruta cargaba Montserrat mientras el resto carga Outfit. No era una decision de
 * diseno para el puesto de guardia: es que este arbol de rutas se escribio aparte y se
 * quedo con la fuente que tenia entonces. El costo no se veia porque nadie tiene las dos
 * pantallas al lado -- y ese es justamente el problema, que la inconsistencia solo
 * aparece cuando alguien compara, que es cuando ya quedo mal.
 */
import { Outfit } from "next/font/google";

const outfit = Outfit({
    subsets: ["latin"],
    weight: ["300", "400", "500", "600", "700", "800", "900"],
    variable: "--font-outfit",
});

import { PushNotificationManager } from "@/components/PushNotificationManager";

export default function GuardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className={`${outfit.variable} font-sans fixed inset-0 bg-slate-100 text-slate-900 overflow-hidden selection:bg-[#B20D30] selection:text-white`}>
            <PushNotificationManager />
            {children}
        </div>
    );
}
