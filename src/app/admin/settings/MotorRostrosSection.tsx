"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, MonitorPlay, Power, RefreshCcw, ScanFace, UserPlus } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Filtros } from "@/components/ui/filtros";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { useConfirmar } from "@/components/ui/use-confirmar";
import { cn } from "@/lib/utils";
import { getEstadoMotorFace, getCamarasParaFace, setFaceCamaras, setModuloFace } from "@/app/actions/face-admin";
import {
    listarRostros, listarCapturasSinIdentidad, leerAjustesRostros, guardarAjustesRostros, estadoMotorRostros, limpiarHuerfanosRostros, rostroDesdeEvento,
    type ListaRostros, type CapturaSinIdentidad,
} from "@/app/actions/rostros";
import { ROSTROS_POR_PAGINA, type EstadoAjustesRostros, type FiltroRostro, type OrdenRostro } from "@/lib/rostros";
import { CajonRostro, ACCIONES_ROSTRO } from "@/components/vision/rostros/CajonRostro";
import { CajonSubirRostro, ACCIONES_SUBIR } from "@/components/vision/rostros/CajonSubirRostro";
import { GrillaBento } from "@/components/vision/rostros/GrillaBento";
import { PropiedadesAciertos, PropiedadesCamaras, PropiedadesMotor, type CamaraFacial } from "@/components/vision/rostros/PropiedadesRostros";

/*
 * Ajustes › Motor de rostros (13/11, Nico: «debe ser más premium en sus controles e interfaz;
 * una grilla tipo bento mostrando todas las capturas, con un sidebar derecho con las propiedades
 * y drawers dinámicos; subir una foto; poder ajustar los % de aciertos; sugerir un registro»).
 *
 * Lo que había era el panel del motor de antes de que existiera la identidad por rostro, y
 * mentía en tres lugares:
 *  · Listaba los SUJETOS del motor y, al que no coincidía con un usuario, le decía «demo» y «sin
 *    foto». Desde el 13/11 esos sujetos son las caras que el modo face fue conociendo
 *    (`rostro-<id>`): tienen foto, número y visitas, y estaban a la vista como basura.
 *  · «Vaciar (3 del demo)» borraba del motor justamente esas caras y dejaba sus fichas en la base
 *    sin modelo: nunca más se las iba a reconocer. Se sacó. Lo que sí hace falta limpiar —lo que
 *    el motor recuerda y la base ya olvidó— tiene su botón, que no toca a nadie con ficha.
 *  · El único umbral que se podía mover era el del padrón enrolado a mano; los dos que deciden si
 *    una cara vista se suma o nace nueva no estaban.
 *
 * Ahora la página es de las CARAS (lo que se viene a mirar): la grilla a la izquierda, las
 * propiedades a la derecha, y todo lo que se hace con una cara pasa en un cajón.
 */

/** Lo que la sección le pide al servidor. Junto, para poder mostrarla con datos de prueba. */
export const ACCIONES_MOTOR = {
    lista: listarRostros, sinIdentidad: listarCapturasSinIdentidad, ajustes: leerAjustesRostros, guardarAjustes: guardarAjustesRostros,
    motor: estadoMotorRostros, limpiar: limpiarHuerfanosRostros, estado: getEstadoMotorFace, camaras: getCamarasParaFace, ponerCamaras: setFaceCamaras,
    modulo: setModuloFace, desdeEvento: rostroDesdeEvento,
    gpu: async (): Promise<Gpu> => { try { const r = await fetch("/api/gpu/vivo", { cache: "no-store" }); return r.ok ? await r.json() : { hay: false }; } catch { return { hay: false }; } },
};
type Gpu = { hay: boolean; uso?: number; watts?: number | null; temp?: number | null; memUsada?: number; memTotal?: number; enGpu?: boolean | null };
type EstadoFace = Awaited<ReturnType<typeof getEstadoMotorFace>>;
type Motor = Awaited<ReturnType<typeof estadoMotorRostros>>;

