"use client";

import { use } from "react";
import { PowerOff } from "lucide-react";
import { esVista, vistaPorClave } from "@/lib/monitor/vistas";
import { funcionPorId } from "@/lib/funciones";
import { ListaVistas } from "@/components/monitor/ListaVistas";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { VistaIntrusion } from "@/components/monitor/vistas/VistaIntrusion";
import { VistaLpr } from "@/components/monitor/vistas/VistaLpr";
import { VistaMapa } from "@/components/monitor/vistas/VistaMapa";
import { VistaResumen } from "@/components/monitor/vistas/VistaResumen";
import { VistaSalud } from "@/components/monitor/vistas/VistaSalud";
import { VistaRotacion } from "@/components/monitor/vistas/VistaRotacion";
import { VistaCamaras } from "@/components/monitor/vistas/VistaCamaras";
import { VistaAlarmas } from "@/components/monitor/vistas/VistaAlarmas";

const COMPONENTES = { intrusion: VistaIntrusion, alarmas: VistaAlarmas, lpr: VistaLpr, mapa: VistaMapa, resumen: VistaResumen, salud: VistaSalud, rotacion: VistaRotacion, camaras: VistaCamaras } as const;

/**
 * Una vista cuya función de la instalación está apagada (openspec alarmas-como-funciones) no muestra
 * un error: dice que está apagada, y vuelve sola cuando se prende (el marco relee cada minuto).
 */
function Apagada({ nombre, funcion }: { nombre: string; funcion: string }) {
    return (
        <div className="absolute inset-0 grid place-items-center p-8">
            <div className="max-w-xl text-center space-y-4">
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-muted text-muted-foreground"><PowerOff size={38} /></span>
                <h1 className="text-[32px] font-bold leading-tight">Esta vista está apagada en la instalación</h1>
                <p className="text-[18px] text-muted-foreground">«{nombre}» necesita la función «{funcion}», que está apagada. Se prende en Ajustes → Modos; esta pantalla vuelve sola en menos de un minuto.</p>
            </div>
        </div>
    );
}

export default function PaginaVista({ params }: { params: Promise<{ vista: string }> }) {
    const { vista } = use(params);
    const { funciones } = useMarco();
    if (!esVista(vista)) return <ListaVistas titulo="Esta vista no existe" subtitulo="Las vistas de pantalla disponibles son:" />;
    const v = vistaPorClave(vista)!;
    if (v.funcion && funciones && funciones[v.funcion] === false) return <Apagada nombre={v.nombre} funcion={funcionPorId(v.funcion)?.nombre || v.funcion} />;
    const Comp = COMPONENTES[vista];
    return <Comp />;
}
