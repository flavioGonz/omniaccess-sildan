"use client";

import { useMemo } from "react";
import {
    Activity, Calendar as CalendarIcon, Camera, Car, Fingerprint, Palette,
    Route, ScanFace, CreditCard, ShieldAlert, ShieldCheck, ShieldX, SlidersHorizontal, Truck,
    LogIn, LogOut, Check,
} from "lucide-react";
import { Cajon, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { paraInput } from "@/lib/fechas";
import { RASGOS } from "@/components/history/TablaUnificada";

/**
 * El cajón de filtros del historial.
 *
 * Los filtros vivían en el renglón de arriba de la tabla: cinco grupos de botones, dos
 * selectores, un botón de merodeo y, en el encabezado de la página, las dos fechas. Con
 * una cámara sola alcanzaba; con las de este barrio el renglón envolvía en dos y la tabla
 * arrancaba a media pantalla. Y lo que se veía era la mitad de la historia: el grupo de
 * identificación, el de resultado y el de sentido cambiaban un estado que la tabla no
 * leía — se apretaba "Denegados" y seguían saliendo todos.
 *
 * Ahora hay UN botón, que dice cuántos filtros hay puestos, y el cajón presenta cada
 * filtro con su ícono, su nombre y, detrás del signo de pregunta, para qué sirve y qué va
 * a mostrar. Lo que se elige se aplica al instante — no hay botón "Aplicar" porque la
 * tabla está a la vista a la izquierda y se ve cambiar — y abajo del botón quedan los
 * chips de lo que está puesto, que es lo que contesta "¿por qué no aparece lo que busco?".
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
};

export type CambiarFiltros = <K extends keyof FiltrosHistorial>(clave: K, valor: FiltrosHistorial[K]) => void;

/** Los atajos de período. Se calculan al apretar, no al abrir: la medianoche puede pasar con el cajón abierto. */
const ATAJOS: { rotulo: string; dias: number }[] = [
    { rotulo: "Hoy", dias: 0 },
    { rotulo: "Ayer", dias: 1 },
    { rotulo: "7 días", dias: 7 },
    { rotulo: "30 días", dias: 30 },
];

const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return paraInput(d); };

/** Qué significa cada clase de registro, con el mismo texto que la columna Tipo de la tabla. */
const CLASES: { valor: string; rotulo: string; Ico: any; ayuda: string }[] = [
    { valor: "ACCESO", rotulo: "Accesos", Ico: LogIn, ayuda: `${RASGOS.ACCESO_ENTRY.ayuda} Incluye entradas y salidas.` },
    { valor: "PASO", rotulo: "Avistamientos", Ico: RASGOS.PASO.Ico, ayuda: RASGOS.PASO.ayuda },
    { valor: "ESTACIONADO", rotulo: "Estacionados", Ico: RASGOS.ESTACIONADO.Ico, ayuda: RASGOS.ESTACIONADO.ayuda },
    { valor: "VISTO", rotulo: "Vistos", Ico: RASGOS.VISTO.Ico, ayuda: RASGOS.VISTO.ayuda },
];

/**
 * Una opción del cajón: píldora, porque es una elección que se prende y se apaga, no una
 * acción. El tono encendido sólo aparece en las que filtran por algo que ya tiene color
 * en la tabla (permitido en verde, denegado en rojo); las demás se encienden en el azul
 * de acción, que es el único "esto está elegido" del sistema.
 */