/** Cada cuánto se vuelve a pedir todo con la página abierta: las caras entran solas. */
const REFRESCO_MS = 20_000;

export default function MotorRostrosSection({ acciones, accionesRostro, accionesSubir }: {
    acciones?: Partial<typeof ACCIONES_MOTOR>; accionesRostro?: Partial<typeof ACCIONES_ROSTRO>; accionesSubir?: Partial<typeof ACCIONES_SUBIR>;
}) {
    // Las mismas funciones en cada render: si no, cada efecto volvería a dispararse.
    const [servidor] = useState(() => ({ ...ACCIONES_MOTOR, ...acciones }));
    const [filtro, setFiltro] = useState<FiltroRostro>("todos");
    const [orden, setOrden] = useState<OrdenRostro>("recientes");
    const [q, setQ] = useState("");
    const [pagina, setPagina] = useState(0);
    const [datos, setDatos] = useState<ListaRostros | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sinId, setSinId] = useState<CapturaSinIdentidad[]>([]);
    const [ajustes, setAjustes] = useState<EstadoAjustesRostros | null>(null);
    const [motor, setMotor] = useState<Motor | null>(null);
    const [estado, setEstado] = useState<EstadoFace | null>(null);
    const [camaras, setCamaras] = useState<CamaraFacial[] | null>(null);
    const [gpu, setGpu] = useState<Gpu | null>(null);
    const [abierta, setAbierta] = useState<{ id: string; registrar?: boolean } | null>(null);
    const [subiendo, setSubiendo] = useState(false);
    const [moduloOcupado, setModuloOcupado] = useState(false);
    const [refrescando, setRefrescando] = useState(false);
    const { confirmar, elemento: cajonConfirmar } = useConfirmar();

    const cargarCaras = useCallback(async () => {
        try { setDatos(await servidor.lista({ filtro, orden, q, pagina })); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo traer la lista"); }
        servidor.sinIdentidad().then(setSinId).catch(() => { });
    }, [servidor, filtro, orden, q, pagina]);
    const cargarMotor = useCallback(async () => {
        // Cada dato por su lado: que el motor no conteste no puede dejar la página sin las cámaras.
        servidor.motor().then(setMotor).catch(() => { });
        servidor.estado().then(setEstado).catch(() => { });
        servidor.gpu().then(setGpu).catch(() => { });
    }, [servidor]);
    useEffect(() => {
        const t = setTimeout(cargarCaras, q ? 250 : 0);
        const i = setInterval(cargarCaras, REFRESCO_MS);
        return () => { clearTimeout(t); clearInterval(i); };
    }, [cargarCaras, q]);
    useEffect(() => {
        cargarMotor();
        servidor.ajustes().then(setAjustes).catch(() => { });
        servidor.camaras().then(setCamaras).catch(() => setCamaras([]));
        const i = setInterval(cargarMotor, REFRESCO_MS);
        return () => clearInterval(i);
    }, [servidor, cargarMotor]);

    const refrescar = async () => { setRefrescando(true); await Promise.all([cargarCaras(), cargarMotor()]); setRefrescando(false); };
    const alternarModulo = async () => {
        if (!estado) return;
        setModuloOcupado(true);
        try { const r = await servidor.modulo(!estado.moduloFace); if (r.success) { toast.success({ title: r.on ? "Modo face prendido" : "Modo face apagado" }); await cargarMotor(); await cargarCaras(); } }
        catch (e: any) { toast.error({ title: "No se pudo cambiar", description: e?.message }); }
        finally { setModuloOcupado(false); }
    };
    const agregarCaptura = async (c: CapturaSinIdentidad) => {
        const ok = await confirmar({
            titulo: "Agregar esta cara como rostro conocido", accion: "Agregar", variante: "accion", icono: UserPlus,
            descripcion: `Quedó sin identidad${c.motivo ? ` por ${c.motivo}` : ""}. Si sabés quién es, se guarda igual con su número y después le ponés el nombre. Con una cara así de chica el motor puede sumarle pasadas de otra persona parecida: conviene revisar su ficha cada tanto.`,
        });
        if (!ok) return;
        try { const r = await servidor.desdeEvento(c.eventoId); toast.success({ title: r.nueva ? `Nació ${r.codigo}` : `Era ${r.nombre || r.codigo}`, description: r.nueva ? "Ahora decile quién es." : "El motor la reconoció: se le sumó esta pasada." }); await cargarCaras(); setAbierta({ id: r.id, registrar: r.nueva }); }
        catch (e: any) { toast.error({ title: "No se pudo agregar", description: e?.message }); }
    };
    const elegir = <T,>(set: (v: T) => void) => (v: string) => { set(v as T); setPagina(0); };

    const prendido = !!estado?.moduloFace;
    const c = datos?.cuentas;
    const paginas = datos ? Math.ceil(datos.total / ROSTROS_POR_PAGINA) : 0;
    const gpuTexto = gpu?.hay ? `${gpu.enGpu === false ? "motor en CPU · " : ""}${gpu.watts != null ? `${Math.round(gpu.watts)} W · ` : ""}${Math.round(gpu.uso || 0)} %${gpu.temp != null ? ` · ${Math.round(gpu.temp)} °C` : ""}` : null;

    return (
        <div className="space-y-5">
            {/* ── Encabezado ── */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-foreground text-background"><ScanFace size={20} strokeWidth={2.2} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="text-[20px] font-bold tracking-[-0.015em] leading-[1.2]">Motor de rostros</h2>
                        {!estado || !motor ? <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full chip-quieto text-[11.5px] font-semibold"><Loader2 size={11} className="animate-spin" /> mirando</span>
                            : !motor.conectado ? <span className="inline-flex items-center h-6 px-2 rounded-full chip-mal text-[11.5px] font-semibold">sin conexión con el motor</span>
                            : prendido && estado.camarasCount > 0 ? <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full chip-bien text-[11.5px] font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-[var(--bien)]" /> mirando {estado.camarasCount} {estado.camarasCount === 1 ? "cámara" : "cámaras"}</span>
                            : <span className="inline-flex items-center h-6 px-2 rounded-full chip-quieto text-[11.5px] font-semibold">{prendido ? "sin cámaras elegidas" : "modo face apagado"}</span>}
                    </div>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">Cada cara nítida que pasa recibe un número; cuando vuelve, se le suma. Acá se miran, se registran y se ajusta cuánto tienen que parecerse.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
                        <BotonRedondo titulo={prendido ? "Apagar el modo face" : "Prender el modo face"} onClick={alternarModulo} ocupado={moduloOcupado} activo={prendido}><Power size={14} /></BotonRedondo>
                        <Link href="/monitor/face" title="Abrir el Monitor Face" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><MonitorPlay size={14} /></Link>
                        <BotonRedondo titulo="Actualizar" onClick={refrescar} ocupado={refrescando}><RefreshCcw size={14} /></BotonRedondo>
                    </div>
                    <Button onClick={() => setSubiendo(true)} className="gap-1.5"><ImagePlus size={15} /> Agregar un rostro</Button>
                </div>
            </div>

            {/* ── Las cifras: cuántas caras hay y cuántas piden algo ── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-px overflow-hidden rounded-[10px] border border-border bg-border">
                <Cifra rotulo="Caras conocidas" valor={c?.todos} pie={c ? `${c.registrados} con nombre` : undefined} />
                <Cifra rotulo="Para registrar" valor={c?.["para-registrar"]} pie="vienen seguido y no tienen nombre" tono={c && c["para-registrar"] > 0 ? "info" : undefined} alTocar={() => { setFiltro("para-registrar"); setPagina(0); }} />
                <Cifra rotulo="Para revisar" valor={c?.sugerencias} pie="¿la misma que otra?" tono={c && c.sugerencias > 0 ? "aviso" : undefined} alTocar={() => { setFiltro("sugerencias"); setPagina(0); }} />
                <Cifra rotulo="Pasadas hoy" valor={datos?.hoy.pasadas} pie={datos ? (datos.hoy.sinIdentidad ? `${datos.hoy.sinIdentidad} sin identidad (cara chica)` : "todas con identidad") : undefined} />
                <Cifra rotulo="Última cara" valor={estado ? (estado.ultimoRostro ? hace(estado.ultimoRostro.cuando) : "—") : undefined} pie={estado?.camaras?.length ? estado.camaras.slice(0, 2).join(", ") + (estado.camaras.length > 2 ? ` y ${estado.camaras.length - 2} más` : "") : "ninguna cámara elegida"} chica />
            </div>

            {/* ── La grilla y las propiedades ── */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
                <div className="min-w-0 space-y-4">
                    <Filtros solido busqueda={q} alBuscar={(v) => { setQ(v); setPagina(0); }} placeholder="Número o nombre" grupos={[
                        { clave: "filtro", titulo: "Cuáles", valor: filtro, alElegir: elegir<FiltroRostro>(setFiltro), opciones: [
                            { valor: "todos", rotulo: "Todas", cuenta: c?.todos },
                            { valor: "para-registrar", rotulo: "Para registrar", cuenta: c?.["para-registrar"], titulo: "Sin nombre y vienen seguido: conviene decir quiénes son" },
                            { valor: "sin-registrar", rotulo: "Sin nombre", cuenta: c?.["sin-registrar"] },
                            { valor: "registrados", rotulo: "Con nombre", cuenta: c?.registrados },
                            { valor: "sugerencias", rotulo: "Para revisar", cuenta: c?.sugerencias, titulo: "Se parecen a otra cara sin llegar al umbral: alguien tiene que decir si son la misma" },
                        ] },
                        { clave: "orden", titulo: "Orden", valor: orden, alElegir: elegir<OrdenRostro>(setOrden), opciones: [
                            { valor: "recientes", rotulo: "Vistas último" }, { valor: "veces", rotulo: "Más visitas" }, { valor: "nuevos", rotulo: "Caras nuevas" },
                        ] },
                    ]} />

                    {!datos && error ? <ErrorEstado mensaje={error} alReintentar={cargarCaras} />
                        : !datos ? <Cargando texto="Trayendo las caras…" />
                        : datos.rostros.length === 0 && (q || filtro !== "todos") ? <Vacio icono={ScanFace} titulo="Ninguna cara con ese filtro" />
                        : datos.rostros.length === 0 && sinId.length === 0 ? (
                            <Vacio icono={ScanFace} titulo="Todavía no hay caras guardadas"
                                ayuda={prendido && (estado?.camarasCount || 0) > 0
                                    ? `Aparecen solas cuando alguien pasa de frente por una cámara elegida, con la cara de ${datos.motor.pxMin} px o más. También podés subir una foto.`
                                    : "El modo face está apagado o sin cámaras: prendelo arriba y elegí las cámaras a la derecha. También podés subir una foto."}
                                accion={<Button onClick={() => setSubiendo(true)} className="gap-1.5"><ImagePlus size={15} /> Agregar un rostro</Button>} />
                        ) : (
                            <GrillaBento rostros={datos.rostros} sinIdentidad={filtro === "todos" && !q && pagina === 0 ? sinId : []} puedeCambiar
                                alAbrir={(id) => setAbierta({ id })} alSubir={filtro === "todos" && !q && pagina === 0 ? () => setSubiendo(true) : undefined} alAgregarCaptura={agregarCaptura} />
                        )}

                    {paginas > 1 && datos && (
                        <div className="flex items-center justify-center gap-3 pt-1 text-[12.5px]">
                            <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="h-8 px-3 rounded-md border border-border font-semibold hover:bg-accent disabled:opacity-40">Anterior</button>
                            <span className="text-muted-foreground tabular-nums">{pagina + 1} de {paginas} · {datos.total.toLocaleString("es-UY")} caras</span>
                            <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)} className="h-8 px-3 rounded-md border border-border font-semibold hover:bg-accent disabled:opacity-40">Siguiente</button>
                        </div>
                    )}
                </div>

                <aside className="space-y-4">
                    <PropiedadesAciertos estado={ajustes} puedeCambiar alGuardar={async (a) => { const r = await servidor.guardarAjustes(a); setAjustes(r); return r; }} />
                    <PropiedadesCamaras camaras={camaras} puedeCambiar
                        alCambiar={async (ids) => { await servidor.ponerCamaras(ids); setCamaras((cs) => (cs || []).map((x) => ({ ...x, facial: ids.includes(x.id) }))); cargarMotor(); }} />
                    <PropiedadesMotor motor={motor} gpu={gpuTexto} puedeCambiar
                        alLimpiar={async () => { try { const r = await servidor.limpiar(); toast.success({ title: r.borrados === 1 ? "Se sacó una cara del motor" : `Se sacaron ${r.borrados} caras del motor` }); cargarMotor(); } catch (e: any) { toast.error({ title: "No se pudo limpiar", description: e?.message }); } }} />
                </aside>
            </div>

            <CajonRostro id={abierta?.id || null} panelInicial={abierta?.registrar ? "registrar" : null} alCerrar={() => setAbierta(null)} alCambiar={() => { cargarCaras(); cargarMotor(); }} alAbrir={(id) => setAbierta({ id })} acciones={accionesRostro} />
            <CajonSubirRostro abierto={subiendo} alCerrar={() => setSubiendo(false)} alGuardar={() => { cargarCaras(); cargarMotor(); }} alAbrirRostro={(id) => setAbierta({ id })} acciones={accionesSubir} />
            {cajonConfirmar}
        </div>
    );
}

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

