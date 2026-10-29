"use client";
/**
 * Exportar el informe de Lecturas de cámara en PDF o Excel (29/10, Nico: «permite exportar un
 * reporte en PDF y Excel profesional, estilizado OmniAccess, con portada… así podremos comparar
 * mejor el desempeño de las analíticas OmniVision y lo que las cámaras envían»).
 *
 * El informe lo arma el servidor (/api/lpr/lecturas-camara/informe): un período largo son decenas de
 * miles de capturas, y las fotos de los casos están en el almacenamiento. Acá sólo se elige qué y
 * se descarga.
 */
import { useEffect, useState } from "react";
import { Calendar as CalendarIcon, Camera, Check, Download, FileSpreadsheet, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { cn } from "@/lib/utils";
import { paraInput } from "@/lib/fechas";

type Periodo = "hoy" | "ayer" | "7" | "30" | "otro";
const PERIODOS: { id: Periodo; rotulo: string }[] = [
    { id: "hoy", rotulo: "Hoy" }, { id: "ayer", rotulo: "Ayer" }, { id: "7", rotulo: "Últimos 7 días" }, { id: "30", rotulo: "Últimos 30 días" }, { id: "otro", rotulo: "Elegir fechas" },
];
/** Lo que guarda el registro de las cámaras (camara-log.js): el servidor no acepta más. */
const DIAS_MAX = 31;
const dias = (n: number) => paraInput(new Date(Date.now() - n * 86_400_000));

const FORMATOS = [
    { id: "pdf" as const, rotulo: "PDF", detalle: "Para leer y mandar: portada, conclusiones, gráficos, casos para revisar y el detalle.", Ico: FileText },
    { id: "xlsx" as const, rotulo: "Excel", detalle: "Para trabajar los números: resumen, por día, por hora, todos los vehículos, OmniVision y los casos.", Ico: FileSpreadsheet },
];

export function ExportarInforme({ abierto, alCerrar, camaras, camaraActual }: {
    abierto: boolean; alCerrar: () => void;
    camaras: { id: string; nombre: string }[];
    /** La cámara elegida en la pantalla, para arrancar con la misma. */
    camaraActual?: string;
}) {
    const [periodo, setPeriodo] = useState<Periodo>("7");
    const [desde, setDesde] = useState(dias(6));
    const [hasta, setHasta] = useState(dias(0));
    const [elegidas, setElegidas] = useState<Set<string>>(new Set());
    const [formatos, setFormatos] = useState<Set<"pdf" | "xlsx">>(new Set(["pdf"]));
    const [fotos, setFotos] = useState(true);
    const [bajando, setBajando] = useState<string | null>(null);

    useEffect(() => { if (abierto) setElegidas(new Set(camaraActual ? [camaraActual] : [])); }, [abierto, camaraActual]);
    const elegirPeriodo = (p: Periodo) => {
        setPeriodo(p);
        if (p === "hoy") { setDesde(dias(0)); setHasta(dias(0)); }
        if (p === "ayer") { setDesde(dias(1)); setHasta(dias(1)); }
        if (p === "7") { setDesde(dias(6)); setHasta(dias(0)); }
        if (p === "30") { setDesde(dias(29)); setHasta(dias(0)); }
    };
    const largo = Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000) + 1;
    const problema = !desde || !hasta ? "Elegí las dos fechas." : hasta < desde ? "La fecha final es anterior a la inicial." : largo > DIAS_MAX ? `Como mucho ${DIAS_MAX} días: es lo que guarda el registro de las cámaras.` : !formatos.size ? "Elegí PDF, Excel o los dos." : null;

    const alternar = <T,>(s: Set<T>, v: T) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; };
    const descargar = async () => {
        for (const f of ["pdf", "xlsx"] as const) {
            if (!formatos.has(f)) continue;
            setBajando(f === "pdf" ? "Armando el PDF…" : "Armando el Excel…");
            try {
                const q = new URLSearchParams({ formato: f, desde, hasta, ...(elegidas.size ? { camaras: [...elegidas].join(",") } : {}), ...(f === "pdf" && fotos ? { fotos: "1" } : {}) });
                const r = await fetch(`/api/lpr/lecturas-camara/informe?${q}`, { cache: "no-store" });
                if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `El servidor respondió ${r.status}`); }
                const blob = await r.blob();
                const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || `informe-lecturas.${f}`;
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
                if (r.headers.get("X-Informe-Truncado")) toast.warning({ title: "El período es muy grande", description: "El informe se cortó en el tope de capturas: probá con menos días." });
            } catch (e: any) {
                toast.error({ title: `No se pudo armar el ${f === "pdf" ? "PDF" : "Excel"}`, description: e?.message });
                setBajando(null); return;
            }
        }
        setBajando(null);
        toast.success({ title: "Informe descargado" });
        alCerrar();
    };
    const opcion = (activa: boolean) => cn("h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors", activa ? "bg-foreground text-background border-transparent" : "border-border text-muted-foreground hover:text-foreground");

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o && !bajando) alCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo="Exportar informe"
                descripcion="Qué leyó cada cámara, qué le llegó a OmniAccess y qué releyó OmniVision, con portada, conclusiones y gráficos."
                pie={
                    <div className="flex items-center gap-3 w-full">
                        <span className={cn("text-[12px] flex-1 min-w-0 truncate", problema ? "tono-aviso" : "text-muted-foreground")}>
                            {bajando || problema || `${largo} ${largo === 1 ? "día" : "días"} · ${elegidas.size ? `${elegidas.size} ${elegidas.size === 1 ? "cámara" : "cámaras"}` : "todas las cámaras"}`}
                        </span>
                        <Button variant="ghost" onClick={alCerrar} disabled={!!bajando}>Cancelar</Button>
                        <Button onClick={descargar} disabled={!!bajando || !!problema}>
                            {bajando ? <Loader2 className="animate-spin" /> : <Download />} Descargar
                        </Button>
                    </div>
                }>
                <CajonSeccion titulo="Formato" icono={FileText}>
                    <div className="grid grid-cols-2 gap-2">
                        {FORMATOS.map((f) => {
                            const on = formatos.has(f.id);
                            return (
                                <button key={f.id} type="button" onClick={() => setFormatos(alternar(formatos, f.id))} aria-pressed={on}
                                    className={cn("relative text-left rounded-[10px] border p-3 transition-colors", on ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_7%,transparent)]" : "border-border hover:bg-accent/50")}>
                                    <span className={cn("absolute top-3 right-3 grid h-5 w-5 place-items-center rounded-[5px] border", on ? "bg-[var(--accion)] border-transparent text-white" : "border-border")}>{on && <Check size={13} strokeWidth={3} />}</span>
                                    <f.Ico size={20} className={on ? "tono-accion" : "text-muted-foreground"} />
                                    <span className="block mt-2 text-[13.5px] font-bold">{f.rotulo}</span>
                                    <span className="block mt-0.5 text-[11.5px] text-muted-foreground leading-snug pr-2">{f.detalle}</span>
                                </button>
                            );
                        })}
                    </div>
                    {formatos.has("pdf") && (
                        <label className="flex items-center gap-2 text-[12.5px] mt-1 cursor-pointer">
                            <input type="checkbox" checked={fotos} onChange={(e) => setFotos(e.target.checked)} className="accent-[var(--accion)] w-4 h-4" />
                            <ImageIcon size={13} className="text-muted-foreground" /> Con los recortes de la chapa en los casos para revisar
                        </label>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="Período" icono={CalendarIcon} ayuda={`El registro de las cámaras se guarda ${DIAS_MAX - 1} días.`}>
                    <div className="flex flex-wrap gap-1.5">
                        {PERIODOS.map((p) => <button key={p.id} type="button" onClick={() => elegirPeriodo(p.id)} aria-pressed={periodo === p.id} className={opcion(periodo === p.id)}>{p.rotulo}</button>)}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-2">
                        {([["Desde", desde, setDesde], ["Hasta", hasta, setHasta]] as const).map(([r, v, set]) => (
                            <label key={r} className="block">
                                <span className="text-[11.5px] text-muted-foreground">{r}</span>
                                <input type="date" value={v} min={dias(DIAS_MAX - 1)} max={dias(0)} onChange={(e) => { set(e.target.value); setPeriodo("otro"); }}
                                    className="mt-1 w-full h-9 rounded-[6px] border border-border bg-background px-2.5 text-[13px] tabular-nums outline-none focus:border-[var(--accion)]" />
                            </label>
                        ))}
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Cámaras" icono={Camera} ayuda="Sin elegir ninguna, van todas las que tienen registro copiado.">
                    <div className="flex flex-wrap gap-1.5">
                        <button type="button" onClick={() => setElegidas(new Set())} aria-pressed={!elegidas.size} className={opcion(!elegidas.size)}>Todas</button>
                        {camaras.map((c) => <button key={c.id} type="button" onClick={() => setElegidas(alternar(elegidas, c.id))} aria-pressed={elegidas.has(c.id)} className={opcion(elegidas.has(c.id))}>{c.nombre}</button>)}
                    </div>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
