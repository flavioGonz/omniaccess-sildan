"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GraduationCap, ListVideo, Plus, ScanLine, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
import { sileo as toast } from "sileo";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { FilaAnalitica, FichaAnalitica } from "@/components/vision/analiticas";
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

const boton = "shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-[12px] font-semibold hover:bg-accent";

export default function AnaliticasVision() {
    const [estado, setEstado] = useState<Estado | null>(null);
    const [reglas, setReglas] = useState<ReglaVision[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [abierta, setAbierta] = useState<Analitica | null>(null);

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

    const corren = ANALITICAS.filter((a) => a.estado === "corre");
    const resto = ANALITICAS.filter((a) => a.estado !== "corre");
    const lista = (as: Analitica[]) => (
        <div className="rounded-[10px] border border-border bg-card divide-y divide-border">
            {as.map((a) => (
                <FilaAnalitica key={a.id} a={a} prendida={!!estado.analiticas[a.id]} alCambiar={(v) => guardar(a.id, v)} alAbrir={() => setAbierta(a)} accion={acciones(a)} />
            ))}
        </div>
    );

    return (
        <div className="p-6 lg:p-8 space-y-6 max-w-[1500px] mx-auto">
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><Sparkles size={20} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Analíticas</h1>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Lo que se construye encima del detector. Prenderla es decidir que corra; las de línea o zona además necesitan una regla —qué cámara y dónde—, que se crea desde acá.
                    </p>
                </div>
            </div>

            <section className="space-y-2">
                <h2 className="text-[13px] font-bold">Corren hoy <span className="text-muted-foreground font-semibold tabular-nums">· {corren.length}</span></h2>
                {lista(corren)}
            </section>
            {resto.length > 0 && (
                <section className="space-y-2">
                    <h2 className="text-[13px] font-bold">Próximas <span className="text-muted-foreground font-semibold tabular-nums">· {resto.length}</span></h2>
                    <p className="text-[12px] text-muted-foreground">Se pueden prender: se guarda la decisión y se aplica el día que la analítica exista. Cada fila dice en qué estado está.</p>
                    {lista(resto)}
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
