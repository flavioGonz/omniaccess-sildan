"use client";

import { AlertTriangle } from "lucide-react";
import { Chip } from "@/components/ui/estados";

/** Lo que comparten la lista y la ficha de las analíticas entrenables. */
export type ZonaLista = {
    id: string; nombre: string; deviceId: string; camara: string; positivo: string; negativo: string;
    umbral: number; avisar: boolean; activa: boolean; cadaSeg: number; sostenerSeg: number;
    modelo: { exactitud: number | null; n: { pos: number; neg: number }; entrenado: string } | null;
    estado: { prob?: number; fuente?: string; al?: string; muestraUrl?: string | null; positivoDesde?: string | null; avisado?: boolean; armada?: boolean; error?: string | null } | null;
    conteo: { pos: number; neg: number; sin: number };
};

export const haceCuanto = (iso?: string | null) => {
    if (!iso) return "";
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return `hace ${s} s`;
    const m = Math.round(s / 60);
    return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h ${m % 60} min`;
};

/** El estado de ahora como lo dice la tarjeta: el nombre del estado y su probabilidad. */
export function EstadoAhora({ z }: { z: ZonaLista }) {
    const p = z.estado?.prob;
    if (z.estado?.error) return <Chip tono="mal" icono={AlertTriangle}>{z.estado.error}</Chip>;
    if (p == null) return <Chip tono="quieto">Todavía no miró</Chip>;
    const avisa = p >= z.umbral;
    return <Chip tono={avisa ? "aviso" : "quieto"}>{avisa ? z.positivo : z.negativo} · <span className="tabular-nums">{Math.round((avisa ? p : 1 - p) * 100)} %</span></Chip>;
}

