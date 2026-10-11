"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Loader2, Bell, BellOff, Ban, RotateCcw, Save, User as UserIco, History, Images, ImagePlus, ScanFace } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import {
    updateWatch, deactivateWatch, reactivateWatch, fichaVigilancia, subirFotoVigilancia,
    type FilaVigilancia, type DeteccionFicha,
} from "@/app/actions/watchlist";
import { WATCH_CATEGORY_LIST, watchCatMeta, type WatchCategory } from "@/lib/watch-categories";
import { resumirCamaras } from "@/lib/lista-negra";
import { ExplicacionCategoria } from "@/components/WatchlistDialog";

/**
 * La ficha de una entrada de la lista de vigilancia (matrícula suelta o de una persona).
 *
 * Antes se editaba en la misma fila de la tabla: un select y un input que aparecían en lugar
 * de la celda. Alcanzaba para cambiar el motivo, pero no para lo que de verdad se pregunta
 * quien abre una entrada de lista negra: ¿se la vio?, ¿cuándo, por dónde, qué hizo la
 * barrera?, ¿hay foto? Eso vive acá, en un cajón como la ficha de una persona, con la tabla a
 * la vista del otro lado.
 *
 * Las filas "por rol" (módulo facial) se abren en sólo lectura: no tienen entrada propia que
 * editar, pero sí detecciones que mirar.
 */

/** Cuántas capturas se muestran como evidencia. Las detecciones siguen todas en su tabla. */
const EVIDENCIAS_A_LA_VISTA = 12;

export type FilaPorRol = { id: string; plate: string; category: "BLACKLISTED"; label: string; motivo: null; color: null; notify: true; active: true; createdAt: null; updatedAt: null; deactivatedAt: null; createdBy: null; userId: string; userName: string; unidad: string | null; origen: "rol"; fotoUrl: null };
export type Fila = FilaVigilancia | FilaPorRol;

export function avisarCamaras(camaras?: { ok: any[]; fallo: any[] }) {
    if (!camaras) return;
    const texto = resumirCamaras(camaras);
    if (camaras.fallo.length) toast.warning({ title: "Lectoras: alguna no respondió", description: texto });
    else toast.success({ title: "Lectoras actualizadas", description: texto });
}

/**
 * La foto del registro: elegir una imagen y verla antes de guardar. No sube nada por su
 * cuenta — quien la usa decide cuándo (al marcar, o al guardar la ficha) para no dejar
 * archivos huérfanos en el almacenamiento si se arrepiente.
 */
