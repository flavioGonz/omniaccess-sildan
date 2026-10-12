"use client";

import { useMemo, useState } from "react";
import {
    Bike, Bus, CalendarRange, Camera, Car, Check, ChevronDown, CreditCard, Eraser, Layers, LogIn, LogOut,
    Motorbike, Palette, PawPrint, PersonStanding, ScanEye, ScanFace, ShieldAlert, ShieldCheck, ShieldX, Sparkles, Truck,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filtros, type GrupoFiltro } from "@/components/ui/filtros";
import { Pista } from "@/components/ui/pista";
import { cn } from "@/lib/utils";
import { fechaCorta, paraInput } from "@/lib/fechas";
import { RASGOS } from "@/components/history/TablaUnificada";
import { OPCIONES_VISION, OPCION_RELEIDA } from "@/lib/historial-vision";

/**
 * Los filtros del historial, en una barra a la vista.
 *
 * Vivían en un cajón detrás de un botón «Filtros», con chips debajo para decir qué estaba
 * puesto. Funcionaba, pero para ver «sólo denegadas de hoy» había que abrir el cajón, elegir,
 * cerrarlo y leer los chips: tres pasos para algo que el operador hace veinte veces por turno.
 * En Olivos el historial pasó a una barra con los filtros frecuentes como botones y los demás en
 * desplegables (main 1013697), y acá se hizo lo mismo con los filtros de este historial, que son
 * más: clase de registro, cámaras, vehículo, merodeo y, nuevo, lo que vio OmniVision.
 *
 *   - Resultado y sentido, que se tocan todo el tiempo: botones, una opción por grupo.
 *   - Registros, período, cámaras, vehículo y OmniVision: un botón cada uno que dice lo que
 *     tiene puesto («Hoy», «2 cámaras») y despliega sus opciones con la explicación.
 *   - Merodeo: un interruptor con cuántas matrículas lo cumplen ahora.
 *
 * Cada botón dice su estado: no hacen falta chips para saber por qué no aparece algo.
 */

export type FiltrosHistorial = {
    desde: string; hasta: string;
    tipos: string[];
    identificacion: "ALL" | "PLATE" | "FACE" | "TAG";
    resultado: "ALL" | "GRANT" | "DENY";
    sentido: "ALL" | "ENTRY" | "EXIT";
    camaras: string[];
    color: string;
    tipoVeh: string;
    merodeo: boolean;
    /** Ids de lib/historial-vision: qué tiene que haber visto OmniVision en la foto. */
    vision: string[];
};

export type CambiarFiltros = <K extends keyof FiltrosHistorial>(clave: K, valor: FiltrosHistorial[K]) => void;

export const SIN_FILTROS: FiltrosHistorial = {
    desde: "", hasta: "", tipos: [], identificacion: "ALL", resultado: "ALL", sentido: "ALL",
    camaras: [], color: "ALL", tipoVeh: "ALL", merodeo: false, vision: [],
};

/** Los atajos de período. Se calculan al apretar: la medianoche puede pasar con la pantalla abierta. */
const ATAJOS: { rotulo: string; dias: number }[] = [
    { rotulo: "Hoy", dias: 0 }, { rotulo: "Ayer", dias: 1 }, { rotulo: "7 días", dias: 7 }, { rotulo: "30 días", dias: 30 },
];
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return paraInput(d); };

const CLASES: { valor: string; rotulo: string; Ico: any; ayuda: string }[] = [
    { valor: "ACCESO", rotulo: "Accesos", Ico: LogIn, ayuda: `${RASGOS.ACCESO_ENTRY.ayuda} Entradas y salidas.` },
    { valor: "PASO", rotulo: "Avistamientos", Ico: RASGOS.PASO.Ico, ayuda: RASGOS.PASO.ayuda },
    { valor: "ESTACIONADO", rotulo: "Estacionados", Ico: RASGOS.ESTACIONADO.Ico, ayuda: RASGOS.ESTACIONADO.ayuda },
    { valor: "VISTO", rotulo: "Vistos", Ico: RASGOS.VISTO.Ico, ayuda: RASGOS.VISTO.ayuda },
];

const ICONO_VISION: Record<string, any> = { persona: PersonStanding, auto: Car, camion: Truck, moto: Motorbike, bici: Bike, omnibus: Bus, animal: PawPrint };

