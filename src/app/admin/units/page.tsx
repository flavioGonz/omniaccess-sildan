"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building, Building2, Check, Plus } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Cajon, CajonCampo, CajonContenido } from "@/components/ui/cajon";
import { ErrorEstado } from "@/components/ui/estados";
import { CajonLote } from "@/components/lotes/CajonLote";
import { TablaLotes, SITUACION, type FiltroLotes } from "@/components/administraciones/TablaLotes";
import { administraciones as listarAdministraciones, lotesDeTodas, type LoteAdm, type ResumenAdministracion } from "@/app/actions/administraciones";
import { crearLote } from "@/app/actions/lote-edicion";

/**
 * Unidades: todos los lotes del complejo en una tabla para buscarlos con sus datos (25/11).
 *
 * Nico: «/admin/units debe cambiar por completo; recordá que ya tenemos la estructura bien definida
 * en Administraciones: traer esa tabla aquí, y drawers etc., y que sea una tabla igual para poder
 * buscar unidades con sus datos». La pantalla anterior era otro modelo (edificios, pisos y
 * subunidades) que en un barrio por etapas no decía nada; sigue en «Edificios y subunidades» para
 * las instalaciones que lo usan.
 *
 * Es la misma tabla que la pestaña Lotes de cada administración (components/administraciones/
 * TablaLotes) con todas juntas: suma la columna de la administración y la de matrículas, y el
 * buscador encuentra un lote por su nombre, el titular, cualquier persona, su correo, su teléfono o
 * una chapa. Tocar un lote abre el mismo cajón que en Administraciones, editable y con su historial.
 */

const ENTRADA = "h-9 w-full px-3 rounded-[6px] border border-border bg-background text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accion)]/40 focus-visible:border-[var(--accion)]";
type Cual = "todas" | "sin" | string;

export default function Unidades() {
    const [lotes, setLotes] = useState<LoteAdm[] | null>(null);
    const [adms, setAdms] = useState<ResumenAdministracion[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [vuelta, setVuelta] = useState(0);
    const refrescar = useCallback(() => setVuelta((n) => n + 1), []);
    const [cual, setCual] = useState<Cual>("todas");
    const [filtro, setFiltro] = useState<FiltroLotes>("todos");
    const [abierto, setAbierto] = useState<string | null>(null);
    const [nuevo, setNuevo] = useState(false);

    useEffect(() => {
        let vivo = true;
        Promise.all([lotesDeTodas(), listarAdministraciones()])
            .then(([l, a]) => { if (vivo) { setLotes(l); setAdms(a); setError(null); } })
            .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudieron traer las unidades."); });
        return () => { vivo = false; };
    }, [vuelta]);

    const deCual = useMemo(() => (lotes ? lotes.filter((l) => cual === "todas" || (cual === "sin" ? !l.administracion : l.administracion?.id === cual)) : null), [lotes, cual]);
    const cuenta = useMemo(() => {
        const l = deCual || [];
        const personas = new Set(l.flatMap((x) => x.personas.map((p) => p.id))).size;
        const conCensoCargado = l.filter((x) => x.personas.some((p) => p.codigo === "cargo")).length;
        return { lotes: l.length, conGente: l.filter((x) => x.personas.length).length, personas, chapas: l.reduce((n, x) => n + (x.chapas?.length || 0), 0), censo: l.length ? Math.round((conCensoCargado / l.length) * 100) : 0 };
    }, [deCual]);
    const sinAdm = (lotes || []).filter((l) => !l.administracion).length;
    const porAdm = useMemo(() => new Map(adms.map((a) => [a.id, (lotes || []).filter((l) => l.administracion?.id === a.id).length])), [adms, lotes]);

    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1600px] mx-auto">
            <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><Building2 size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Unidades</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">Todos los lotes del complejo, con su gente, sus matrículas y su censo. Tocá uno para ver su ficha, corregirla y su historial.</p>
                </div>
                <Link href="/admin/units/edificios" className="h-9 px-3 rounded-[6px] text-[12.5px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent inline-flex items-center gap-1.5"><Building size={14} /> Edificios y subunidades</Link>
                <Button variant="outline" onClick={() => setNuevo(true)}><Plus size={14} /> Nuevo lote</Button>
            </div>

            {/* De qué administración: las mismas que en Administraciones, con su sigla. */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Administración">
                {[{ v: "todas", r: "Todas", n: lotes?.length || 0, s: "" }, ...adms.map((a) => ({ v: a.id, r: a.nombre, n: porAdm.get(a.id) || 0, s: a.sigla })), ...(sinAdm ? [{ v: "sin", r: "Sin administración", n: sinAdm, s: "" }] : [])].map((o) => (
                    <button key={o.v} type="button" aria-pressed={cual === o.v} onClick={() => setCual(o.v)}
                        className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors", cual === o.v ? "bg-foreground text-background border-foreground" : "border-border hover:bg-accent")}>
                        {o.s && <span className={cn("rounded-[4px] px-1 text-[10px] font-bold tabular-nums", cual === o.v ? "bg-background/20" : "bg-muted")}>{o.s}</span>}
                        {o.r}<span className={cn("tabular-nums text-[11px]", cual === o.v ? "opacity-70" : "text-muted-foreground")}>{o.n}</span>
                    </button>
                ))}
                {deCual && (
                    <div className="ml-auto flex flex-wrap items-center gap-4 text-[12.5px]">
                        <span><b className="tabular-nums">{cuenta.lotes}</b> <span className="text-muted-foreground">lotes</span></span>
                        <span><b className="tabular-nums">{cuenta.conGente}</b> <span className="text-muted-foreground">con gente</span></span>
                        <span><b className="tabular-nums">{cuenta.personas}</b> <span className="text-muted-foreground">personas</span></span>
                        <span><b className="tabular-nums">{cuenta.chapas}</b> <span className="text-muted-foreground">matrículas</span></span>
                        <span><b className="tabular-nums tono-bien">{cuenta.censo}%</b> <span className="text-muted-foreground">con censo cargado</span></span>
                    </div>
                )}
            </div>

            {error ? <ErrorEstado mensaje={error} alReintentar={refrescar} /> : (
                <TablaLotes filas={deCual} alAbrir={setAbierto} filtro={filtro} alFiltrar={setFiltro} conAdministracion id="unidades" nombreArchivo="unidades"
                    alto="calc(100vh - 230px)" vacioSinLotes="No hay lotes cargados" />
            )}

            <CajonLote unitId={abierto} alCerrar={() => { setAbierto(null); refrescar(); }} />
            <NuevoLote abierto={nuevo} adms={adms} preelegida={cual !== "todas" && cual !== "sin" ? cual : null} alCerrar={() => setNuevo(false)}
                alCrear={(id) => { setNuevo(false); refrescar(); setAbierto(id); }} />
        </div>
    );
}

