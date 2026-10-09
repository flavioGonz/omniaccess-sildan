"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, History, Images, Loader2, Plus, RotateCcw, Save, Search, ShieldAlert, User as UserIco, X, ExternalLink } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Estado, Matricula, Momento, Nada } from "@/components/ui/celdas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { fichaVigilancia, type DeteccionFicha } from "@/app/actions/watchlist";
import {
    guardarFichaListaNegra, bajaFichaListaNegra, reactivarFichaListaNegra, type FichaListaNegra,
} from "@/app/actions/padron";
import { NIVELES, SIN_IDENTIFICAR, type NivelListaNegra } from "@/lib/padron";
import { ExplicacionCategoria, Placa } from "@/components/WatchlistDialog";
import { FotoRegistro, avisarCamaras, subirFoto } from "@/components/users/FichaVigilancia";

/**
 * El cajón de una ficha de la Lista negra: crear y editar, igual que el de una persona.
 *
 * Una ficha es lo que el guardia piensa cuando dice «el de la camioneta blanca»: una persona
 * —o un vehículo sin persona conocida— con una o varias matrículas, un nivel, un motivo y,
 * si se tiene, una foto. Antes había que cargar matrícula por matrícula en una tabla, y la
 * pregunta «¿es el mismo?» no tenía dónde responderse.
 *
 * Las fichas que vienen de una persona del padrón (marcada desde su cajón) o del rol «Lista
 * negra» del módulo facial se abren en sólo lectura: se editan desde la persona, que es donde
 * están sus matrículas de verdad.
 */

/** Cuántas capturas se muestran como evidencia; las lecturas siguen todas en la tabla. */
const EVIDENCIAS_A_LA_VISTA = 9;
const SENTIDO: Record<string, string> = { ENTRY: "Entrada", EXIT: "Salida" };
const limpiar = (v: string) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type Deteccion = DeteccionFicha & { plate: string };