/** El botón de un desplegable: dice lo que tiene puesto, y en azul si filtra algo. */
function Desplegable({ Ico, rotulo, puesto, children, ancho = 300, ayuda, titulo, desactivado }: {
    Ico: any; rotulo: string; puesto: boolean; children: React.ReactNode; ancho?: number; ayuda?: string; titulo?: string; desactivado?: string;
}) {
    const boton = (
        <PopoverTrigger asChild disabled={!!desactivado}>
            <button type="button" aria-label={titulo || rotulo}
                className={cn("inline-flex items-center gap-1.5 h-[34px] pl-2.5 pr-2 rounded-lg border text-[12px] font-semibold transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none",
                    puesto ? "accion border-transparent" : "border-border text-foreground hover:bg-accent")}>
                <Ico size={14} className={puesto ? "" : "text-muted-foreground"} />
                {rotulo}
                <ChevronDown size={13} className="opacity-60" />
            </button>
        </PopoverTrigger>
    );
    return (
        <Popover>
            {ayuda || desactivado ? <Pista titulo={titulo || rotulo} texto={desactivado || ayuda || ""} lado="abajo" ancho={260}><span className="inline-flex">{boton}</span></Pista> : boton}
            <PopoverContent align="start" className="p-3 space-y-3" style={{ width: ancho }}>{children}</PopoverContent>
        </Popover>
    );
}

/** Una opción dentro de un desplegable: fila con casilla, ícono, rótulo y su explicación debajo. */
function Casilla({ activa, onClick, Ico, rotulo, ayuda, tono }: { activa: boolean; onClick: () => void; Ico?: any; rotulo: string; ayuda?: string; tono?: string }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("w-full flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", activa ? "bg-[color-mix(in_oklab,var(--accion)_12%,transparent)]" : "hover:bg-accent")}>
            <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border", activa ? "accion border-transparent" : "border-border")}>
                {activa && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
                <span className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", tono)}>{Ico && <Ico size={13} />}{rotulo}</span>
                {ayuda && <span className="block text-[11px] text-muted-foreground leading-snug">{ayuda}</span>}
            </span>
        </button>
    );
}

const Titulo = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{children}</div>
);

