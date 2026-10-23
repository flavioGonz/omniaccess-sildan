"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Globe, Loader2, MonitorPlay, Plus, RefreshCw, Trash2, TriangleAlert, ZoomIn } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";
import { listarFuentesWeb, guardarFuenteWeb, borrarFuenteWeb } from "@/app/actions/monitores";
import { problemaDeUrl, TEXTO_AVISO, RECARGA_MAX_MIN, ZOOM_MIN, ZOOM_MAX, type FuenteWeb } from "@/lib/monitor/fuentes-web";

/**
 * «Páginas web» de Monitores (openspec pared-vms, 23/10, Nico: «que en un canal se pueda hacer render
 * de una web, para vestir el wall con herramientas externas; así vamos mejorando el VMS»).
 *
 * El catálogo de páginas que se pueden poner en una casilla de una vista de Cámaras. Cada una se
 * revisa al guardarla y lo que se vio queda como aviso (ver lib/monitor/fuentes-web): un sitio que
 * no se deja enmarcar o una dirección http dentro del panel https quedan en blanco en la pared, y
 * es mejor saberlo acá que frente al wall.
 *
 * El cajón trae la vista previa EN VIVO, con el mismo aislamiento y el mismo zoom que en la pared:
 * lo que se ve acá es lo que va a verse allá.
 */

