"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, BellRing, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/avisos";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Filtros } from "@/components/ui/filtros";
import { visitasDelDia, avisosDelDia, atenderAvisoAMano, type VisitaFila, type AvisoFila } from "@/app/actions/visitas";
import { ETIQUETA_AVISO, type TipoAviso } from "@/lib/visitas/presentacion";
import { duracion } from "@/lib/visitas/calculos";

/**
 * Visitas y avisos del día, para revisar desde el panel lo que pasó en la garita: quién entró,
 * a qué lote, cuánto se quedó, cómo se cerró cada visita y qué avisos tuvo la guardia.
 */

const CIERRE: Record<string, string> = { CAMARA_SALIDA: "cámara de Salida", GUARDIA: "guardia", FIN_DEL_DIA: "sin salida registrada" };
/** Cada cuánto se repide la tabla mientras está abierta. */
const REFRESCO_MS = 30_000;

export default function PaginaVisitas() {
    const [pestana, setPestana] = useState<"visitas" | "avisos">("visitas");
    const [visitas, setVisitas] = useState<VisitaFila[]>([]);
    const [avisos, setAvisos] = useState<AvisoFila[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [estado, setEstado] = useState("todas");

    const cargar = useCallback(() => {
        setError(null);
        Promise.all([visitasDelDia(), avisosDelDia()])
            .then(([v, a]) => { setVisitas(v); setAvisos(a); })
            .catch((e) => setError(e?.message || "No se pudo leer"))
            .finally(() => setCargando(false));
    }, []);
    useEffect(() => { cargar(); const iv = setInterval(cargar, REFRESCO_MS); return () => clearInterval(iv); }, [cargar]);

    const q = busqueda.trim().toLowerCase();
    const visitasVis = useMemo(() => visitas.filter((v) => (estado === "todas" || (estado === "abiertas" ? !v.sale : !!v.sale))
        && (!q || [v.plate, v.loteNombre, v.nombre, v.empresa, v.tipoNombre, v.registradaPor].some((x) => (x || "").toLowerCase().includes(q)))), [visitas, estado, q]);
    const avisosVis = useMemo(() => avisos.filter((a) => (estado === "todas" || (estado === "abiertas" ? !a.atendidoAt : !!a.atendidoAt))
        && (!q || [a.plate, a.motivo, a.camara, a.atendidoPor].some((x) => (x || "").toLowerCase().includes(q)))), [avisos, estado, q]);

    const colVisitas: ColumnaTabla<VisitaFila>[] = [
        { clave: "tipo", titulo: "Tipo", ancho: 120, valor: (v) => v.tipoNombre, celda: (v) => <span className="font-semibold text-[13px]">{v.tipoNombre}{v.origen === "INVITACION" && <span className="block text-[11px] text-muted-foreground font-normal">por invitación</span>}{v.origen === "PROVEEDOR" && <span className="block text-[11px] text-muted-foreground font-normal">proveedor registrado{v.empresa ? ` · ${v.empresa}` : ""}</span>}</span> },
        { clave: "plate", titulo: "Matrícula", ancho: 120, valor: (v) => v.plate || "", celda: (v) => v.plate ? <Matricula p={v.plate} /> : <Nada /> },
        { clave: "lote", titulo: "Lote", ancho: 120, valor: (v) => v.loteNombre || "", celda: (v) => v.loteNombre ? <span className="text-[13px]">{v.loteNombre}</span> : <Nada /> },
        { clave: "quien", titulo: "Quién", valor: (v) => [v.nombre, v.empresa].filter(Boolean).join(" · "), celda: (v) => (v.nombre || v.empresa) ? <span className="text-[13px]">{[v.nombre, v.empresa].filter(Boolean).join(" · ")}</span> : <Nada /> },
        { clave: "entra", titulo: "Entró", ancho: 110, valor: (v) => v.entra, celda: (v) => <Momento t={v.entra} /> },
        {
            clave: "dur", titulo: "Duración", ancho: 130, valor: (v) => (+(v.sale ? new Date(v.sale) : new Date()) - +new Date(v.entra)),
            celda: (v) => {
                const min = (+(v.sale ? new Date(v.sale) : new Date()) - +new Date(v.entra)) / 60000;
                const excedida = !v.sale && Date.now() > +new Date(v.vence);
                return <span className={cn("text-[13px] tabular-nums", excedida && "tono-mal font-semibold")}>{duracion(min)}{!v.sale && <span className="text-muted-foreground"> / {v.minutosTipo} min</span>}</span>;
            },
        },
        {
            clave: "estado", titulo: "Estado", ancho: 170, valor: (v) => v.sale ? "cerrada" : "en curso",
            celda: (v) => !v.sale ? (Date.now() > +new Date(v.vence) ? <Estado tono="mal">excedida</Estado> : <Estado tono="info">en el barrio</Estado>)
                : <span className="text-[12px] text-muted-foreground">cerró: {CIERRE[v.cierre || ""] || v.cierre}{v.cerradaPor && v.cierre === "GUARDIA" ? ` (${v.cerradaPor})` : ""}</span>,
        },
        { clave: "reg", titulo: "Registró", ancho: 140, valor: (v) => v.registradaPor || "", celda: (v) => <span className="text-[12px] text-muted-foreground">{v.registradaPor || "—"}{v.extensiones ? ` · +${v.extensiones} ext.` : ""}</span> },
    ];

    const colAvisos: ColumnaTabla<AvisoFila>[] = [
        { clave: "creado", titulo: "Cuándo", ancho: 110, valor: (a) => a.creado, celda: (a) => <Momento t={a.creado} /> },
        { clave: "tipo", titulo: "Aviso", ancho: 190, valor: (a) => ETIQUETA_AVISO[a.tipo as TipoAviso]?.titulo || a.tipo, celda: (a) => { const e = ETIQUETA_AVISO[a.tipo as TipoAviso]; return <Estado tono={(e?.tono === "neutro" ? "quieto" : e?.tono) as any || "neutro"}>{e?.titulo || a.tipo}</Estado>; } },
        { clave: "plate", titulo: "Matrícula", ancho: 120, valor: (a) => a.plate || "", celda: (a) => a.plate ? <Matricula p={a.plate} /> : <Nada /> },
        { clave: "motivo", titulo: "Por qué", valor: (a) => a.motivo, celda: (a) => <span className="text-[12.5px]">{a.motivo}</span> },
        {
            clave: "atendido", titulo: "Atendido", ancho: 170, valor: (a) => a.atendidoAt || "",
            celda: (a) => a.atendidoAt ? <span className="text-[12px] text-muted-foreground">{a.atendidoPor} · <Momento t={a.atendidoAt} /></span>
                : <button onClick={async () => { const r = await atenderAvisoAMano(a.id); if (!r.ok) toast.error("No se pudo", { description: r.error }); cargar(); }} className="inline-flex items-center gap-1.5 text-[12px] font-semibold tono-accion"><Check size={13} /> Marcar atendido</button>,
        },
    ];

    const filtros = (
        <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder={pestana === "visitas" ? "Matrícula, lote, nombre, empresa" : "Matrícula, motivo, cámara"}
            grupos={[
                { clave: "que", titulo: "Qué", valor: pestana, alElegir: (v) => setPestana(v as any), opciones: [{ valor: "visitas", rotulo: `Visitas · ${visitas.length}` }, { valor: "avisos", rotulo: `Avisos · ${avisos.filter((a) => !a.atendidoAt).length} pendientes` }] },
                { clave: "estado", titulo: "Estado", valor: estado, alElegir: setEstado, opciones: [{ valor: "todas", rotulo: "Todas" }, { valor: "abiertas", rotulo: pestana === "visitas" ? "En curso" : "Pendientes" }, { valor: "cerradas", rotulo: pestana === "visitas" ? "Cerradas" : "Atendidos" }] },
            ]} />
    );

    return (
        <div className="h-full flex flex-col gap-4 p-6 min-h-0">
            <div>
                <h1 className="text-[22px] font-bold flex items-center gap-2"><Clock size={20} /> Visitas</h1>
                <p className="text-[13px] text-muted-foreground">Las últimas 24 h: quién entró, a qué lote, cuánto se quedó y cómo se cerró cada visita, y los avisos que tuvo la guardia.</p>
            </div>
            <div className="flex-1 min-h-0">
                {pestana === "visitas" ? (
                    <Tabla<VisitaFila> id="visitas" filas={visitasVis} clave={(v) => v.id} columnas={colVisitas} cargando={cargando} error={error} alReintentar={cargar} barra={filtros}
                        vacio={{ icono: Clock, titulo: "Sin visitas", ayuda: "Las registra la guardia desde la consola (pestaña Visitas) o se abren solas con una invitación." }} />
                ) : (
                    <Tabla<AvisoFila> id="avisos-guardia" filas={avisosVis} clave={(a) => a.id} columnas={colAvisos} cargando={cargando} error={error} alReintentar={cargar} barra={filtros}
                        vacio={{ icono: BellRing, titulo: "Sin avisos", ayuda: "Los avisos se configuran en Ajustes → Visitas y patrones." }} />
                )}
            </div>
        </div>
    );
}