export function BarraFiltros({ f, cambiar, limpiar, puestos, camarasDisponibles, colores, tiposVeh, soloSeguimiento, modo, merodeando }: {
    f: FiltrosHistorial; cambiar: CambiarFiltros; limpiar: () => void;
    /** Cuántos filtros hay puestos (más la búsqueda): con alguno aparece «Limpiar». */
    puestos: number;
    camarasDisponibles: string[]; colores: string[]; tiposVeh: string[];
    soloSeguimiento: boolean;
    modo: "LPR" | "FACE" | "QUEUE" | null;
    merodeando: number;
}) {
    const alternar = (clave: "tipos" | "camaras" | "vision", v: string) => {
        const actual = f[clave];
        cambiar(clave, actual.includes(v) ? actual.filter((x) => x !== v) : [...actual, v]);
    };

    // Período: el rótulo del botón dice lo que está puesto.
    const periodoActivo = (dias: number) => dias === 1
        ? f.desde === diasAtras(1) && f.hasta === diasAtras(1)
        : f.desde === diasAtras(dias) && (!f.hasta || f.hasta === paraInput(new Date()));
    const ponerPeriodo = (dias: number) => {
        if (dias === 1) { cambiar("desde", diasAtras(1)); cambiar("hasta", diasAtras(1)); return; }
        cambiar("desde", diasAtras(dias)); cambiar("hasta", "");
    };
    const rotuloPeriodo = useMemo(() => {
        if (!f.desde && !f.hasta) return "Cualquier fecha";
        const atajo = ATAJOS.find((a) => periodoActivo(a.dias));
        if (atajo) return atajo.dias > 1 ? `Últimos ${atajo.rotulo}` : atajo.rotulo;
        const dia = (s: string) => fechaCorta(new Date(`${s}T12:00:00`));
        if (f.desde && f.hasta) return f.desde === f.hasta ? dia(f.desde) : `${dia(f.desde)} – ${dia(f.hasta)}`;
        return f.desde ? `Desde ${dia(f.desde)}` : `Hasta ${dia(f.hasta)}`;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [f.desde, f.hasta]);

    const rotuloTipos = f.tipos.length === 0 ? "Todos los registros"
        : f.tipos.length === 1 ? CLASES.find((c) => c.valor === f.tipos[0])?.rotulo || f.tipos[0] : `${f.tipos.length} clases`;

    const grupos: GrupoFiltro[] = [
        {
            clave: "ident", titulo: "Con qué se identificó", valor: f.identificacion, alElegir: (v) => cambiar("identificacion", v as any),
            oculto: soloSeguimiento || modo !== null,
            opciones: [{ valor: "ALL", rotulo: "Todas" }, { valor: "PLATE", rotulo: "LPR", icono: Car }, { valor: "FACE", rotulo: "Rostro", icono: ScanFace }, { valor: "TAG", rotulo: "RFID", icono: CreditCard }],
        },
        {
            clave: "resultado", titulo: "Si se abrió o no (sólo accesos)", valor: f.resultado, alElegir: (v) => cambiar("resultado", v as any), oculto: soloSeguimiento,
            opciones: [{ valor: "ALL", rotulo: "Todos" }, { valor: "GRANT", rotulo: "Permitidos", tono: "bien", icono: ShieldCheck }, { valor: "DENY", rotulo: "Denegados", tono: "mal", icono: ShieldX }],
        },
        {
            clave: "sentido", titulo: "Entradas o salidas (sólo accesos)", valor: f.sentido, alElegir: (v) => cambiar("sentido", v as any), oculto: soloSeguimiento,
            opciones: [{ valor: "ALL", rotulo: "Ambos" }, { valor: "ENTRY", rotulo: "Entrada", icono: LogIn }, { valor: "EXIT", rotulo: "Salida", icono: LogOut }],
        },
    ];

    const visionPuesta = f.vision.length;
    const [verTodasCamaras, setVerTodasCamaras] = useState(false);
    const CAMARAS_A_LA_VISTA = 12;

    return (
        <div className="flex items-center flex-wrap gap-2">
            <Desplegable Ico={Layers} rotulo={rotuloTipos} puesto={f.tipos.length > 0} titulo="Clase de registro" ancho={320}>
                <Titulo>Qué registros se muestran</Titulo>
                <div className="space-y-0.5">
                    <Casilla activa={f.tipos.length === 0} onClick={() => cambiar("tipos", [])} rotulo="Todos" ayuda="Accesos y seguimiento juntos, ordenados por hora." />
                    {CLASES.map((c) => <Casilla key={c.valor} activa={f.tipos.includes(c.valor)} onClick={() => alternar("tipos", c.valor)} Ico={c.Ico} rotulo={c.rotulo} ayuda={c.ayuda} />)}
                </div>
            </Desplegable>

            <Filtros grupos={grupos} />

            <Desplegable Ico={CalendarRange} rotulo={rotuloPeriodo} puesto={!!(f.desde || f.hasta)} titulo="Período" ancho={300}>
                <Titulo>Período</Titulo>
                <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => { cambiar("desde", ""); cambiar("hasta", ""); }}
                        className={cn("h-7 px-2.5 rounded-full border text-[12px] font-semibold", !f.desde && !f.hasta ? "accion border-transparent" : "border-border hover:bg-accent")}>Todo</button>
                    {ATAJOS.map((a) => (
                        <button key={a.rotulo} type="button" onClick={() => ponerPeriodo(a.dias)}
                            className={cn("h-7 px-2.5 rounded-full border text-[12px] font-semibold", periodoActivo(a.dias) ? "accion border-transparent" : "border-border hover:bg-accent")}>{a.rotulo}</button>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {(["desde", "hasta"] as const).map((k) => (
                        <label key={k} className="block">
                            <span className="block text-[11px] font-medium text-muted-foreground mb-1">{k === "desde" ? "Desde" : "Hasta"}</span>
                            <input type="date" value={f[k]} min={k === "hasta" ? f.desde || undefined : undefined} max={k === "desde" ? f.hasta || undefined : undefined}
                                onChange={(e) => cambiar(k, e.target.value)}
                                className="w-full h-9 rounded-md border border-border bg-muted/40 px-2 text-[12.5px] tabular-nums outline-none focus:border-[var(--accion)]" />
                        </label>
                    ))}
                </div>
            </Desplegable>

            {camarasDisponibles.length >= 2 && (
                <Desplegable Ico={Camera} rotulo={f.camaras.length ? (f.camaras.length === 1 ? f.camaras[0] : `${f.camaras.length} cámaras`) : "Cámaras"}
                    puesto={f.camaras.length > 0} titulo="Cámaras" ancho={280}>
                    <Titulo>Cámaras con registros en lo cargado</Titulo>
                    <div className="space-y-0.5 max-h-[320px] overflow-auto custom-scrollbar">
                        <Casilla activa={f.camaras.length === 0} onClick={() => cambiar("camaras", [])} rotulo="Todas" />
                        {(verTodasCamaras ? camarasDisponibles : camarasDisponibles.slice(0, CAMARAS_A_LA_VISTA)).map((c) => (
                            <Casilla key={c} activa={f.camaras.includes(c)} onClick={() => alternar("camaras", c)} Ico={Camera} rotulo={c} />
                        ))}
                    </div>
                    {camarasDisponibles.length > CAMARAS_A_LA_VISTA && !verTodasCamaras && (
                        <button type="button" onClick={() => setVerTodasCamaras(true)} className="text-[12px] font-semibold tono-accion">Ver las {camarasDisponibles.length}</button>
                    )}
                </Desplegable>
            )}

            {!soloSeguimiento && (colores.length > 0 || tiposVeh.length > 0) && (
                <Desplegable Ico={Car} rotulo={[f.color !== "ALL" ? f.color : "", f.tipoVeh !== "ALL" ? f.tipoVeh : ""].filter(Boolean).join(" · ") || "Vehículo"}
                    puesto={f.color !== "ALL" || f.tipoVeh !== "ALL"} titulo="Vehículo" ancho={280}>
                    <Titulo>Lo que reconoció la cámara LPR</Titulo>
                    <p className="text-[11px] text-muted-foreground leading-snug">Color y tipo según la cámara en cada lectura (no el padrón). Se ofrecen los que aparecen en lo cargado.</p>
                    <div className="grid grid-cols-2 gap-2">
                        {[{ k: "color" as const, rot: "Color", Ico: Palette, ops: colores }, { k: "tipoVeh" as const, rot: "Tipo", Ico: Truck, ops: tiposVeh }].map(({ k, rot, Ico, ops }) => (
                            <label key={k} className="block">
                                <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mb-1"><Ico size={11} /> {rot}</span>
                                <select value={f[k]} onChange={(e) => cambiar(k, e.target.value)} disabled={!ops.length}
                                    className="w-full h-9 rounded-md border border-border bg-muted/40 px-2 text-[12.5px] outline-none focus:border-[var(--accion)]">
                                    <option value="ALL">Todos</option>
                                    {ops.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                </Desplegable>
            )}

            <Desplegable Ico={Sparkles} rotulo={visionPuesta ? `OmniVision · ${visionPuesta}` : "OmniVision"} puesto={visionPuesta > 0} titulo="OmniVision" ancho={340}
                desactivado={soloSeguimiento ? "OmniVision analiza la foto de los accesos: con sólo seguimiento elegido no hay nada que filtrar." : undefined}>
                <div>
                    <Titulo>Lo que vio OmniVision en la foto</Titulo>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                        La inteligencia mira la foto de cada lectura de acceso y anota qué hay. Con varias tildadas alcanza con una. Con este filtro sólo quedan accesos, y sólo los ya analizados (desde el 9/10).
                    </p>
                </div>
                <div className="space-y-0.5">
                    {OPCIONES_VISION.map((o) => (
                        <Casilla key={o.id} activa={f.vision.includes(o.id)} onClick={() => alternar("vision", o.id)} Ico={ICONO_VISION[o.id] || ScanEye} rotulo={o.rotulo} ayuda={o.ayuda} />
                    ))}
                    <div className="border-t border-border my-1.5" />
                    <Casilla activa={f.vision.includes(OPCION_RELEIDA.id)} onClick={() => alternar("vision", OPCION_RELEIDA.id)} Ico={ScanEye} rotulo={OPCION_RELEIDA.rotulo} ayuda={OPCION_RELEIDA.ayuda} />
                </div>
                {visionPuesta > 0 && <button type="button" onClick={() => cambiar("vision", [])} className="text-[12px] font-semibold tono-accion">Quitar este filtro</button>}
            </Desplegable>

            {!soloSeguimiento && (
                <Pista titulo="Merodeo" texto="La misma matrícula cuatro veces o más en lo cargado sin llegar a entrar (denegada, o vista pasar). Es una señal para mirar, no una conclusión." lado="abajo" ancho={260}>
                    <button type="button" onClick={() => cambiar("merodeo", !f.merodeo)} aria-pressed={f.merodeo}
                        className={cn("inline-flex items-center gap-1.5 h-[34px] px-2.5 rounded-lg border text-[12px] font-semibold transition-colors whitespace-nowrap",
                            f.merodeo ? "pleno-mal border-transparent" : "border-border text-foreground hover:bg-accent")}>
                        <ShieldAlert size={14} className={f.merodeo ? "" : "text-muted-foreground"} />
                        Merodeo<span className={cn("tabular-nums", f.merodeo ? "opacity-80" : "text-muted-foreground")}>· {merodeando}</span>
                    </button>
                </Pista>
            )}

            {puestos > 0 && (
                <button type="button" onClick={limpiar}
                    className="inline-flex items-center gap-1.5 h-[34px] px-2.5 rounded-lg text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Eraser size={14} /> Limpiar
                </button>
            )}
        </div>
    );
}