function NuevoLote({ abierto, adms, preelegida, alCerrar, alCrear }: { abierto: boolean; adms: ResumenAdministracion[]; preelegida: string | null; alCerrar: () => void; alCrear: (id: string) => void }) {
    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            {abierto && <FormNuevoLote adms={adms} preelegida={preelegida} alCerrar={alCerrar} alCrear={alCrear} />}
        </Cajon>
    );
}
function FormNuevoLote({ adms, preelegida, alCerrar, alCrear }: { adms: ResumenAdministracion[]; preelegida: string | null; alCerrar: () => void; alCrear: (id: string) => void }) {
    const [f, setF] = useState({ nombre: "", administracionId: preelegida || adms[0]?.id || "", titular: "", situacion: "" });
    const [guardando, setGuardando] = useState(false);
    const sigla = adms.find((a) => a.id === f.administracionId)?.sigla;
    return (
        <CajonContenido ancho="angosto" titulo="Nuevo lote" descripcion="Lo normal es que los lotes lleguen con la planilla del padrón. Esto es para el que falta: queda anotado en su historial."
            pie={
                <div className="flex w-full items-center justify-end gap-2">
                    <Button variant="ghost" onClick={alCerrar}>Cancelar</Button>
                    <Button disabled={guardando || !f.nombre.trim()} onClick={async () => {
                        setGuardando(true);
                        try {
                            const r = await crearLote({ nombre: f.nombre, administracionId: f.administracionId || null, titular: f.titular, situacion: f.situacion });
                            if (!r.ok || !r.id) toast.error({ title: "No se creó", description: r.error });
                            else { toast.success({ title: `Lote ${f.nombre.trim()} creado`, description: "Ahora sumale su gente y sus matrículas." }); alCrear(r.id); }
                        } finally { setGuardando(false); }
                    }}><Check size={14} /> Crear</Button>
                </div>
            }>
            <div className="space-y-4 p-1">
                <CajonCampo etiqueta="Administración">
                    <div className="flex flex-wrap gap-1.5">
                        {[...adms.map((a) => ({ v: a.id, r: a.nombre })), { v: "", r: "Ninguna" }].map((o) => (
                            <button key={o.v || "ninguna"} type="button" aria-pressed={f.administracionId === o.v} onClick={() => setF({ ...f, administracionId: o.v })}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", f.administracionId === o.v ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>{o.r}</button>
                        ))}
                    </div>
                </CajonCampo>
                <CajonCampo etiqueta="Nombre del lote" ayuda={sigla ? `Como en el resto: «A 2 (${sigla})».` : undefined}>
                    <input autoFocus value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder={sigla ? `A 2 (${sigla})` : "A 2"} className={ENTRADA} />
                </CajonCampo>
                <CajonCampo etiqueta="Titular según la administración"><input value={f.titular} onChange={(e) => setF({ ...f, titular: e.target.value })} className={ENTRADA} /></CajonCampo>
                <CajonCampo etiqueta="Situación">
                    <div className="flex flex-wrap gap-1.5">
                        {[{ v: "", r: "Con su gente" }, ...Object.entries(SITUACION).map(([v, x]) => ({ v, r: x.rotulo }))].map((o) => (
                            <button key={o.v || "gente"} type="button" aria-pressed={f.situacion === o.v} onClick={() => setF({ ...f, situacion: o.v })}
                                className={cn("h-7 px-2.5 rounded-full border text-[11.5px] font-semibold", f.situacion === o.v ? "border-[var(--accion)] text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>{o.r}</button>
                        ))}
                    </div>
                </CajonCampo>
            </div>
        </CajonContenido>
    );
}
