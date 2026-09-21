"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Momento, Matricula, Miniatura, Nada } from "@/components/ui/celdas";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";
import { History, ScanLine, Radar, PhoneCall, KeyRound, AlertTriangle, Link2Off } from "lucide-react";

/**
 * La auditoría de una persona: todo lo que el sistema sabe de ella, en una línea de tiempo.
 *
 * ## Qué junta y por qué estaba separado
 *
 * La misma persona deja rastro en cuatro tablas y cada una se miraba en otra pantalla: los
 * accesos con su identidad, las lecturas de sus matrículas en la barrera, los avistamientos
 * del seguimiento adentro del barrio y las llamadas del portero. Para contestar "¿entró, a
 * qué hora y por dónde anduvo?" había que abrir cuatro pantallas y cruzarlas a mano.
 *
 * ## La columna que no se puede esconder
 *
 * Un evento de barrera se guarda con la chapa leída y, cuando el sistema pudo atribuirlo,
 * con la persona. Cuando no pudo, el evento existe igual y no aparece en ninguna consulta
 * por persona. Por eso el historial también busca por las matrículas de sus vehículos — y
 * por eso cada fila dice CÓMO llegó: "directa" si el evento apunta a la persona, "por
 * matrícula" si lo trajo la chapa.
 *
 * Mezclarlas sin decirlo sería más prolijo y sería mentira: una lectura de chapa prueba que
 * pasó el auto, no que lo manejaba esta persona. En una auditoría esa diferencia es el
 * punto.
 */

const RANGOS = [{ d: 7, l: "7 días" }, { d: 30, l: "30 días" }, { d: 90, l: "90 días" }, { d: 365, l: "1 año" }];

/** Cómo se ve cada origen. El icono dice de dónde salió el dato sin tener que leerlo. */
const ORIGENES = {
    acceso: { rotulo: "Acceso", icono: KeyRound, tono: "info" as const },
    lectura: { rotulo: "Lectura", icono: ScanLine, tono: "neutro" as const },
    seguimiento: { rotulo: "Seguimiento", icono: Radar, tono: "quieto" as const },
    llamada: { rotulo: "Llamada", icono: PhoneCall, tono: "neutro" as const },
};

type Fila = {
    id: string;
    momento: string;
    origen: keyof typeof ORIGENES;
    atribucion: "directa" | "por matricula";
    tipo: string | null;
    decision: string | null;
    equipo: string | null;
    lugar: string | null;
    matricula: string | null;
    foto: string | null;
    detalle: string | null;
};

