"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanFace, Settings2, UserCheck, GitMerge, ImagePlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CajonSubirRostro } from "@/components/vision/rostros/CajonSubirRostro";
import { Filtros } from "@/components/ui/filtros";
import { Cargando, ErrorEstado, Vacio } from "@/components/ui/estados";
import { cn } from "@/lib/utils";
import { CajonRostro, CaraRostro, ACCIONES_ROSTRO } from "@/components/vision/rostros/CajonRostro";
import type { ListaRostros } from "@/app/actions/rostros";
import { textoVeces, FRECUENTE_DESDE, ROSTROS_POR_PAGINA, type FilaRostro, type FiltroRostro, type OrdenRostro } from "@/lib/rostros";

/*
 * Las caras que vio el modo face (13/11, Nico: «debe guardar el rostro detectado y asignarle un
 * id, compararlo para saber cuántas veces pasa, poder registrarlo»). Una grilla de caras: la foto
 * es lo que se viene a mirar; debajo, quién es (o su número) y cuántas veces vino.
 */

/** Cada cuánto se vuelve a pedir la lista con la pantalla abierta: las caras entran solas. */
const REFRESCO_MS = 20_000;

const hace = (iso: string) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? "recién" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

export function VistaRostros({ acciones }: { acciones?: Partial<typeof ACCIONES_ROSTRO> }) {
    const listar = acciones?.lista || ACCIONES_ROSTRO.lista;
    const [filtro, setFiltro] = useState<FiltroRostro>("todos");
    const [orden, setOrden] = useState<OrdenRostro>("recientes");
    const [q, setQ] = useState("");
    const [pagina, setPagina] = useState(0);
    const [datos, setDatos] = useState<ListaRostros | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<string | null>(null);
    const [subiendo, setSubiendo] = useState(false);

    const cargar = useCallback(async () => {
        try { setDatos(await listar({ filtro, orden, q, pagina })); setError(null); }
        catch (e: any) { setError(e?.message || "No se pudo traer la lista"); }
    }, [listar, filtro, orden, q, pagina]);
    useEffect(() => {
        // La búsqueda espera a que se deje de escribir; lo demás es inmediato.
        const t = setTimeout(cargar, q ? 250 : 0);
        const i = setInterval(cargar, REFRESCO_MS);
        return () => { clearTimeout(t); clearInterval(i); };
    }, [cargar, q]);
    const elegir = <T,>(set: (v: T) => void) => (v: string) => { set(v as T); setPagina(0); };

    if (!datos && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!datos) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las caras…" /></div>;

    const m = datos.motor, c = datos.cuentas;
    const paginas = Math.ceil(datos.total / ROSTROS_POR_PAGINA);
    return (
        <div className="p-6 lg:p-8 space-y-4 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><ScanFace size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Rostros</h1>
                        {m.prendido && m.camaras > 0
                            ? <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full chip-bien text-[11.5px] font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-[var(--bien)] animate-pulse" /> Mirando caras en {m.camaras} {m.camaras === 1 ? "cámara" : "cámaras"}</span>
                            : <span className="inline-flex items-center h-6 px-2 rounded-full chip-quieto text-[11.5px] font-semibold">{m.prendido ? "Sin cámaras elegidas" : "Modo face apagado"}</span>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug">
                        Cada cara nítida que no se parece a ninguna conocida recibe un número; cuando vuelve a pasar, se le suma.
                        Hace falta una cara de {m.pxMin} px o más. Una cara sin registrar se olvida a los {m.anonimosDias} días sin verla.
                    </p>
                </div>
                <Link href="/admin/settings?seccion=motor_rostros" className="h-8 px-3 rounded-md border border-border text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-accent">
                    <Settings2 size={14} /> Motor y cámaras
                </Link>
                <Button size="sm" onClick={() => setSubiendo(true)} className="gap-1.5"><ImagePlus size={14} /> Agregar un rostro</Button>
            </div>

            <Filtros solido busqueda={q} alBuscar={(v) => { setQ(v); setPagina(0); }} placeholder="Número o nombre" grupos={[
                { clave: "filtro", titulo: "Cuáles", valor: filtro, alElegir: elegir<FiltroRostro>(setFiltro), opciones: [
                    { valor: "todos", rotulo: "Todos", cuenta: c.todos },
                    { valor: "para-registrar", rotulo: "Para registrar", cuenta: c["para-registrar"], titulo: "Sin nombre y vienen seguido: conviene decir quiénes son" },
                    { valor: "sin-registrar", rotulo: "Sin registrar", cuenta: c["sin-registrar"] },
                    { valor: "registrados", rotulo: "Registrados", cuenta: c.registrados },
                    { valor: "frecuentes", rotulo: `${FRECUENTE_DESDE} visitas o más`, cuenta: c.frecuentes },
                    { valor: "sugerencias", rotulo: "Para revisar", cuenta: c.sugerencias, titulo: "Se parecen a otra cara sin llegar al umbral: alguien tiene que decir si son la misma" },
                ] },
                { clave: "orden", titulo: "Orden", valor: orden, alElegir: elegir<OrdenRostro>(setOrden), opciones: [
                    { valor: "recientes", rotulo: "Vistos último" }, { valor: "veces", rotulo: "Más visitas" }, { valor: "nuevos", rotulo: "Caras nuevas" },
                ] },
            ]} />

            {datos.rostros.length === 0 ? (
                <Vacio icono={ScanFace}
                    titulo={q || filtro !== "todos" ? "Ninguna cara con ese filtro" : "Todavía no hay caras guardadas"}
                    ayuda={q || filtro !== "todos" ? undefined : m.prendido && m.camaras > 0
                        ? `Aparecen solas cuando alguien pasa de frente por una cámara elegida, con la cara de ${m.pxMin} px o más. En cámaras de escena la cara suele quedar chica: sirve una que mire el paso de cerca.`
                        : "El modo face está apagado o sin cámaras: se prende en Ajustes › Modos › Motor de rostros."} />
            ) : (
                <div className="grid gap-x-4 gap-y-5 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))]">
                    {datos.rostros.map((r) => <Tarjeta key={r.id} r={r} alAbrir={() => setAbierta(r.id)} />)}
                </div>
            )}

            {paginas > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2 text-[12.5px]">
                    <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} className="h-8 px-3 rounded-md border border-border font-semibold hover:bg-accent disabled:opacity-40">Anteriores</button>
                    <span className="text-muted-foreground tabular-nums">{pagina + 1} de {paginas} · {datos.total.toLocaleString("es-UY")} caras</span>
                    <button type="button" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)} className="h-8 px-3 rounded-md border border-border font-semibold hover:bg-accent disabled:opacity-40">Siguientes</button>
                </div>
            )}

            <CajonRostro id={abierta} alCerrar={() => setAbierta(null)} alCambiar={cargar} alAbrir={setAbierta} acciones={acciones} />
            <CajonSubirRostro abierto={subiendo} alCerrar={() => setSubiendo(false)} alGuardar={cargar} alAbrirRostro={setAbierta} />
        </div>
    );
}