export function CajonListaNegra({ abierta, ficha, chapaInicial, alCerrar, alCambiar, alAbrirPersona }: {
    abierta: boolean;
    /** Null = alta. */
    ficha: FichaListaNegra | null;
    /** Alta desde un atajo con la matrícula ya escrita (?action=listanegra&plate=…). */
    chapaInicial?: string;
    alCerrar: () => void;
    alCambiar: () => void;
    alAbrirPersona?: (userId: string) => void;
}) {
    const esAlta = !ficha;
    const editable = esAlta || ficha!.origen === "ficha" || ficha!.origen === "suelta";
    const [nombre, setNombre] = useState("");
    const [nivel, setNivel] = useState<NivelListaNegra>("BLACKLISTED");
    const [motivo, setMotivo] = useState("");
    const [chapas, setChapas] = useState<string[]>([]);
    const [chapaNueva, setChapaNueva] = useState("");
    const [archivo, setArchivo] = useState<File | null>(null);
    const [guardando, setGuardando] = useState(false);
    /** Lo que hay que confirmar, y qué acción lo pidió (guardar o reactivar), para repetirla confirmada. */
    const [avisos, setAvisos] = useState<{ lista: string[]; accion: "guardar" | "reactivar" } | null>(null);
    const [det, setDet] = useState<{ detecciones: Deteccion[]; total: number } | null>(null);
    const [errorDet, setErrorDet] = useState<string | null>(null);
    const [ampliada, setAmpliada] = useState<Deteccion | null>(null);

    const cargarDet = (lista: string[]) => {
        setDet(null); setErrorDet(null);
        if (!lista.length) { setDet({ detecciones: [], total: 0 }); return; }
        Promise.all(lista.map((p) => fichaVigilancia(p).then((r) => ({ p, r }))))
            .then((rs) => setDet({
                total: rs.reduce((n, x) => n + x.r.total, 0),
                detecciones: rs.flatMap((x) => x.r.detecciones.map((d) => ({ ...d, plate: x.p }))).sort((a, b) => b.ts.localeCompare(a.ts)),
            }))
            .catch((e) => setErrorDet(e?.message || "No se pudieron leer"));
    };

    useEffect(() => {
        if (!abierta) return;
        setNombre(ficha?.nombre || ""); setNivel(ficha?.nivel || "BLACKLISTED"); setMotivo(ficha?.motivo || "");
        const iniciales = ficha?.matriculas || (chapaInicial ? [limpiar(chapaInicial)].filter(Boolean) : []);
        setChapas(iniciales); setChapaNueva(""); setArchivo(null); setAvisos(null);
        if (ficha) cargarDet(ficha.matriculas); else setDet(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierta, ficha?.clave, chapaInicial]);

    const agregarChapa = () => {
        const p = limpiar(chapaNueva);
        if (!p) return;
        if (!chapas.includes(p)) setChapas([...chapas, p]);
        setChapaNueva(""); setAvisos(null);
    };

    const cambios = editable && (esAlta || nombre.trim() !== (ficha!.nombre || "") || nivel !== ficha!.nivel
        || motivo.trim() !== (ficha!.motivo || "") || !!archivo || chapas.join() !== ficha!.matriculas.join());
    const faltaMotivo = nivel === "SEARCH" && !motivo.trim();
    // Una matrícula escrita y sin agregar cuenta: es lo que el operador cree que cargó.
    const chapasFinales = useMemo(() => { const p = limpiar(chapaNueva); return p && !chapas.includes(p) ? [...chapas, p] : chapas; }, [chapas, chapaNueva]);

    async function guardar(confirmar = false) {
        if (!editable) return;
        setGuardando(true);
        try {
            let fotoUrl: string | undefined;
            if (archivo) { const u = await subirFoto(archivo); if (!u) return; fotoUrl = u; }
            const r = await guardarFichaListaNegra({
                clave: ficha?.clave || null, nombre, nivel, motivo, matriculas: chapasFinales, confirmar,
                ...(fotoUrl ? { fotoUrl } : {}),
            });
            if (r.avisos?.length) { setAvisos({ lista: r.avisos, accion: "guardar" }); return; }
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            toast.success({ title: `${nombre.trim() || SIN_IDENTIFICAR} · ${NIVELES[nivel].corto}`, description: NIVELES[nivel].resumen });
            avisarCamaras(r.camaras);
            alCambiar(); alCerrar();
        } finally { setGuardando(false); }
    }

    async function bajaOAlta(confirmar = false) {
        if (!ficha) return;
        setGuardando(true);
        try {
            const r = ficha.activa ? await bajaFichaListaNegra(ficha.clave) : await reactivarFichaListaNegra(ficha.clave, confirmar);
            if (r.avisos?.length) { setAvisos({ lista: r.avisos, accion: "reactivar" }); return; }
            if (!r.ok) { toast.error({ title: ficha.activa ? "No se pudo dar de baja" : "No se pudo reactivar", description: r.error }); return; }
            toast.success({ title: ficha.activa ? "Dada de baja" : "Activa otra vez", description: ficha.activa ? "Queda en la lista como dada de baja, con su historia." : NIVELES[ficha.nivel].resumen });
            avisarCamaras(r.camaras); alCambiar(); alCerrar();
        } finally { setGuardando(false); }
    }

    const evidencias = (det?.detecciones || []).filter((d) => d.foto).slice(0, EVIDENCIAS_A_LA_VISTA);
    const columnas: ColumnaTabla<Deteccion>[] = [
        { clave: "ts", titulo: "Cuándo", ancho: 120, valor: (d) => d.ts, celda: (d) => <Momento t={d.ts} /> },
        { clave: "plate", titulo: "Matrícula", ancho: 104, valor: (d) => d.plate, celda: (d) => <Matricula p={d.plate} /> },
        { clave: "camara", titulo: "Cámara", valor: (d) => d.camara || "", celda: (d) => d.camara ? <span className="text-[12px]">{d.camara}</span> : <Nada /> },
        { clave: "sentido", titulo: "Sentido", ancho: 80, valor: (d) => SENTIDO[d.direccion || ""] || "", celda: (d) => d.direccion ? <span className="text-[12px]">{SENTIDO[d.direccion] || d.direccion}</span> : <Nada /> },
        {
            clave: "decision", titulo: "Barrera", ancho: 100, valor: (d) => d.decision || "",
            celda: (d) => d.decision === "GRANT" ? <Estado tono="bien">concedido</Estado> : d.decision === "DENY" ? <Estado tono="mal">denegado</Estado> : <Nada />,
        },
    ];

    const titulo = esAlta ? "Nueva ficha" : (ficha!.nombre || `${SIN_IDENTIFICAR} · ${ficha!.matriculas[0] || ""}`);
    const descripcion = esAlta ? "Lista negra: una persona o un vehículo, con sus matrículas."
        : `${NIVELES[ficha!.nivel].titulo}${ficha!.activa ? "" : " · dada de baja"}${ficha!.origen === "persona" ? " · persona del padrón" : ficha!.origen === "rol" ? " · por rol (módulo facial)" : ""}`;

    return (
        <Cajon open={abierta} onOpenChange={(o) => { if (!o) alCerrar(); }}>
            <CajonContenido ancho="intermedio" titulo={titulo} descripcion={descripcion}
                pie={
                    <>
                        {ficha && ficha.origen !== "rol" && (
                            <Button type="button" variant="outline" className={cn("mr-auto", ficha.activa && "tono-mal")} onClick={() => bajaOAlta()} disabled={guardando}>
                                {ficha.activa ? <><Ban size={15} /> Dar de baja</> : <><RotateCcw size={15} /> Volver a activar</>}
                            </Button>
                        )}
                        <Button type="button" variant="ghost" onClick={alCerrar}>{editable ? "Cancelar" : "Cerrar"}</Button>
                        {editable && (
                            <Button type="button" onClick={() => guardar()} disabled={!cambios || guardando || chapasFinales.length === 0 || faltaMotivo}>
                                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {esAlta ? "Cargar en la lista" : "Guardar cambios"}
                            </Button>
                        )}
                    </>
                }>

                {/* Lo que hay que confirmar antes de guardar: va arriba, que es donde se mira. */}
                {avisos && (
                    <div className="mx-6 mt-5 rounded-[10px] border chip-aviso p-3 text-[12px] space-y-2">
                        <ul className="space-y-1">{avisos.lista.map((a) => <li key={a}>{a}</li>)}</ul>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => (avisos.accion === "reactivar" ? bajaOAlta(true) : guardar(true))} disabled={guardando}>Sí, seguir</Button>
                            <Button size="sm" variant="outline" onClick={() => setAvisos(null)}>No</Button>
                        </div>
                    </div>
                )}

                {/* ── Quién es ── */}
                <CajonSeccion titulo="Quién es" icono={UserIco}>
                    {editable ? (
                        <>
                            <FotoRegistro url={ficha?.fotoUrl} archivo={archivo} alElegir={setArchivo} deshabilitada={guardando} />
                            <CajonCampo etiqueta="Nombre" ayuda="Opcional. Si no se sabe quién es, queda como «Sin identificar» y se lo reconoce por la matrícula.">
                                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={SIN_IDENTIFICAR} />
                            </CajonCampo>
                        </>
                    ) : (
                        <div className="flex items-center gap-3">
                            {ficha!.fotoUrl
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={ficha!.fotoUrl} alt="" className="w-14 h-14 rounded-[10px] object-cover border border-border" />
                                : <span className="w-14 h-14 rounded-[10px] border border-dashed border-border flex items-center justify-center text-muted-foreground/60"><UserIco size={20} /></span>}
                            <div className="min-w-0 flex-1">
                                <div className="text-[14px] font-semibold">{ficha!.nombre}</div>
                                <div className="text-[12px] text-muted-foreground">{ficha!.unidad || "Sin lote"} · {ficha!.origen === "rol" ? "tiene el rol «Lista negra» del módulo facial" : "marcada desde su ficha de persona"}</div>
                            </div>
                            {ficha!.userId && alAbrirPersona && (
                                <Button type="button" variant="outline" size="sm" onClick={() => alAbrirPersona(ficha!.userId!)}><ExternalLink size={13} /> Abrir la persona</Button>
                            )}
                        </div>
                    )}
                </CajonSeccion>

                {/* ── Nivel y motivo ── */}
                <CajonSeccion titulo="Qué pasa cuando se la lee" icono={ShieldAlert}>
                    <div className="grid grid-cols-2 gap-2">
                        {(Object.keys(NIVELES) as NivelListaNegra[]).map((n) => {
                            const sel = nivel === n;
                            const Ic = n === "BLACKLISTED" ? Ban : Search;
                            return (
                                <Pista key={n} titulo={NIVELES[n].titulo} texto={<ExplicacionCategoria cat={n} />} ancho={340} lado="abajo">
                                    <button type="button" disabled={!editable} aria-pressed={sel} onClick={() => { setNivel(n); setAvisos(null); }}
                                        className={cn("w-full rounded-[10px] border p-3 text-left transition-colors disabled:cursor-default",
                                            sel ? `chip-${NIVELES[n].tono}` : "border-border hover:bg-accent", !editable && !sel && "opacity-50")}>
                                        <span className="flex items-center gap-1.5 text-[13px] font-bold"><Ic size={14} /> {NIVELES[n].titulo}</span>
                                        <span className={cn("block text-[11.5px] mt-0.5 leading-snug", sel ? "opacity-90" : "text-muted-foreground")}>{NIVELES[n].resumen}</span>
                                    </button>
                                </Pista>
                            );
                        })}
                    </div>
                    <CajonCampo etiqueta={nivel === "SEARCH" ? "Qué se busca y por qué" : "Motivo"}
                        ayuda={nivel === "SEARCH" ? "Obligatorio: es lo que el guardia lee en la captura cuando pasa." : "Queda en el registro y lo ven el monitor y Control LPR."}>
                        <Input value={motivo} disabled={!editable} onChange={(e) => setMotivo(e.target.value)}
                            placeholder={nivel === "SEARCH" ? "Ej. «Taxi denunciado por un vecino»" : "Ej. «Robo en Lote 12, denuncia 4512»"} />
                    </CajonCampo>
                </CajonSeccion>

                {/* ── Matrículas ── */}
                <CajonSeccion titulo="Matrículas" icono={ShieldAlert}
                    ayuda={editable ? "Todas las que se le conozcan. Cada una se aplica en la barrera y en las lectoras." : undefined}>
                    <div className="flex flex-wrap items-center gap-2">
                        {chapas.length === 0 && !editable && <span className="text-[12px] text-muted-foreground">Sin matrículas cargadas: la barrera no tiene qué leer.</span>}
                        {chapas.map((p) => (
                            <span key={p} className="inline-flex items-center gap-1">
                                <Placa p={p} />
                                {editable && (
                                    <button type="button" aria-label={`Quitar ${p}`} onClick={() => { setChapas(chapas.filter((x) => x !== p)); setAvisos(null); }}
                                        className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"><X size={13} /></button>
                                )}
                            </span>
                        ))}
                        {editable && (
                            <span className="inline-flex items-center gap-1.5">
                                <input value={chapaNueva} onChange={(e) => setChapaNueva(e.target.value.toUpperCase())} maxLength={10}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarChapa(); } }}
                                    placeholder="ABC1234" aria-label="Matrícula nueva"
                                    className="w-32 h-9 rounded-[6px] border border-border bg-background text-center text-[14px] font-bold tracking-[0.14em] uppercase tabular-nums outline-none focus:ring-2 focus:ring-[var(--accion)]" />
                                <Button type="button" variant="outline" size="sm" onClick={agregarChapa} disabled={!limpiar(chapaNueva)}><Plus size={13} /> Agregar</Button>
                            </span>
                        )}
                    </div>
                </CajonSeccion>

                {/* ── Dónde se la vio ── (sólo una ficha que ya existe) */}
                {ficha && (
                    <>
                        <CajonSeccion titulo="Capturas" icono={Images}
                            ayuda={evidencias.length ? "Las más recientes de las lectoras. Tocá una para verla grande." : undefined}>
                            {!det && !errorDet ? (
                                <div className="text-[12px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Buscando capturas…</div>
                            ) : errorDet ? (
                                <div className="text-[12px] text-muted-foreground">No se pudieron leer: {errorDet} <button onClick={() => cargarDet(ficha.matriculas)} className="tono-accion font-semibold ml-1">Reintentar</button></div>
                            ) : evidencias.length === 0 ? (
                                <div className="text-[12px] text-muted-foreground">Ninguna lectora la vio todavía{det?.total ? " con foto" : ""}.</div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    {evidencias.map((d) => (
                                        <button key={d.id} type="button" onClick={() => setAmpliada(d)} className="group text-left">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={d.foto!} alt={`${d.plate} · ${d.camara || ""}`} loading="lazy" className="w-full aspect-video object-cover rounded-md border border-border bg-black group-hover:opacity-85 transition-opacity" />
                                            <div className="mt-1 text-[10.5px] text-muted-foreground truncate"><Momento t={d.ts} />{d.camara ? ` · ${d.camara}` : ""}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </CajonSeccion>
                        <CajonSeccion titulo="Lecturas" icono={History}
                            ayuda={det && det.total > det.detecciones.length ? `Las ${det.detecciones.length} más recientes de ${det.total}. El resto está en Historial.` : undefined}>
                            <Tabla<Deteccion>
                                id="ficha-lista-negra-lecturas"
                                filas={det?.detecciones || []}
                                clave={(d) => d.id}
                                columnas={columnas}
                                cargando={!det && !errorDet}
                                error={errorDet}
                                alReintentar={() => cargarDet(ficha.matriculas)}
                                alClickFila={(d) => { if (d.foto) setAmpliada(d); }}
                                alto="40vh"
                                nombreArchivo={`lista-negra-${ficha.matriculas[0] || "ficha"}`}
                                vacio={{ icono: History, titulo: "Sin lecturas", ayuda: "Ninguna lectora leyó estas matrículas." }}
                            />
                        </CajonSeccion>
                    </>
                )}
            </CajonContenido>

            <Dialog open={!!ampliada} onOpenChange={(o) => { if (!o) setAmpliada(null); }}>
                <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden bg-black border-border">
                    <DialogTitle className="sr-only">Captura de {ampliada?.plate}</DialogTitle>
                    <DialogDescription className="sr-only">Captura de la lectora</DialogDescription>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {ampliada?.foto && <img src={ampliada.foto} alt={ampliada.plate} className="w-full max-h-[78vh] object-contain bg-black" />}
                    {ampliada && (
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-card text-[12px]">
                            <Matricula p={ampliada.plate} />
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