export function HistorialAccesos({ userId, nombre, open, onOpenChange }: {
    userId: string;
    nombre?: string | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
}) {
    const [dias, setDias] = useState(90);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [datos, setDatos] = useState<any>(null);

    const cargar = useCallback(() => {
        if (!open || !userId) return;
        let vivo = true;
        setCargando(true); setError(null);
        fetch(`/api/users/${userId}/historial?dias=${dias}`, { cache: "no-store" })
            .then(async (r) => {
                const j = await r.json().catch(() => null);
                if (!r.ok || !j?.ok) throw new Error(j?.error || `el servidor respondió ${r.status}`);
                return j;
            })
            .then((j) => { if (vivo) setDatos(j); })
            .catch((e) => { if (vivo) { setDatos(null); setError(e?.message || "no se pudo traer el historial"); } })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [open, userId, dias]);

    useEffect(() => cargar(), [cargar]);

    const filas: Fila[] = datos?.filas || [];
    const resumen = datos?.resumen;
    const chapas: string[] = datos?.chapas || [];

    const columnas: ColumnaTabla<Fila>[] = [
        {
            clave: "momento", titulo: "Cuándo", ancho: 108, ordenable: true,
            valor: (f) => f.momento,
            celda: (f) => <Momento t={f.momento} />,
        },
        {
            clave: "origen", titulo: "Origen", ancho: 132,
            ayuda: "De qué parte del sistema salió este registro.",
            valor: (f) => ORIGENES[f.origen]?.rotulo || f.origen,
            celda: (f) => {
                const o = ORIGENES[f.origen];
                return <Estado tono={o.tono} icono={o.icono}>{o.rotulo}</Estado>;
            },
        },
        {
            clave: "atribucion", titulo: "Cómo se atribuye", ancho: 150,
            ayuda: "«Directa» es un evento que apunta a esta persona. «Por matrícula» lo trajo la chapa de uno de sus vehículos: prueba que pasó el auto, no quién lo manejaba.",
            valor: (f) => f.atribucion,
            celda: (f) => f.atribucion === "directa"
                ? <span className="text-[12px] text-muted-foreground">directa</span>
                : (
                    <Pista titulo="Por matrícula" texto="Lo trajo la chapa de uno de sus vehículos. Prueba que pasó el auto, no quién lo manejaba." lado="arriba" ancho={280}>
                        <span className="inline-flex items-center gap-1 text-[12px] tono-aviso">
                            <Link2Off size={11} /> por matrícula
                        </span>
                    </Pista>
                ),
        },
        {
            clave: "tipo", titulo: "Qué", ancho: 96,
            valor: (f) => f.tipo || "",
            celda: (f) => f.tipo ? <span className="text-[12px] text-muted-foreground">{f.tipo}</span> : <Nada />,
        },
        {
            clave: "matricula", titulo: "Matrícula", ancho: 120,
            valor: (f) => f.matricula || "",
            celda: (f) => <Matricula p={f.matricula} />,
        },
        {
            clave: "equipo", titulo: "Dónde",
            valor: (f) => f.equipo || f.lugar || "",
            celda: (f) => (
                <div className="leading-tight">
                    <div className="text-[12.5px] text-foreground">{f.equipo || "—"}</div>
                    {f.lugar && f.lugar !== f.equipo && <div className="text-[10.5px] text-muted-foreground">{f.lugar}</div>}
                </div>
            ),
        },
        {
            clave: "decision", titulo: "Resultado", ancho: 116, alinear: "centro",
            valor: (f) => f.decision || "",
            celda: (f) => f.decision === "GRANT" ? <Estado tono="bien">concedido</Estado>
                : f.decision === "DENY" ? <Estado tono="mal">denegado</Estado>
                    : <Nada />,
        },
        {
            clave: "detalle", titulo: "Nota",
            valor: (f) => f.detalle || "",
            celda: (f) => f.detalle ? <span className="text-[11.5px] text-muted-foreground">{f.detalle}</span> : <Nada />,
        },
        {
            clave: "foto", titulo: "Cuadro", ancho: 96, auxiliar: true,
            celda: (f) => <Miniatura src={f.foto} alt={f.matricula || "cuadro"} />,
        },
    ];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-6xl p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-5 py-3 border-b border-border">
                    <DialogTitle className="flex items-center gap-2 text-sm font-bold">
                        <History size={15} /> Historial de accesos{nombre ? ` · ${nombre}` : ""}
                    </DialogTitle>
                    <DialogDescription className="text-[11px]">
                        Accesos, lecturas de matrícula, avistamientos del seguimiento y llamadas del portero, en una sola línea de tiempo.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-border">
                    <div className="flex items-center gap-0.5 bg-background/60 p-0.5 rounded-lg border border-border/60">
                        {RANGOS.map((r) => (
                            <button key={r.d} onClick={() => setDias(r.d)}
                                className={cn("h-6 px-2 rounded-md text-[10px] font-bold", dias === r.d ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                {r.l}
                            </button>
                        ))}
                    </div>

                    {resumen && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span><b className="text-foreground tabular-nums">{resumen.total}</b> registros</span>
                            <span className="tono-bien tabular-nums">{resumen.concedidos} concedidos</span>
                            <span className="tono-mal tabular-nums">{resumen.denegados} denegados</span>
                        </div>
                    )}

                    {chapas.length > 0 && (
                        <div className="flex items-center gap-1.5 ml-auto">
                            <span className="text-[10px] text-muted-foreground">buscado también por</span>
                            {chapas.map((c) => <Matricula key={c} p={c} />)}
                        </div>
                    )}
                </div>

                {/* Una lista cortada en silencio es una auditoría que miente por omisión. */}
                {datos?.recortado && (
                    <div className="flex items-start gap-2 px-5 py-2 chip-aviso border-b border-border text-[11px]">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        <span>
                            Hay más registros de los que entran: se muestran los {datos.tope} más recientes de cada origen.
                            Acotá el rango para ver el período completo.
                        </span>
                    </div>
                )}

                <div className="p-3">
                    <Tabla
                        id="historial-accesos"
                        filas={filas}
                        clave={(f) => f.id}
                        columnas={columnas}
                        cargando={cargando}
                        error={error}
                        alReintentar={cargar}
                        alto="60vh"
                        nombreArchivo={`historial-${nombre || userId}`}
                        vacio={{
                            icono: History,
                            titulo: "Sin registros en este período",
                            ayuda: chapas.length
                                ? "Ni accesos propios ni lecturas de sus matrículas. Probá con un rango más largo."
                                : "Esta persona no tiene matrículas cargadas, así que sólo se buscan accesos con su identidad.",
                        }}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default HistorialAccesos;