export function FotoRegistro({ url, archivo, alElegir, deshabilitada, tam = 88, compacta }: {
    url?: string | null; archivo: File | null; alElegir: (f: File | null) => void; deshabilitada?: boolean; tam?: number;
    /** En la barra de alta: sólo el recuadro, y la explicación al pasar el mouse. */
    compacta?: boolean;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [vista, setVista] = useState<string | null>(null);
    useEffect(() => {
        if (!archivo) { setVista(null); return; }
        const u = URL.createObjectURL(archivo); setVista(u);
        return () => URL.revokeObjectURL(u);
    }, [archivo]);
    const src = vista || url || null;
    const explicacion = "Queda como foto del registro, para reconocerla a simple vista. Todavía no se carga en las cámaras faciales.";
    const entrada = <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { alElegir(e.target.files?.[0] || null); e.target.value = ""; }} />;
    if (compacta) return (
        <Pista titulo={src ? "Foto del rostro elegida" : "Foto del rostro (opcional)"} texto={archivo ? `${explicacion} Tocala para quitarla.` : explicacion} lado="abajo">
            <button type="button" disabled={deshabilitada} onClick={() => (archivo ? alElegir(null) : ref.current?.click())}
                style={{ width: tam, height: tam }}
                className={cn("shrink-0 rounded-[6px] overflow-hidden border flex items-center justify-center",
                    src ? "border-border bg-black" : "border-dashed border-border text-muted-foreground/60 hover:text-[var(--accion)] hover:border-[var(--accion)]")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt="Foto del registro" className="w-full h-full object-cover" /> : <ScanFace size={16} />}
                {entrada}
            </button>
        </Pista>
    );
    return (
        <div className="flex items-center gap-3">
            <button type="button" disabled={deshabilitada} onClick={() => ref.current?.click()}
                style={{ width: tam, height: tam }}
                className={cn("shrink-0 rounded-[10px] overflow-hidden border flex items-center justify-center",
                    src ? "border-border bg-black" : "border-dashed border-border text-muted-foreground/50 hover:text-[var(--accion)] hover:border-[var(--accion)]")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {src ? <img src={src} alt="Foto del registro" className="w-full h-full object-cover" /> : <ScanFace size={tam > 60 ? 26 : 18} />}
            </button>
            <div className="min-w-0 text-[11.5px] text-muted-foreground leading-snug">
                <div className="flex gap-2">
                    <button type="button" disabled={deshabilitada} onClick={() => ref.current?.click()} className="font-semibold tono-accion inline-flex items-center gap-1"><ImagePlus size={12} /> {src ? "Cambiar foto" : "Subir foto del rostro"}</button>
                    {archivo && <button type="button" onClick={() => alElegir(null)} className="text-muted-foreground hover:text-foreground">Quitar</button>}
                </div>
                <p className="mt-0.5">{explicacion}</p>
            </div>
            {entrada}
        </div>
    );
}

/** Sube la foto elegida y devuelve su URL; avisa y devuelve null si falla. */
export async function subirFoto(archivo: File): Promise<string | null> {
    const fd = new FormData(); fd.append("foto", archivo);
    const r = await subirFotoVigilancia(fd);
    if (!r.ok) { toast.error({ title: "No se pudo subir la foto", description: r.error }); return null; }
    return r.url;
}

const SENTIDO: Record<string, string> = { ENTRY: "Entrada", EXIT: "Salida" };

export function FichaVigilancia({ fila, alCerrar, alCambiar }: { fila: Fila | null; alCerrar: () => void; alCambiar: () => void }) {
    const editable = !!fila && fila.origen !== "rol";
    const [motivo, setMotivo] = useState("");
    const [cat, setCat] = useState<WatchCategory>("BLACKLISTED");
    const [notify, setNotify] = useState(true);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [det, setDet] = useState<{ detecciones: DeteccionFicha[]; total: number } | null>(null);
    const [errorDet, setErrorDet] = useState<string | null>(null);
    const [ampliada, setAmpliada] = useState<DeteccionFicha | null>(null);

    const cargarDet = (plate: string) => {
        setDet(null); setErrorDet(null);
        fichaVigilancia(plate).then(setDet).catch((e) => setErrorDet(e?.message || "No se pudo leer"));
    };
    useEffect(() => {
        if (!fila) return;
        setMotivo(fila.motivo || fila.label || ""); setCat(fila.category); setNotify(fila.notify); setArchivo(null);
        cargarDet(fila.plate);
    }, [fila?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!fila) return null;
    const meta = watchCatMeta(fila.category);
    const cambios = editable && (motivo.trim() !== (fila.motivo || fila.label || "") || cat !== fila.category || notify !== fila.notify || !!archivo);

    async function guardar() {
        if (!fila || fila.origen === "rol") return;
        setGuardando(true);
        try {
            let fotoUrl: string | undefined;
            if (archivo) { const u = await subirFoto(archivo); if (!u) return; fotoUrl = u; }
            const r = await updateWatch(fila.id, { motivo: motivo.trim() || null, label: motivo.trim(), category: cat, notify, ...(fotoUrl ? { fotoUrl } : {}) });
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            toast.success({ title: `${fila.plate} · guardada` });
            avisarCamaras(r.camaras); setArchivo(null); alCambiar(); alCerrar();
        } finally { setGuardando(false); }
    }
    async function bajaOAlta() {
        if (!fila || fila.origen === "rol") return;
        setGuardando(true);
        try {
            const r = fila.active ? await deactivateWatch(fila.id) : await reactivateWatch(fila.id);
            if (!r.ok) { toast.error({ title: fila.active ? "No se pudo dar de baja" : "No se pudo activar", description: r.error }); return; }
            avisarCamaras(r.camaras); alCambiar(); alCerrar();
        } finally { setGuardando(false); }
    }

    const evidencias = (det?.detecciones || []).filter((d) => d.foto).slice(0, EVIDENCIAS_A_LA_VISTA);
    const columnas: ColumnaTabla<DeteccionFicha>[] = [
        { clave: "ts", titulo: "Cuándo", ancho: 120, valor: (d) => d.ts, celda: (d) => <Momento t={d.ts} /> },
        { clave: "camara", titulo: "Cámara", valor: (d) => d.camara || "", celda: (d) => d.camara ? <span className="text-[12px]">{d.camara}</span> : <Nada /> },
        { clave: "sentido", titulo: "Sentido", ancho: 84, valor: (d) => SENTIDO[d.direccion || ""] || d.direccion || "", celda: (d) => d.direccion ? <span className="text-[12px]">{SENTIDO[d.direccion] || d.direccion}</span> : <Nada /> },
        {
            clave: "decision", titulo: "Barrera", ancho: 104, valor: (d) => d.decision || "",
            celda: (d) => d.decision === "GRANT" ? <Estado tono="bien">concedido</Estado> : d.decision === "DENY" ? <Estado tono="mal">denegado</Estado> : <Nada />,
        },
    ];

    return (
        <Cajon open={!!fila} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido
                ancho="intermedio"
                titulo={fila.plate}
                descripcion={`${meta.label}${fila.userName ? ` · ${fila.userName}` : ""}${fila.active ? "" : " · inactiva"}`}
                pie={editable ? (
                    <>
                        <Button type="button" variant="outline" className={cn("mr-auto", fila.active && "text-[var(--mal)]")} onClick={bajaOAlta} disabled={guardando}>
                            {fila.active ? <><Ban size={15} /> Dar de baja</> : <><RotateCcw size={15} /> Volver a activar</>}
                        </Button>
                        <Button type="button" variant="ghost" onClick={alCerrar}>Cancelar</Button>
                        <Button type="button" onClick={guardar} disabled={!cambios || guardando}>
                            {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar cambios
                        </Button>
                    </>
                ) : <Button type="button" variant="ghost" onClick={alCerrar}>Cerrar</Button>}>

                {/* ── El registro ── */}
                <CajonSeccion titulo="El registro" icono={ShieldAlert}>
                    <div className="flex items-center gap-3 flex-wrap">
                        <Matricula p={fila.plate} className="text-[15px]" />
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wider", meta.badge)}>{meta.label}</span>
                        {fila.active
                            ? <Estado tono={fila.category === "BLACKLISTED" ? "mal" : "info"}>activa</Estado>
                            : <Estado tono="quieto">inactiva</Estado>}
                        {det && <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">{det.total} lectura{det.total === 1 ? "" : "s"} en total</span>}
                    </div>

                    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                        <dt className="text-muted-foreground">Persona</dt>
                        <dd>{fila.userName ? <span className="inline-flex items-center gap-1.5"><UserIco size={12} className="text-muted-foreground" /> {fila.userName}{fila.unidad ? <span className="text-muted-foreground"> · {fila.unidad}</span> : null}</span> : <Nada />}</dd>
                        <dt className="text-muted-foreground">Origen</dt>
                        <dd>{fila.origen === "rol" ? "Por rol (módulo facial): se saca desde ese módulo" : fila.origen === "persona" ? "Persona: arrastra todas sus matrículas" : "Matrícula suelta"}</dd>
                        <dt className="text-muted-foreground">Cargó</dt>
                        <dd>{fila.createdBy || <Nada />}</dd>
                        <dt className="text-muted-foreground">Desde</dt>
                        <dd>{fila.createdAt ? <Momento t={fila.createdAt} /> : <Nada />}</dd>
                        {fila.deactivatedAt && (<><dt className="text-muted-foreground">Baja</dt><dd><Momento t={fila.deactivatedAt} /></dd></>)}
                    </dl>

                    {editable ? (
                        <>
                            <CajonCampo etiqueta="Motivo" ayuda="Queda en el registro y es lo que ven el monitor y Control LPR.">
                                <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué está en la lista" />
                            </CajonCampo>
                            <div>
                                <div className="text-[12px] font-medium text-foreground/85 mb-1.5">Categoría</div>
                                <div className="flex gap-1.5 flex-wrap">
                                    {WATCH_CATEGORY_LIST.map((c) => (
                                        <Pista key={c.value} titulo={c.label} texto={<ExplicacionCategoria cat={c.value} />} ancho={360} lado="abajo">
                                            <button type="button" onClick={() => setCat(c.value)} className={cn("h-8 px-3 rounded-full border text-[10px] font-bold uppercase tracking-wide", cat === c.value ? c.badge : "bg-background text-muted-foreground border-border hover:text-foreground")}>{c.label}</button>
                                        </Pista>
                                    ))}
                                    <Pista titulo={notify ? "Avisa" : "En silencio"} texto="Con aviso, al detectarse dispara la regla WATCHLIST del motor de notificaciones. En silencio sólo se ve en las pantallas." lado="abajo">
                                        <button type="button" onClick={() => setNotify((n) => !n)} className={cn("h-8 px-3 rounded-full border text-[11px] font-bold flex items-center gap-1.5", notify ? "bg-[var(--info-suave)] text-[var(--info)] border-border" : "bg-background text-muted-foreground border-border")}>{notify ? <Bell size={13} /> : <BellOff size={13} />} {notify ? "Avisa" : "Silencio"}</button>
                                    </Pista>
                                </div>
                            </div>
                            <div>
                                <div className="text-[12px] font-medium text-foreground/85 mb-1.5">Foto del registro</div>
                                <FotoRegistro url={fila.fotoUrl} archivo={archivo} alElegir={setArchivo} deshabilitada={guardando} />
                            </div>
                        </>
                    ) : (
                        <p className="text-[12px] text-muted-foreground">Sin entrada propia en la lista: está en lista negra porque su dueño tiene el rol «Lista negra». Se edita desde el módulo facial.</p>
                    )}
                </CajonSeccion>

                {/* ── Evidencias ── */}
                <CajonSeccion titulo="Evidencias" icono={Images} ayuda={det && evidencias.length ? `Las ${evidencias.length} capturas más recientes de las lectoras. Tocá una para verla grande.` : undefined}>
                    {!det && !errorDet ? (
                        <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Buscando capturas…</div>
                    ) : errorDet ? (
                        <div className="text-[12px] text-muted-foreground">No se pudieron leer: {errorDet} <button onClick={() => cargarDet(fila.plate)} className="tono-accion font-semibold ml-1">Reintentar</button></div>
                    ) : evidencias.length === 0 ? (
                        <div className="text-[12px] text-muted-foreground">Ninguna lectora la vio todavía{det?.total ? " con foto" : ""}.</div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {evidencias.map((d) => (
                                <button key={d.id} type="button" onClick={() => setAmpliada(d)} className="group text-left">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={d.foto!} alt={`${fila.plate} · ${d.camara || ""}`} loading="lazy" className="w-full aspect-video object-cover rounded-md border border-border bg-black group-hover:opacity-85 transition-opacity" />
                                    <div className="mt-1 text-[10.5px] text-muted-foreground truncate"><Momento t={d.ts} />{d.camara ? ` · ${d.camara}` : ""}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </CajonSeccion>

                {/* ── Detecciones ── */}
                <CajonSeccion titulo="Detecciones" icono={History}
                    ayuda={det && det.total > det.detecciones.length ? `Se muestran las ${det.detecciones.length} más recientes de ${det.total}. El resto está en Historial.` : undefined}>
                    <Tabla<DeteccionFicha>
                        id="ficha-vigilancia-detecciones"
                        filas={det?.detecciones || []}
                        clave={(d) => d.id}
                        columnas={columnas}
                        cargando={!det && !errorDet}
                        error={errorDet}
                        alReintentar={() => cargarDet(fila.plate)}
                        alClickFila={(d) => { if (d.foto) setAmpliada(d); }}
                        alto="42vh"
                        nombreArchivo={`detecciones-${fila.plate}`}
                        vacio={{ icono: History, titulo: "Sin detecciones", ayuda: "Ninguna lectora leyó esta matrícula." }}
                    />
                </CajonSeccion>
            </CajonContenido>

            {/* La captura grande, encima del cajón. */}
            <Dialog open={!!ampliada} onOpenChange={(o) => { if (!o) setAmpliada(null); }}>
                <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden bg-black border-border">
                    <DialogTitle className="sr-only">Captura de {fila.plate}</DialogTitle>
                    <DialogDescription className="sr-only">Captura de la lectora</DialogDescription>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {ampliada?.foto && <img src={ampliada.foto} alt={fila.plate} className="w-full max-h-[78vh] object-contain bg-black" />}
                    {ampliada && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-card text-[12px]">
                            <Matricula p={fila.plate} />
                            <Momento t={ampliada.ts} />
                            {ampliada.camara && <span className="text-muted-foreground">{ampliada.camara}</span>}
                            {ampliada.direccion && <span className="text-muted-foreground">{SENTIDO[ampliada.direccion] || ampliada.direccion}</span>}
                            <span className="ml-auto">{ampliada.decision === "GRANT" ? <Estado tono="bien">concedido</Estado> : ampliada.decision === "DENY" ? <Estado tono="mal">denegado</Estado> : null}</span>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </Cajon>
    );
}
