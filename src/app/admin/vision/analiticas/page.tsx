"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Car, FlaskConical, GraduationCap, Hash, ListVideo, Plus, ScanLine, ScanSearch, ShieldAlert, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { sileo as toast } from "sileo";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Switch } from "@/components/ui/switch";
import { Filtros } from "@/components/ui/filtros";
import { FichaAnalitica, Ic, TONO_ANALITICA } from "@/components/vision/analiticas";
import { cn } from "@/lib/utils";
import { ANALITICAS, type Analitica } from "@/lib/vision-catalogo";
import { TIPOS_REGLA, type TipoRegla, type ReglaVision } from "@/lib/vision-reglas";

/**
 * OmniVision › Analíticas: qué analíticas corren, y desde acá crearles la regla.
 *
 * Prender una analítica es decidir que corra. Las de línea o zona (conteo, sentido contrario,
 * permanencia, aglomeración) además necesitan una regla —qué cámara y dónde—; sin regla están
 * prendidas y no miran nada, así que la fila dice cuántas tiene y ofrece crear la primera.
 * Las demás (registro, relectura, rotulado) no llevan regla: se ven en su propia pantalla.
 *
 * Antes esta lista vivía en el laboratorio, mezclada con las pruebas.
 */

type Estado = { analiticas: Record<string, boolean>; clases: Record<string, boolean> };

/** Qué tipo de regla aplica cada analítica (la inversa de TIPOS_REGLA[tipo].analitica). */
const TIPO_DE_ANALITICA: Record<string, TipoRegla> = Object.fromEntries(
    (Object.entries(TIPOS_REGLA) as [TipoRegla, (typeof TIPOS_REGLA)[TipoRegla]][]).map(([tipo, t]) => [t.analitica, tipo]),
);
/** Las que no llevan regla pero tienen pantalla donde se ve lo que hacen. */
const PANTALLA_DE_ANALITICA: Record<string, { href: string; rotulo: string; icono: typeof ListVideo }> = {
    registro: { href: "/admin/vision/detecciones", rotulo: "Ver detecciones", icono: ListVideo },
    rotulados: { href: "/admin/vision/detecciones", rotulo: "Ver en detecciones", icono: ListVideo },
    relectura: { href: "/admin/vision/relecturas", rotulo: "Ver relecturas", icono: ScanLine },
    busqueda: { href: "/admin/vision/buscar", rotulo: "Abrir la búsqueda", icono: ScanSearch },
    "verif-intrusion": { href: "/admin/vision/verificacion", rotulo: "Ver cómo le va", icono: ShieldCheck },
    "zona-entrenable": { href: "/admin/vision/entrenar", rotulo: "Entrenar", icono: GraduationCap },
};

/**
 * Los modos, en el orden en que se piensan en un barrio, con su ícono. Antes era una lista de
 * treinta renglones de texto parejo: para encontrar «Merodeo» había que leerlos todos.
 */
const MODOS: { v: Analitica["modo"] | ""; r: string; i: typeof Sparkles }[] = [
    { v: "", r: "Todas", i: Boxes }, { v: "Intrusión", r: "Intrusión", i: ShieldAlert }, { v: "LPR", r: "LPR", i: Car },
    { v: "Conteo", r: "Conteo", i: Hash }, { v: "Búsqueda", r: "Búsqueda", i: ScanSearch }, { v: "Entrenables", r: "Entrenables", i: GraduationCap },
    { v: "Face", r: "Face", i: UserRound }, { v: "Filas", r: "Filas", i: Users }, { v: "Prueba", r: "Prueba", i: FlaskConical },
];

const boton = "shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold hover:bg-accent";

