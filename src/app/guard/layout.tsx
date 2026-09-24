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
import localFont from "next/font/local";

/* Misma fuente local que el layout raíz — ver el comentario largo allá. Acá además se
   pedían siete pesos sueltos; la variable los trae todos en un solo archivo. */
const outfit = localFont({
    variable: "--font-outfit",
    display: "swap",
    src: [
        { path: "../fuentes/outfit-latin.woff2", style: "normal", weight: "100 900" },
        { path: "../fuentes/outfit-latin-ext.woff2", style: "normal", weight: "100 900" },
    ],
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