function Opcion({ activa, onClick, tono, Ico, children, ayuda, titulo }: {
    activa: boolean; onClick: () => void; tono?: "bien" | "mal" | "aviso";
    Ico?: any; children: React.ReactNode; ayuda?: string; titulo?: string;
}) {
    const encendida = tono ? { bien: "pleno-bien", mal: "pleno-mal", aviso: "pleno-aviso" }[tono] : "accion";
    const boton = (
        <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn("inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full border text-[12px] font-semibold transition-colors",
                activa ? cn(encendida, "border-transparent") : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-accent")}>
            {Ico ? <Ico size={13} className={activa ? "" : "opacity-70"} /> : activa ? <Check size={13} /> : null}
            {children}
        </button>
    );
    return ayuda ? <Pista titulo={titulo || String(children)} texto={ayuda} lado="abajo" ancho={260}>{boton}</Pista> : boton;
}

export function CajonFiltros({ abierto, onOpenChange, f, cambiar, limpiar, camarasDisponibles, colores, tiposVeh, soloSeguimiento, modo, merodeando }: {
    abierto: boolean;
    onOpenChange: (v: boolean) => void;
    f: FiltrosHistorial;
    cambiar: CambiarFiltros;
    limpiar: () => void;
    /** Las cámaras que hay en lo cargado: el filtro ofrece lo que hay en pantalla, no el padrón. */
    camarasDisponibles: string[];
    colores: string[];
    tiposVeh: string[];
    /** Se eligió mirar sólo seguimiento: los filtros de acceso no aplican y se esconden. */
    soloSeguimiento: boolean;
    /** Qué módulos hay: con uno solo, el filtro de identificación no decide nada. */
    modo: "LPR" | "FACE" | "QUEUE" | null;
    /** Cuántas matrículas están marcadas por merodeo ahora. */
    merodeando: number;
}) {
    const alternarEnLista = (clave: "tipos" | "camaras", v: string) => {
        const actual = f[clave];
        cambiar(clave, actual.includes(v) ? actual.filter((x) => x !== v) : [...actual, v]);
    };

    const identificaciones = useMemo(() => [
        ...(modo === null ? [{ valor: "ALL", rotulo: "Todas", Ico: undefined as any, ayuda: "Sin distinguir con qué se identificó." }] : []),
        ...((modo === null || modo === "LPR") ? [{ valor: "PLATE", rotulo: "Matrícula", Ico: Car, ayuda: "Lecturas de matrícula (LPR). Es lo que registran las cámaras de la barrera." }] : []),
        ...((modo === null || modo === "FACE") ? [{ valor: "FACE", rotulo: "Rostro", Ico: ScanFace, ayuda: "Reconocimiento facial en un terminal de acceso." }] : []),
        ...(modo !== "QUEUE" ? [{ valor: "TAG", rotulo: "RFID", Ico: CreditCard, ayuda: "Una tarjeta o un llavero acercado a un lector." }] : []),
    ], [modo]);

    // "Ayer" es un día cerrado; los demás van desde ese día hasta ahora (sin "hasta", o con hoy).
    const periodoActivo = (dias: number) => {
        if (dias === 1) return f.desde === diasAtras(1) && f.hasta === diasAtras(1);
        return f.desde === diasAtras(dias) && (!f.hasta || f.hasta === paraInput(new Date()));
    };
    const ponerPeriodo = (dias: number) => {
        if (dias === 1) { cambiar("desde", diasAtras(1)); cambiar("hasta", diasAtras(1)); return; }
        cambiar("desde", diasAtras(dias)); cambiar("hasta", "");
    };

    return (
        <Cajon open={abierto} onOpenChange={onOpenChange}>
            <CajonContenido ancho="angosto" titulo="Filtros"
                descripcion="Acotá lo que muestra el historial. Cada cambio se aplica al instante sobre la tabla."
                pie={
                    <div className="flex items-center justify-between w-full gap-3">
                        <button type="button" onClick={limpiar}
                            className="text-[12px] font-semibold text-muted-foreground hover:text-foreground underline underline-offset-2 decoration-dotted">
                            Limpiar todo
                        </button>
                        <Button className="h-8" onClick={() => onOpenChange(false)}>Listo</Button>
                    </div>
                }>

                <CajonSeccion compacta titulo="Período" icono={CalendarIcon}
                    pista="Qué fechas entran. Sin período se muestra todo, de lo más nuevo a lo más viejo. Los atajos son relativos a hoy: «7 días» es desde hace una semana hasta ahora.">
                    <div className="flex flex-wrap gap-1.5">
                        {ATAJOS.map((a) => (
                            <Opcion key={a.rotulo} activa={periodoActivo(a.dias)} onClick={() => ponerPeriodo(a.dias)}>{a.rotulo}</Opcion>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className="block text-[11px] font-medium text-muted-foreground mb-1">Desde</span>
                            <input type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => cambiar("desde", e.target.value)}
                                className="w-full h-9 rounded-md border border-border bg-muted/40 px-2.5 text-[12.5px] text-foreground tabular-nums outline-none focus:border-[var(--accion)]" />
                        </label>
                        <label className="block">
                            <span className="block text-[11px] font-medium text-muted-foreground mb-1">Hasta</span>
                            <input type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => cambiar("hasta", e.target.value)}
                                className="w-full h-9 rounded-md border border-border bg-muted/40 px-2.5 text-[12.5px] text-foreground tabular-nums outline-none focus:border-[var(--accion)]" />
                        </label>
                    </div>
                </CajonSeccion>

                <CajonSeccion compacta titulo="Clase de registro" icono={Activity}
                    pista="Entradas y salidas las decide una cámara LPR y abren la barrera. Un avistamiento lo hace una cámara interior y sólo deja constancia. Estacionado es un vehículo quieto dentro del encuadre. Sin ninguna elegida se ven todas; podés elegir varias.">
                    <div className="flex flex-wrap gap-1.5">
                        <Opcion activa={f.tipos.length === 0} onClick={() => cambiar("tipos", [])} ayuda="Todas las clases juntas, en un solo registro ordenado por hora.">Todo</Opcion>
                        {CLASES.map((c) => (
                            <Opcion key={c.valor} activa={f.tipos.includes(c.valor)} onClick={() => alternarEnLista("tipos", c.valor)}
                                Ico={c.Ico} ayuda={c.ayuda} titulo={c.rotulo}>{c.rotulo}</Opcion>
                        ))}
                    </div>
                </CajonSeccion>

                {!soloSeguimiento && identificaciones.length > 1 && (
                    <CajonSeccion compacta titulo="Identificación" icono={Fingerprint}
                        pista="Con qué se identificó el que pasó: la matrícula leída por la cámara (LPR), el rostro en un terminal, o una tarjeta o llavero (RFID). Sólo aplica a los accesos.">
                        <div className="flex flex-wrap gap-1.5">
                            {identificaciones.map((o) => (
                                <Opcion key={o.valor} activa={f.identificacion === o.valor} onClick={() => cambiar("identificacion", o.valor as any)}
                                    Ico={o.Ico} ayuda={o.ayuda} titulo={o.rotulo}>{o.rotulo}</Opcion>
                            ))}
                        </div>
                    </CajonSeccion>
                )}

                {!soloSeguimiento && (
                    <CajonSeccion compacta titulo="Resultado" icono={ShieldCheck}
                        pista="Si el sistema abrió o no. Los denegados son los que conviene revisar: matrícula desconocida, permiso vencido, horario fuera de rango o lista negra. Sólo aplica a los accesos.">
                        <div className="flex flex-wrap gap-1.5">
                            <Opcion activa={f.resultado === "ALL"} onClick={() => cambiar("resultado", "ALL")}>Todos</Opcion>
                            <Opcion activa={f.resultado === "GRANT"} onClick={() => cambiar("resultado", "GRANT")} tono="bien" Ico={ShieldCheck}
                                ayuda="Accesos en los que la barrera abrió." titulo="Permitidos">Permitidos</Opcion>
                            <Opcion activa={f.resultado === "DENY"} onClick={() => cambiar("resultado", "DENY")} tono="mal" Ico={ShieldX}
                                ayuda="Accesos en los que no se abrió. El motivo está en la ficha de cada uno." titulo="Denegados">Denegados</Opcion>
                        </div>
                    </CajonSeccion>
                )}

                {!soloSeguimiento && (
                    <CajonSeccion compacta titulo="Sentido" icono={Route}
                        pista="Entradas o salidas. Sirve para responder quién está adentro, o para mirar sólo el movimiento de una punta. Sólo aplica a los accesos.">
                        <div className="flex flex-wrap gap-1.5">
                            <Opcion activa={f.sentido === "ALL"} onClick={() => cambiar("sentido", "ALL")}>Ambos</Opcion>
                            <Opcion activa={f.sentido === "ENTRY"} onClick={() => cambiar("sentido", "ENTRY")} Ico={LogIn}
                                ayuda="Lecturas de las cámaras de entrada." titulo="Entradas">Entradas</Opcion>
                            <Opcion activa={f.sentido === "EXIT"} onClick={() => cambiar("sentido", "EXIT")} Ico={LogOut}
                                ayuda="Lecturas de las cámaras de salida. Son las que traen la permanencia: cuánto estuvo adentro ese vehículo." titulo="Salidas">Salidas</Opcion>
                        </div>
                    </CajonSeccion>
                )}

                {camarasDisponibles.length >= 2 && (
                    <CajonSeccion compacta titulo="Cámara" icono={Camera}
                        pista="Qué cámara registró el movimiento. Las opciones son las cámaras que aparecen en lo que está cargado, no el padrón de equipos: una cámara sin registros en este período no figura.">
                        <div className="flex flex-wrap gap-1.5">
                            <Opcion activa={f.camaras.length === 0} onClick={() => cambiar("camaras", [])}>Todas</Opcion>
                            {camarasDisponibles.map((c) => (
                                <Opcion key={c} activa={f.camaras.includes(c)} onClick={() => alternarEnLista("camaras", c)} Ico={Camera}>{c}</Opcion>
                            ))}
                        </div>
                    </CajonSeccion>
                )}

                {!soloSeguimiento && (colores.length > 0 || tiposVeh.length > 0) && (
                    <CajonSeccion compacta titulo="Vehículo" icono={Car}
                        pista="Color y tipo de vehículo tal como los reconoció la cámara en cada lectura. Es un dato de la cámara, no del padrón, y se ofrecen sólo los que aparecen en lo cargado.">
                        <div className="grid grid-cols-2 gap-2">
                            {colores.length > 0 && (
                                <label className="block">
                                    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mb-1"><Palette size={11} /> Color</span>
                                    <select value={f.color} onChange={(e) => cambiar("color", e.target.value)}
                                        className="w-full h-9 rounded-md border border-border bg-muted/40 px-2 text-[12.5px] text-foreground outline-none focus:border-[var(--accion)]">
                                        <option value="ALL">Todos</option>
                                        {colores.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </label>
                            )}
                            {tiposVeh.length > 0 && (
                                <label className="block">
                                    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground mb-1"><Truck size={11} /> Tipo</span>
                                    <select value={f.tipoVeh} onChange={(e) => cambiar("tipoVeh", e.target.value)}
                                        className="w-full h-9 rounded-md border border-border bg-muted/40 px-2 text-[12.5px] text-foreground outline-none focus:border-[var(--accion)]">
                                        <option value="ALL">Todos</option>
                                        {tiposVeh.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </label>
                            )}
                        </div>
                    </CajonSeccion>
                )}

                {!soloSeguimiento && (
                    <CajonSeccion compacta titulo="Señales" icono={ShieldAlert}
                        pista="Merodeo marca una matrícula que aparece cuatro veces o más en lo cargado sin llegar a entrar: denegada, o vista pasar sin acceso. Es una señal para mirar, no una conclusión, y se calcula sobre lo que está en pantalla.">
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                                <ShieldAlert size={14} className={f.merodeo ? "text-[var(--mal)]" : "text-muted-foreground/70"} />
                                <span className="text-[12.5px] font-semibold text-foreground">Sólo merodeo</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">
                                    {merodeando > 0 ? `${merodeando} matrícula${merodeando === 1 ? "" : "s"} ahora` : "ninguna ahora"}
                                </span>
                            </span>
                            <Switch checked={f.merodeo} onCheckedChange={(v) => cambiar("merodeo", !!v)} />
                        </label>
                    </CajonSeccion>
                )}
            </CajonContenido>
        </Cajon>
    );
}

/** El botón que abre el cajón. Dice cuántos filtros hay puestos, que es lo que explica por qué la tabla muestra lo que muestra. */
export function BotonFiltros({ puestos, onClick }: { puestos: number; onClick: () => void }) {
    return (
        <Pista titulo="Filtros" texto="Período, clase de registro, resultado, sentido, cámara, vehículo y merodeo, cada uno explicado. Lo que esté puesto se ve en los chips de al lado." lado="abajo">
            <button type="button" onClick={onClick}
                className={cn("inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg border text-[12px] font-semibold transition-colors",
                    puestos > 0 ? "accion border-transparent" : "border-border bg-muted/60 text-foreground hover:bg-accent")}>
                <SlidersHorizontal size={14} />
                Filtros
                {puestos > 0 && (
                    <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white/20 text-[11px] tabular-nums flex items-center justify-center">{puestos}</span>
                )}
            </button>
        </Pista>
    );
}