export default function AnaliticasVision() {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [reglas, setReglas] = useState<ReglaVision[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<Analitica | null>(null);
    const [modo, setModo] = useState<string>("");

    const cargar = useCallback(async () => {
        try {
            const [e, r] = await Promise.all([fetch("/api/vision/estado", { cache: "no-store" }), fetch("/api/vision/reglas", { cache: "no-store" })]);
            const je = await e.json().catch(() => ({}));
            if (!e.ok) throw new Error(je?.error || `El servidor respondió ${e.status}`);
            const jr = await r.json().catch(() => ({}));
            setEstado({ analiticas: je.analiticas || {}, clases: je.clases || {} });
            // Sin reglas no es un error de la pantalla: se cuenta cero y se sigue.
            setReglas(r.ok && Array.isArray(jr.reglas) ? jr.reglas : []);
            setError(null);
        } catch (x: any) { setError(x?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const porTipo = useMemo(() => {
        const m: Partial<Record<TipoRegla, { total: number; activas: number }>> = {};
        for (const r of reglas) {
            const c = (m[r.tipo] ||= { total: 0, activas: 0 });
            c.total++; if (r.activa) c.activas++;
        }
        return m;
    }, [reglas]);

    async function guardar(id: string, prendida: boolean) {
        if (!estado) return;
        const antes = estado.analiticas[id];
        setEstado({ ...estado, analiticas: { ...estado.analiticas, [id]: prendida } });
        try {
            const r = await fetch("/api/vision/ajustes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo: "analitica", id, prendida }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setEstado((e) => (e ? { ...e, analiticas: j.analiticas } : e));
        } catch (x: any) {
            setEstado((e) => (e ? { ...e, analiticas: { ...e.analiticas, [id]: antes } } : e));
            toast.error({ title: "No se guardó", description: x?.message });
        }
    }

    /** Lo que se puede hacer con una analítica además de prenderla. */
    function acciones(a: Analitica, enFicha = false) {
        const tipo = TIPO_DE_ANALITICA[a.id];
        if (tipo) {
            const n = porTipo[tipo];
            return (
                <span className="inline-flex items-center gap-2">
                    {n?.total ? <Chip tono={n.activas ? "bien" : "quieto"}>{n.total} {n.total === 1 ? "regla" : "reglas"}{n.activas !== n.total ? ` · ${n.activas} activa${n.activas === 1 ? "" : "s"}` : ""}</Chip>
                        : !enFicha && estado?.analiticas[a.id] ? <span className="text-[11px] text-muted-foreground whitespace-nowrap">sin regla: no mira nada</span> : null}
                    <Link href={`/admin/vision/reglas?nueva=${tipo}`} className={boton}><Plus size={13} /> {n?.total ? "Otra regla" : "Crear regla"}</Link>
                </span>
            );
        }
        const p = PANTALLA_DE_ANALITICA[a.id];
        if (p) { const I = p.icono; return <Link href={p.href} className={boton}><I size={13} /> {p.rotulo}</Link>; }
        return null;
    }

    if (!estado && error) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><ErrorEstado mensaje={error} alReintentar={cargar} /></div>;
    if (!estado) return <div className="p-6 lg:p-8 max-w-[1500px] mx-auto"><Cargando texto="Trayendo las analíticas…" /></div>;

    const visibles = ANALITICAS.filter((a) => !modo || a.modo === modo);
    const corren = visibles.filter((a) => a.estado === "corre");
    const resto = visibles.filter((a) => a.estado !== "corre");
    // Los números de arriba son de todas, no del filtro: dicen cómo está el sistema.
    const todas = ANALITICAS.filter((a) => a.estado === "corre");
    const prendidas = todas.filter((a) => estado.analiticas[a.id]).length;
    const sinRegla = todas.filter((a) => estado.analiticas[a.id] && TIPO_DE_ANALITICA[a.id] && !porTipo[TIPO_DE_ANALITICA[a.id]]?.total).length;
    const reglasActivas = reglas.filter((r) => r.activa).length;
    const modosConAlgo = MODOS.filter((m) => !m.v || ANALITICAS.some((a) => a.modo === m.v));

    const tarjeta = (a: Analitica) => {
        const on = !!estado.analiticas[a.id];
        const t = TONO_ANALITICA[a.estado];
        const corre = a.estado === "corre";
        return (
            <div key={a.id} className={cn("rounded-[10px] border bg-card flex flex-col transition-colors", on && corre ? "border-border" : "border-border/70", !corre && "bg-muted/30")}>
                <button type="button" onClick={() => setAbierta(a)} className="flex items-start gap-3 p-3.5 pb-2 text-left flex-1 group">
                    {/* El ícono lleno dice si está prendida: azul corre y mira, negro apagada, gris todavía no existe. */}
                    <span className={cn("grid h-10 w-10 place-items-center rounded-[10px] shrink-0 transition-colors",
                        !corre ? "bg-muted text-muted-foreground" : on ? "bg-[var(--accion)] text-white" : "bg-foreground text-background")}>
                        <Ic n={a.icono} size={19} />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                            <span className="text-[13.5px] font-bold leading-tight group-hover:text-[var(--accion)] transition-colors">{a.nombre}</span>
                        </span>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">{a.modo}{a.fase ? ` · fase ${a.fase}` : ""}</span>
                        <span className="text-[12px] text-muted-foreground leading-snug mt-1.5 line-clamp-2">{a.queHace}</span>
                    </span>
                </button>
                <div className="flex items-center gap-2 px-3.5 pb-3 pt-1 flex-wrap">
                    {corre ? acciones(a) : <Chip tono={t.tono}>{t.texto}</Chip>}
                    <span className="ml-auto inline-flex items-center gap-2">
                        {!corre && <span className="text-[11px] text-muted-foreground">{on ? "se aplica cuando exista" : "apagada"}</span>}
                        {a.id === "prueba" ? <span className="text-[11px] text-muted-foreground">siempre</span>
                            : <Switch checked={on} onCheckedChange={(v) => guardar(a.id, v)} aria-label={`${on ? "Apagar" : "Prender"} ${a.nombre}`} />}
                    </span>
                </div>
            </div>
        );
    };
    const grilla = (as: Analitica[]) => <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2.5">{as.map(tarjeta)}</div>;
    const cifra = (n: number, r: string, tono?: string) => (
        <div className="rounded-[10px] border border-border bg-card px-3.5 py-2.5 min-w-[130px]">
            <div className={cn("text-[22px] font-bold tabular-nums leading-none", tono)}>{n}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{r}</div>
        </div>
    );

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><Sparkles size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold leading-tight">Analíticas</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug">Lo que se construye encima del detector. Tocá una para ver qué hace y qué necesita.</p>
                </div>
            </div>

            <div className="flex gap-2 flex-wrap">
                {cifra(todas.length, "corren hoy")}
                {cifra(prendidas, "prendidas", "tono-accion")}
                {cifra(reglasActivas, reglasActivas === 1 ? "regla activa" : "reglas activas")}
                {sinRegla > 0 && cifra(sinRegla, "prendidas sin regla: no miran nada", "tono-aviso")}
            </div>

            <Filtros solido grupos={[{ clave: "modo", titulo: "Modo", valor: modo, alElegir: setModo, opciones: modosConAlgo.map((m) => ({ valor: m.v, rotulo: m.r, icono: m.i })) }]} />

            {corren.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Corren hoy · <span className="tabular-nums">{corren.length}</span></h2>
                    {grilla(corren)}
                </section>
            )}
            {resto.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Próximas · <span className="tabular-nums">{resto.length}</span></h2>
                    <p className="text-[12px] text-muted-foreground">Se pueden prender: se guarda la decisión y se aplica el día que la analítica exista.</p>
                    {grilla(resto)}
                </section>
            )}

            <Cajon open={!!abierta} onOpenChange={(o) => { if (!o) setAbierta(null); }}>
                {abierta && (
                    <CajonContenido ancho="intermedio" titulo={abierta.nombre} descripcion={`Modo ${abierta.modo}${abierta.fase ? ` · fase ${abierta.fase} del plan` : ""}`}>
                        <FichaAnalitica a={abierta} prendida={!!estado.analiticas[abierta.id]} prendidas={estado.clases}
                            alCambiar={(v) => guardar(abierta.id, v)} pie={acciones(abierta, true)} />
                    </CajonContenido>
                )}
            </Cajon>
        </div>
    );
}
