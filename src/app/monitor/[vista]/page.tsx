"use client";

import { use } from "react";
import { esVista } from "@/lib/monitor/vistas";
import { ListaVistas } from "@/components/monitor/ListaVistas";
import { VistaIntrusion } from "@/components/monitor/vistas/VistaIntrusion";
import { VistaLpr } from "@/components/monitor/vistas/VistaLpr";
import { VistaMapa } from "@/components/monitor/vistas/VistaMapa";
import { VistaResumen } from "@/components/monitor/vistas/VistaResumen";
import { VistaSalud } from "@/components/monitor/vistas/VistaSalud";
import { VistaRotacion } from "@/components/monitor/vistas/VistaRotacion";

const COMPONENTES = { intrusion: VistaIntrusion, lpr: VistaLpr, mapa: VistaMapa, resumen: VistaResumen, salud: VistaSalud, rotacion: VistaRotacion } as const;

export default function PaginaVista({ params }: { params: Promise<{ vista: string }> }) {
    const { vista } = use(params);
    if (!esVista(vista)) return <ListaVistas titulo="Esta vista no existe" subtitulo="Las vistas de pantalla disponibles son:" />;
    const Comp = COMPONENTES[vista];
    return <Comp />;
}