/** Una cifra de la franja de arriba. Las que piden algo se pueden tocar: filtran la grilla. */
function Cifra({ rotulo, valor, pie, tono, alTocar, chica }: { rotulo: string; valor: number | string | undefined; pie?: string; tono?: "info" | "aviso"; alTocar?: () => void; chica?: boolean }) {
    const cuerpo = (
        <>
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{rotulo}</span>
            <span className={cn("mt-1 block font-bold tabular-nums leading-none tracking-[-0.02em]", chica ? "text-[20px] pt-[6px]" : "text-[26px]", tono && `tono-${tono}`)}>{valor === undefined ? "…" : typeof valor === "number" ? valor.toLocaleString("es-UY") : valor}</span>
            {pie && <span className="mt-1.5 block text-[11.5px] text-muted-foreground leading-tight truncate" title={pie}>{pie}</span>}
        </>
    );
    return alTocar && typeof valor === "number" && valor > 0
        ? <button type="button" onClick={alTocar} className="bg-card px-4 py-3.5 text-left hover:bg-accent/50 transition-colors">{cuerpo}</button>
        : <div className="bg-card px-4 py-3.5">{cuerpo}</div>;
}

function BotonRedondo({ titulo, onClick, ocupado, activo, children }: { titulo: string; onClick: () => void; ocupado?: boolean; activo?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" title={titulo} aria-label={titulo} aria-pressed={activo} onClick={onClick} disabled={ocupado}
            className={cn("grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-60", activo ? "bg-[color-mix(in_oklab,var(--accion)_14%,transparent)] text-[var(--accion)]" : "text-muted-foreground hover:text-foreground hover:bg-muted")}>
            {ocupado ? <Loader2 size={14} className="animate-spin" /> : children}
        </button>
    );
}
