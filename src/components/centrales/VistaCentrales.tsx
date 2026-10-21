"use client";

import { useCallback, useEffect, useState } from "react";
import { Siren, FlaskConical } from "lucide-react";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Chip } from "@/components/ui/estados";

/** La lista de centrales de alarma en Dispositivos (vista «Centrales de alarma»). */
type Fila = { id: string; deviceId: string; nombre: string; modelo: string; cuenta: string; protocolo: string; cifrado: boolean; lanVpn: boolean; prueba: boolean; estado: string; ultimoMensajeAt: string | null; ipOrigen: string | null; zonas: number };
const MODELO: Record<string, string> = { "ax-pro": "Hikvision AX PRO", "ax-hybrid": "Hikvision AX Hybrid PRO", generica: "DC-09 genérica" };
const ESTADO: Record<string, { r: string; t: "bien" | "info" | "mal" }> = { EN_LINEA: { r: "En línea", t: "bien" }, ESPERANDO: { r: "Esperando", t: "info" }, SIN_SUPERVISION: { r: "Sin supervisión", t: "mal" } };
const hace = (iso: string | null) => {
    if (!iso) return "nunca";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? `hace ${Math.max(0, s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : new Date(iso).toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit" });
};

export function VistaCentrales({ alAbrir, version, busqueda = "" }: { alAbrir: (id: string) => void; version?: number; busqueda?: string }) {
    const [filas, setFilas] = useState<Fila[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const cargar = useCallback(() => {
        fetch("/api/centrales", { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`); return j; })
            .then((j) => { setFilas(j.centrales || []); setError(null); }).catch((e) => setError(e?.message || "No se pudieron leer las centrales"));
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, 15_000); return () => clearInterval(iv); }, [cargar, version]);
    const t = busqueda.trim().toLowerCase();
    const columnas: ColumnaTabla<Fila>[] = [
        { clave: "nombre", titulo: "Central", valor: (f) => f.nombre, celda: (f) => (
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted/60 tono-mal"><Siren size={15} /></span>
                <div className="min-w-0"><div className="text-[13px] font-semibold truncate">{f.nombre}</div><div className="text-[11px] text-muted-foreground truncate">{MODELO[f.modelo] || f.modelo}</div></div>
                {f.prueba && <Chip tono="quieto" icono={FlaskConical}>Prueba</Chip>}
            </div>) },
        { clave: "estado", titulo: "Estado", ancho: 140, valor: (f) => ESTADO[f.estado]?.r || f.estado, celda: (f) => <Chip tono={ESTADO[f.estado]?.t || "info"} pleno={f.estado === "SIN_SUPERVISION"}>{ESTADO[f.estado]?.r || f.estado}</Chip> },
        { clave: "ultimo", titulo: "Último mensaje", ancho: 150, valor: (f) => f.ultimoMensajeAt || "", celda: (f) => <div className="leading-tight tabular-nums"><div className="text-[12.5px]">{hace(f.ultimoMensajeAt)}</div>{f.ipOrigen && <div className="text-[11px] text-muted-foreground">{f.ipOrigen}</div>}</div> },
        { clave: "cuenta", titulo: "Cuenta", ancho: 110, valor: (f) => f.cuenta, celda: (f) => <div className="leading-tight"><div className="text-[12.5px] font-semibold tabular-nums">{f.cuenta}</div><div className="text-[11px] text-muted-foreground">{f.cifrado ? `*${f.protocolo}` : `${f.protocolo} · sin cifrar`}</div></div> },
        { clave: "zonas", titulo: "Zonas", ancho: 70, alinear: "der", valor: (f) => f.zonas },
    ];
    return (
        <Tabla<Fila> filas={(filas || []).filter((f) => !t || `${f.nombre} ${f.cuenta}`.toLowerCase().includes(t))} clave={(f) => f.id} columnas={columnas} cargando={filas === null && !error} error={error} alReintentar={cargar}
            alClickFila={(f) => alAbrir(f.id)} controles={false}
            vacio={{ icono: Siren, titulo: "Sin centrales de alarma", ayuda: "Agregá una con «Agregar» → Central de alarma." }} />
    );
}
