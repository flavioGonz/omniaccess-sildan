"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMarco } from "@/components/monitor/MarcoMonitor";
import { usarDatos } from "@/lib/monitor/cliente";
import { vistaPorClave, type ClaveVista } from "@/lib/monitor/vistas";
import { ROTACION_SEG_MIN, ROTACION_SEG_POR_DEFECTO, ROTACION_VISTAS_POR_DEFECTO } from "@/lib/monitor/ajustes";
import { VistaIntrusion } from "./VistaIntrusion";
import { VistaLpr } from "./VistaLpr";
import { VistaMapa } from "./VistaMapa";
import { VistaResumen } from "./VistaResumen";
import { VistaSalud } from "./VistaSalud";

/**
 * Rotación: alterna las vistas configuradas en Monitores cada N segundos, con fundido.
 * Una intrusión confirmada o pendiente la clava en Intrusión hasta que se resuelva: una
 * pared que sigue girando mientras hay alguien adentro es una pared que no sirve.
 */
const COMPONENTES: Record<Exclude<ClaveVista, "rotacion">, React.ComponentType> = { intrusion: VistaIntrusion, lpr: VistaLpr, mapa: VistaMapa, resumen: VistaResumen, salud: VistaSalud };
type Alarmas = { pendientes: any[]; confirmadas: any[] };

export function VistaRotacion() {
    const { ajustes, setTitulo, latir } = useMarco();
    const vistas = useMemo(() => (ajustes?.rotacion?.vistas?.length ? ajustes.rotacion.vistas : [...ROTACION_VISTAS_POR_DEFECTO]).filter((v) => v in COMPONENTES) as Exclude<ClaveVista, "rotacion">[], [ajustes]);
    const segundos = Math.max(ROTACION_SEG_MIN, ajustes?.rotacion?.segundos || ROTACION_SEG_POR_DEFECTO);
    const [i, setI] = useState(0);
    const { datos: alarmas } = usarDatos<Alarmas>("/api/monitor/alarmas", 15_000, latir);
    const clavada = !!alarmas && (alarmas.pendientes.length > 0 || alarmas.confirmadas.length > 0) && vistas.includes("intrusion");
    useEffect(() => { if (clavada) return; const iv = setInterval(() => setI((x) => (x + 1) % Math.max(1, vistas.length)), segundos * 1000); return () => clearInterval(iv); }, [segundos, vistas.length, clavada]);
    const actual = clavada ? "intrusion" : vistas[i % Math.max(1, vistas.length)] || "resumen";
    const siguiente = vistas[(i + 1) % Math.max(1, vistas.length)];
    useEffect(() => { setTitulo(`${vistaPorClave(actual)?.nombre || actual} · rotación`); }, [actual, setTitulo]);
    const Comp = COMPONENTES[actual];
    return (
        <div className="absolute inset-0">
            <AnimatePresence mode="wait">
                <motion.div key={actual} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="absolute inset-0">
                    <Comp />
                </motion.div>
            </AnimatePresence>
            <div className="absolute bottom-3 right-4 z-[700] flex items-center gap-2 px-3 py-1 rounded-full bg-black/55 text-white/70 text-[12px] font-semibold backdrop-blur-sm">
                {clavada ? <span className="text-red-200">Rotación detenida: intrusión sin resolver</span> : <>{vistas.map((v) => <span key={v} className={v === actual ? "text-white" : "text-white/35"}>●</span>)}<span className="ml-1">siguiente: {vistaPorClave(siguiente)?.nombre || siguiente}</span></>}
            </div>
        </div>
    );
}