/** Una cara de la grilla: la foto manda; debajo, quién es y cuántas veces vino. */
function Tarjeta({ r, alAbrir }: { r: FilaRostro; alAbrir: () => void }) {
    return (
        <button type="button" onClick={alAbrir} className="group text-left min-w-0">
            <span className="relative block">
                <CaraRostro src={r.foto} alt={r.nombre || r.codigo} className="aspect-[5/6] w-full transition-transform duration-200 group-hover:scale-[1.02]" />
                {r.veces > 1 && <span className="absolute right-1.5 top-1.5 h-[22px] min-w-[22px] px-1.5 rounded-full bg-black/70 text-white text-[11.5px] font-bold tabular-nums grid place-items-center backdrop-blur-sm" title={textoVeces(r.veces)}>{r.veces}</span>}
                {r.frecuencia.conviene && !r.sugerencia && <span className="absolute left-1.5 top-1.5 h-[22px] w-[22px] rounded-full pleno-info grid place-items-center" title="Viene seguido y no tiene nombre: conviene registrarla"><Sparkles size={12} /></span>}
                {r.sugerencia && <span className="absolute left-1.5 top-1.5 h-[22px] w-[22px] rounded-full pleno-aviso grid place-items-center" title={`Se parece a ${r.sugerencia.nombre || r.sugerencia.codigo}: para revisar`}><GitMerge size={12} /></span>}
            </span>
            <span className="mt-2 flex items-center gap-1.5 min-w-0">
                {r.registro && <UserCheck size={13} className="tono-bien shrink-0" />}
                <span className={cn("text-[13px] font-bold truncate", !r.nombre && "tabular-nums")}>{r.nombre || r.codigo}</span>
            </span>
            <span className="block text-[11.5px] text-muted-foreground truncate">{textoVeces(r.veces)} · {hace(r.ultimaVez)}</span>
            {r.ultimaCamara && <span className="block text-[11px] text-muted-foreground/80 truncate">{r.ultimaCamara}</span>}
        </button>
    );
}