const RECARGAS = [0, 1, 5, 15, 60];
const VACIA: FuenteWeb = { id: "", nombre: "", url: "https://", recargaMin: 0, zoom: 100 };
const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export function PaginasWeb({ puedeConfigurar }: { puedeConfigurar: boolean }) {
    const [fuentes, setFuentes] = useState<FuenteWeb[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editando, setEditando] = useState<FuenteWeb | null>(null);
    const [abierto, setAbierto] = useState(false);

    const cargar = useCallback(async () => {
        try { setFuentes(await listarFuentesWeb()); setError(null); } catch (e: any) { setError(e?.message || "No se pudieron leer las páginas"); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const abrir = (f: FuenteWeb) => { setEditando(f); setAbierto(true); };

    const columnas: ColumnaTabla<FuenteWeb>[] = [
        {
            clave: "pagina", titulo: "Página", valor: (f) => f.nombre, celda: (f) => (
                <div className="flex items-center gap-3 py-1 min-w-0">
                    <span className="grid place-items-center h-9 w-9 rounded-[10px] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] tono-accion shrink-0"><Globe size={17} /></span>
                    <div className="min-w-0 leading-tight">
                        <div className="text-[14px] font-bold truncate">{f.nombre}</div>
                        <div className="text-[12px] text-muted-foreground truncate">{host(f.url)}</div>
                    </div>
                </div>
            ),
        },
        {
            clave: "recarga", titulo: "Recarga", ancho: 150, valor: (f) => f.recargaMin,
            celda: (f) => <span className="inline-flex items-center gap-1.5 text-[12.5px]"><RefreshCw size={13} className="text-muted-foreground" />{f.recargaMin ? `cada ${f.recargaMin} min` : "nunca"}</span>,
        },
        { clave: "zoom", titulo: "Zoom", ancho: 100, valor: (f) => f.zoom, celda: (f) => <span className="text-[12.5px] tabular-nums">{f.zoom} %</span> },
        {
            clave: "estado", titulo: "En la pared", ancho: 220, ayuda: "Lo que se vio al guardarla. Un aviso no impide usarla.",
            valor: (f) => (f.avisos?.length ? "aviso" : "ok"),
            celda: (f) => f.avisos?.length ? (
                <Pista titulo="Puede no verse" texto={f.avisos.map((a) => TEXTO_AVISO[a]).join(" ")} lado="arriba" ancho={300}>
                    <span className="chip-aviso inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[11.5px] font-semibold"><TriangleAlert size={12} /> {f.avisos.length === 1 ? "1 aviso" : `${f.avisos.length} avisos`}</span>
                </Pista>
            ) : <span className="chip-bien inline-flex items-center h-6 px-2 rounded-full border text-[11.5px] font-semibold">Se deja mostrar</span>,
        },
        {
            clave: "acciones", titulo: "", ancho: 90, auxiliar: true, alinear: "der", celda: (f) => (
                <a href={f.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} title="Abrir en una pestaña"
                    className="inline-grid place-items-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"><ExternalLink size={15} /></a>
            ),
        },
    ];

    return (
        <section className="space-y-3">
            <div className="flex items-end gap-3">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-bold flex items-center gap-2"><Globe size={16} className="tono-accion" /> Páginas web para la pared</h2>
                    <p className="text-[12.5px] text-muted-foreground leading-snug max-w-[760px]">Un tablero, un mapa, Grafana o el propio NVR, en una casilla de una vista de Cámaras en lugar de un canal. Se ponen al diseñar la vista.</p>
                </div>
                {puedeConfigurar && <Button className="ml-auto shrink-0" onClick={() => abrir({ ...VACIA })}><Plus /> Agregar página</Button>}
            </div>
            <Tabla id="monitores-paginas" filas={fuentes || []} clave={(f) => f.id} columnas={columnas} controles={false} seleccionCeldas={false}
                cargando={fuentes === null && !error} error={error} alReintentar={cargar}
                alClickFila={puedeConfigurar ? abrir : undefined}
                vacio={{ titulo: "Todavía no hay páginas", ayuda: puedeConfigurar ? "«Agregar página» para la primera." : "Las carga quien tiene «Configurar monitores»." }} />
            <CajonPagina inicial={editando} abierto={abierto} alCerrar={() => setAbierto(false)} alGuardar={() => { setAbierto(false); cargar(); }} />
        </section>
    );
}

function CajonPagina({ inicial, abierto, alCerrar, alGuardar }: { inicial: FuenteWeb | null; abierto: boolean; alCerrar: () => void; alGuardar: () => void }) {
    const [f, setF] = useState<FuenteWeb>(VACIA);
    const [guardando, setGuardando] = useState(false);
    const [previa, setPrevia] = useState<string | null>(null);
    const [cargoPrevia, setCargoPrevia] = useState(false);
    useEffect(() => { if (abierto && inicial) { setF(inicial); setPrevia(inicial.url && !problemaDeUrl(inicial.url) ? inicial.url : null); } }, [abierto, inicial]);
    // La vista previa se actualiza cuando se deja de escribir la dirección, no con cada tecla.
    useEffect(() => {
        const t = setTimeout(() => setPrevia(problemaDeUrl(f.url) ? null : f.url), 700);
        return () => clearTimeout(t);
    }, [f.url]);
    // Sólo una dirección nueva vuelve a «cargando»: la misma no recarga el marco y no volvería a avisar.
    useEffect(() => { setCargoPrevia(false); }, [previa]);
    const problema = f.url && f.url !== "https://" ? problemaDeUrl(f.url) : null;
    const nueva = !f.id;

    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await guardarFuenteWeb(f);
            if (!r.ok) { toast.error({ title: r.error }); return; }
            if (r.fuente.avisos?.length) toast.warning({ title: "Guardada, con un aviso", description: r.fuente.avisos.map((a) => TEXTO_AVISO[a]).join(" ") });
            else toast.success({ title: nueva ? "Página agregada" : "Página guardada", description: "Ya se puede poner en una vista de Cámaras." });
            alGuardar();
        } catch (e: any) { toast.error({ title: e?.message || "No se pudo guardar" }); } finally { setGuardando(false); }
    };
    const zoom = f.zoom / 100;

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="medio" titulo={nueva ? "Agregar página web" : f.nombre || "Página web"} descripcion="Una página en una casilla de la pared, en lugar de un canal de video."
                pie={<>
                    {!nueva && (
                        <ConfirmarAccion id={f.id} title={`Borrar «${f.nombre}»`} description="Las vistas que la usaban muestran «Página web que ya no existe» en esa casilla; el resto de cada vista sigue igual." etiquetaAccion="Borrar"
                            onDelete={async (id) => { const r = await borrarFuenteWeb(id); return { success: r.ok } as any; }} onSuccess={alGuardar}>
                            <Button variant="ghost" className="mr-auto tono-mal"><Trash2 /> Borrar</Button>
                        </ConfirmarAccion>
                    )}
                    <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || !f.nombre.trim() || !!problemaDeUrl(f.url)}>{guardando ? <Loader2 className="animate-spin" /> : null}{guardando ? "Revisando la página…" : nueva ? "Agregar" : "Guardar"}</Button>
                </>}>
                {/* La vista previa, como se va a ver en una casilla 16:9 de la pared. */}
                <CajonSeccion titulo="Así se ve en la pared" icono={MonitorPlay}>
                    <div className="relative aspect-video rounded-[12px] overflow-hidden border border-border bg-[#0b0e14]">
                        <AnimatePresence mode="wait">
                            {previa ? (
                                <motion.div key={previa} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <div className="absolute left-0 top-0 origin-top-left" style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}>
                                        <iframe src={previa} title="Vista previa" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms" onLoad={() => setCargoPrevia(true)}
                                            className={cn("w-full h-full border-0 bg-white transition-opacity duration-500", cargoPrevia ? "opacity-100" : "opacity-0")} />
                                    </div>
                                    {!cargoPrevia && <span className="absolute inset-0 grid place-items-center text-white/60"><Loader2 className="animate-spin" /></span>}
                                </motion.div>
                            ) : (
                                <motion.span key="vacia" className="absolute inset-0 grid place-items-center text-center text-white/50 text-[13px] px-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <span className="flex flex-col items-center gap-2"><Globe size={26} className="opacity-60" />Escribí la dirección para ver cómo queda en la pared</span>
                                </motion.span>
                            )}
                        </AnimatePresence>
                        <span className="pointer-events-none absolute left-2 top-2 h-6 px-2 rounded-full bg-black/65 text-white text-[11px] font-semibold inline-flex items-center gap-1.5"><Globe size={11} /> {f.nombre || "Vista previa"}</span>
                    </div>
                    <p className="text-[11.5px] text-muted-foreground">Si queda en blanco, el sitio no se deja mostrar dentro de otra página: al guardar se revisa y se avisa.</p>
                </CajonSeccion>

                <CajonSeccion titulo="La página" icono={Globe}>
                    <CajonCampo etiqueta="Nombre" pista="Va como rótulo en la casilla.">
                        <Input value={f.nombre} maxLength={40} onChange={(e) => setF((x) => ({ ...x, nombre: e.target.value }))} placeholder="Ej.: Tablero de tránsito" />
                    </CajonCampo>
                    <CajonCampo etiqueta="Dirección" pista="Con https si el panel se abre por https. Sin usuario ni clave adentro.">
                        <Input value={f.url} onChange={(e) => setF((x) => ({ ...x, url: e.target.value.trim() }))} placeholder="https://…" className={cn(problema && "border-[var(--mal)]")} />
                        {problema && <p className="mt-1 text-[12px] tono-mal">{problema}</p>}
                    </CajonCampo>
                </CajonSeccion>

                <CajonSeccion titulo="En la casilla" icono={ZoomIn}>
                    <CajonCampo etiqueta="Volver a cargarla" pista="Para tableros que no se actualizan solos.">
                        <div className="flex flex-wrap gap-1.5">
                            {RECARGAS.filter((m) => m <= RECARGA_MAX_MIN).map((m) => (
                                <button key={m} type="button" onClick={() => setF((x) => ({ ...x, recargaMin: m }))} aria-pressed={f.recargaMin === m}
                                    className={cn("h-8 px-3 rounded-full border text-[12.5px] font-semibold", f.recargaMin === m ? "accion border-transparent" : "border-border hover:bg-accent")}>{m ? `Cada ${m} min` : "Nunca"}</button>
                            ))}
                        </div>
                    </CajonCampo>
                    <CajonCampo etiqueta={`Zoom · ${f.zoom} %`} pista="Menos de 100 % entra más página en la casilla; más, se agranda.">
                        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={5} value={f.zoom} onChange={(e) => setF((x) => ({ ...x, zoom: Number(e.target.value) }))} className="w-full accent-[var(--accion)]" />
                    </CajonCampo>
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}
