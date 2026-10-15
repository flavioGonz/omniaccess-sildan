"use client";

import { AlCelular } from "@/components/vision/entrenar/AlCelular";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus, Boxes, BellRing, Tag, ChevronRight, CircleDashed, Lightbulb, MapPin } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/estados";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CajonZona, FORM_VACIO, aCuerpo, type FormZona } from "@/components/vision/FormZonaEntrenable";
import { RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";
import { EstadoAhora, haceCuanto, type ZonaLista } from "@/components/vision/ZonaComun";
import { MuestraVista } from "@/components/vision/entrenar/Piezas";
import { Camino, ChipEtapa, ConfirmarAvisar, cambiarAvisar } from "@/components/vision/entrenar/Produccion";
import { ACIERTO_PRODUCCION, chequeos, etapaDe, sugerencias, type Etapa } from "@/lib/zona-produccion";
import type { Analisis } from "@/lib/vision-capa";

/**
 * OmniVision › Entrenar · «Cómo está un lugar».
 *
 * Rediseño del 15/10 (Nico: «bloques más pequeños, tipo tabla, con iconografía, preview de la
 * escena y columnas de datos reales; tiene que decir claramente cómo se activan»). Antes eran
 * tarjetas grandes con la foto a 4:3: entraban tres por pantalla y cada una contaba lo suyo con
 * chips sueltos («Entrenada · 97 %», «Sólo registra») sin decir qué venía después.
 *
 * Ahora: arriba el camino de cuatro etapas con cuántas analíticas hay en cada una (cómo se llega
 * a avisar a la guardia, contado una vez); abajo una tabla, una fila por analítica, con la foto
 * de lo que ve, en qué etapa está, ejemplos contra la meta, acierto y lo que hizo en la semana; y
 * en cada fila la acción que corresponde. La etapa y las condiciones salen de lib/zona-produccion.
 */
type Fila = ZonaLista & { estado: (ZonaLista["estado"] & { analisis?: Analisis | null }) | null };

/** Dos barras chicas contra la meta: así se ve de un vistazo qué estado está corto de ejemplos. */
function Ejemplos({ z }: { z: Fila }) {
    const barra = (n: number, nombre: string, tono: string) => (
        <div className="flex items-center gap-2 min-w-0" title={`${n} ejemplos de «${nombre}» (meta ${RECOMENDADO_POR_CLASE})`}>
            <span className="h-1.5 w-20 shrink-0 rounded-full bg-muted overflow-hidden">
                <span className={cn("block h-full rounded-full", n >= RECOMENDADO_POR_CLASE ? "pleno-bien" : tono)} style={{ width: `${Math.min(100, (n / RECOMENDADO_POR_CLASE) * 100)}%` }} />
            </span>
            <span className="text-[11.5px] tabular-nums text-muted-foreground truncate"><b className="text-foreground font-semibold">{n}</b> {nombre}</span>
        </div>
    );
    return (
        <div className="space-y-1 min-w-0">
            {barra(z.conteo.pos, z.positivo, "pleno-aviso")}
            {barra(z.conteo.neg, z.negativo, "bg-[var(--accion)]")}
        </div>
    );
}

export default function EntrenarVision() {
    const router = useRouter();
    const [datos, setDatos] = useState<{ zonas: Fila[]; camaras: { id: string; name: string }[]; activa: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nueva, setNueva] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [confirmar, setConfirmar] = useState<Fila | null>(null);

    const cargar = useCallback(async () => {
        try {
            const r = await fetch("/api/vision/zonas", { cache: "no-store" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            setDatos(j); setError(null);
        } catch (e: any) { setError(e?.message || "No se pudo leer"); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    useTiempoReal<{ id: string; estado: any }>("zona_estado", (d) => setDatos((x) => x ? { ...x, zonas: x.zonas.map((z) => z.id === d.id ? { ...z, estado: { ...d.estado, muestraUrl: d.estado?.muestra ? `/api/vision/imagen/${d.estado.muestra}` : z.estado?.muestraUrl } } : z) } : x));

    const prendida = datos?.activa !== false;
    const cuantas = useMemo(() => {
        const c: Partial<Record<Etapa, number>> = { aprendiendo: 0, prueba: 0, lista: 0, produccion: 0 };
        for (const z of datos?.zonas || []) { const e = etapaDe(z, prendida); c[e] = (c[e] || 0) + 1; }
        return c;
    }, [datos, prendida]);
    // Lo más urgente de todas, con el nombre de la analítica adelante. Tope: es una guía, no una lista de tareas.
    const avisos = useMemo(() => (datos?.zonas || []).flatMap((z) => sugerencias(z, prendida).map((s) => ({ ...s, z })))
        .sort((a, b) => ["mal", "aviso", "bien", "info", "neutro", "quieto"].indexOf(a.tono) - ["mal", "aviso", "bien", "info", "neutro", "quieto"].indexOf(b.tono)).slice(0, 6), [datos, prendida]);

    async function crear(f: FormZona) {
        setGuardando(true);
        try {
            const r = await fetch("/api/vision/zonas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(aCuerpo(f)) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || `El servidor respondió ${r.status}`);
            toast.success({ title: "Analítica creada", description: "Toma la primera muestra en unos segundos." });
            router.push(`/admin/vision/entrenar/${j.id}`);
        } catch (e: any) { toast.error({ title: "No se creó", description: e?.message }); }
        finally { setGuardando(false); }
    }

    const columnas: ColumnaTabla<Fila>[] = [
        {
            clave: "vista", titulo: "Escena", ancho: 128, auxiliar: true,
            celda: (z) => z.estado?.muestraUrl
                ? <MuestraVista url={z.estado.muestraUrl} analisis={z.estado.analisis} ancho={240} etiquetas={false} ajuste="cover" className="h-[60px] w-[104px] rounded-md" />
                : <div className="h-[60px] w-[104px] rounded-md bg-muted grid place-items-center text-[10.5px] text-muted-foreground">sin fotos</div>,
        },
        {
            clave: "nombre", titulo: "Analítica", ordenable: true, valor: (z) => z.nombre,
            celda: (z) => (
                <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{z.nombre}</div>
                    <div className="text-[11.5px] text-muted-foreground truncate inline-flex items-center gap-1"><MapPin size={11} /> {z.camara} · cada {Math.round(z.cadaSeg / 60) || 1} min</div>
                </div>
            ),
        },
        {
            clave: "ahora", titulo: "Ahora", ancho: 190, ayuda: "Lo que dice la última foto, con su probabilidad.", ordenable: true, valor: (z) => z.estado?.prob ?? null,
            celda: (z) => <div className="space-y-1"><EstadoAhora z={z} />{z.estado?.al && <div className="text-[11px] text-muted-foreground tabular-nums">{haceCuanto(z.estado.al)}</div>}</div>,
        },
        {
            clave: "etapa", titulo: "Etapa", ancho: 170, ordenable: true, ayuda: "Aprendiendo → En prueba → Lista para avisar → Avisa a la guardia.",
            valor: (z) => etapaDe(z, prendida),
            celda: (z) => { const c = chequeos(z, prendida); const ok = c.filter((x) => x.ok).length; return <div className="space-y-1"><ChipEtapa etapa={etapaDe(z, prendida)} /><div className="text-[11px] text-muted-foreground tabular-nums">{ok} de {c.length} condiciones</div></div>; },
        },
        { clave: "ejemplos", titulo: "Ejemplos", ancho: 220, ayuda: `Etiquetados de cada estado, contra la meta de ${RECOMENDADO_POR_CLASE}.`, ordenable: true, valor: (z) => z.conteo.pos + z.conteo.neg, celda: (z) => <Ejemplos z={z} /> },
        {
            clave: "esperando", titulo: "Sin etiquetar", ancho: 104, alinear: "der", ordenable: true, valor: (z) => z.conteo.sin,
            celda: (z) => <div className="tabular-nums"><div className="text-[13px] font-semibold">{z.conteo.sin}</div><div className="text-[11px] text-muted-foreground">{z.actividad?.muestras24h ?? 0} fotos en 24 h</div></div>,
        },
        {
            clave: "acierto", titulo: "Acierto", ancho: 92, alinear: "der", ordenable: true, ayuda: "En ejemplos que no vio al entrenar.", valor: (z) => z.modelo?.exactitud ?? null,
            celda: (z) => z.modelo?.exactitud != null
                ? <span className={cn("text-[15px] font-bold tabular-nums", z.modelo.exactitud >= ACIERTO_PRODUCCION ? "tono-bien" : "tono-aviso")}>{Math.round(z.modelo.exactitud * 100)} %</span>
                : <span className="text-[11.5px] text-muted-foreground">con frases</span>,
        },
        {
            clave: "semana", titulo: "7 días", ancho: 130, ordenable: true, ayuda: "Veces que el estado se sostuvo el tiempo elegido, y cuántas avisaron a la guardia.", valor: (z) => z.actividad?.eventos7d ?? 0,
            celda: (z) => {
                const a = z.actividad;
                if (!a?.eventos7d) return <span className="text-[11.5px] text-muted-foreground">no se sostuvo</span>;
                return <div className="tabular-nums"><div className="text-[12.5px]"><b>{a.eventos7d}</b> {a.eventos7d === 1 ? "vez" : "veces"}{a.avisos7d ? <> · <span className="tono-aviso font-semibold">{a.avisos7d} aviso{a.avisos7d === 1 ? "" : "s"}</span></> : ""}</div>{a.ultimoEvento && <div className="text-[11px] text-muted-foreground">{haceCuanto(a.ultimoEvento)}</div>}</div>;
            },
        },
        {
            clave: "accion", titulo: "", ancho: 170, auxiliar: true, alinear: "der",
            celda: (z) => {
                const e = etapaDe(z, prendida);
                const parar = (ev: React.MouseEvent) => ev.stopPropagation();
                if (e === "lista") return <Button size="sm" onClick={(ev) => { parar(ev); setConfirmar(z); }}><BellRing size={14} /> Poner a avisar</Button>;
                if (e === "produccion") return <Button size="sm" variant="outline" onClick={async (ev) => { parar(ev); if (await cambiarAvisar(z.id, false)) cargar(); }}>Volver a prueba</Button>;
                if (z.conteo.sin > 0) return <Button size="sm" variant="outline" onClick={(ev) => { parar(ev); router.push(`/admin/vision/entrenar/${z.id}?etiquetar=1`); }}><Tag size={14} /> Etiquetar {z.conteo.sin}</Button>;
                return <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">Abrir <ChevronRight size={14} /></span>;
            },
        },
    ];

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><GraduationCap size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0 flex-1">
                    <h1 className="text-[17px] font-bold leading-tight">Entrenar</h1>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">Enseñarle a OmniVision algo nuevo, probarlo y ponerlo a avisar a la guardia.</p>
                </div>
                <AlCelular />
                <Button onClick={() => setNueva(true)} disabled={!datos}><Plus size={15} /> Nueva zona</Button>
            </div>

            {/* Las dos formas, como elección (píldora = elección): elegir mal es lo que más tiempo hace perder. */}
            <div className="flex flex-wrap items-stretch gap-2">
                <span className="inline-flex items-center gap-3 rounded-full border-2 border-[var(--accion)] bg-card pl-1.5 pr-4 py-1.5">
                    <IlustracionZona /><span><b className="text-[13px]">Cómo está un lugar</b><span className="block text-[11.5px] text-muted-foreground">dos estados de un mismo lugar · contenedor lleno, portón abierto</span></span>
                </span>
                <Link href="/admin/vision/entrenar/objetos" className="inline-flex items-center gap-3 rounded-full border border-border bg-card pl-1.5 pr-4 py-1.5 hover:bg-accent transition-colors">
                    <IlustracionObjeto /><span><b className="text-[13px] inline-flex items-center gap-1">Un objeto nuevo <Boxes size={13} /></b><span className="block text-[11.5px] text-muted-foreground">que lo encuentre en cualquier cámara · cono, volqueta</span></span>
                </Link>
            </div>

            {/* Cómo llega a la guardia: las cuatro etapas, con cuántas hay en cada una. */}
            <section className="space-y-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <h2 className="text-[15px] font-bold">Cómo llega a avisar a la guardia</h2>
                    <p className="text-[12px] text-muted-foreground">Toda analítica nueva arranca <b className="text-foreground">sin avisar</b>. Cuando cumple las condiciones pasa a «Lista» y se pone a avisar con un botón; se puede volver a prueba en cualquier momento.</p>
                </div>
                <Camino cuantas={cuantas} />
                {datos && !datos.activa && (
                    <p className="rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-[12.5px]"><b>Ninguna está mirando:</b> «Analíticas entrenables» está apagada. <Link href="/admin/vision/analiticas" className="text-[var(--accion)] font-semibold">Prenderla en OmniVision › Analíticas</Link></p>
                )}
            </section>

            <section className="space-y-2">
                <h2 className="text-[15px] font-bold">Analíticas de lugar</h2>
                <Tabla<Fila> id="entrenar-zonas" filas={datos?.zonas || []} clave={(z) => z.id} columnas={columnas}
                    cargando={!datos && !error} error={!datos ? error : null} alReintentar={cargar}
                    vacio={{ icono: GraduationCap, titulo: "Todavía no hay ninguna", ayuda: "Nueva zona: elegí una cámara, dibujá el lugar y describí los dos estados." }}
                    alClickFila={(z) => router.push(`/admin/vision/entrenar/${z.id}`)} seleccionCeldas={false} filasFantasma={3} nombreArchivo="analiticas-de-lugar" />
            </section>

            {avisos.length > 0 && (
                <section className="rounded-[10px] border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-2 text-[13px] font-bold mb-2"><Lightbulb size={15} /> Qué conviene hacer ahora</div>
                    <ul className="divide-y divide-border">
                        {avisos.map((a, i) => (
                            <li key={i}>
                                <Link href={`/admin/vision/entrenar/${a.z.id}`} className="flex items-start gap-2.5 py-2 text-[12.5px] leading-snug hover:bg-accent/40 -mx-2 px-2 rounded-md">
                                    <CircleDashed size={13} className={cn("mt-0.5 shrink-0", a.tono === "mal" ? "tono-mal" : a.tono === "aviso" ? "tono-aviso" : a.tono === "bien" ? "tono-bien" : "tono-info")} />
                                    <span className="min-w-0"><b>{a.z.nombre}:</b> {a.texto}</span>
                                    <ChevronRight size={14} className="ml-auto shrink-0 text-muted-foreground" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {nueva && datos && <CajonZona inicial={FORM_VACIO} nueva camaras={datos.camaras} guardando={guardando} alCerrar={() => setNueva(false)} alGuardar={crear} />}
            {confirmar && <ConfirmarAvisar z={confirmar} id={confirmar.id} prendida={prendida} abierto alCerrar={() => setConfirmar(null)} alCambio={cargar} />}
        </div>
    );
}

/** Una cámara mirando siempre el mismo rectángulo, con dos estados: lleno y vacío. */
function IlustracionZona() {
    return (
        <svg viewBox="0 0 96 64" className="w-[60px] h-10 shrink-0 rounded-[20px]" aria-hidden>
            <rect width={96} height={64} fill="var(--muted)" />
            <rect x={8} y={14} width={36} height={36} rx={2} fill="none" stroke="var(--accion)" strokeWidth={2} strokeDasharray="4 3" />
            <rect x={14} y={30} width={24} height={18} fill="var(--muted-foreground)" /><circle cx={20} cy={26} r={5} fill="var(--muted-foreground)" /><circle cx={30} cy={24} r={6} fill="var(--muted-foreground)" />
            <rect x={52} y={14} width={36} height={36} rx={2} fill="none" stroke="var(--accion)" strokeWidth={2} strokeDasharray="4 3" />
            <rect x={58} y={30} width={24} height={18} fill="var(--muted-foreground)" />
            <text x={26} y={60} fontSize={7} textAnchor="middle" fill="var(--muted-foreground)">lleno</text>
            <text x={70} y={60} fontSize={7} textAnchor="middle" fill="var(--muted-foreground)">normal</text>
        </svg>
    );
}
/** El mismo objeto en dos cámaras distintas, cada uno con su recuadro. */
function IlustracionObjeto() {
    return (
        <svg viewBox="0 0 96 64" className="w-[60px] h-10 shrink-0 rounded-[20px]" aria-hidden>
            <rect width={96} height={64} fill="var(--muted)" />
            <line x1={0} y1={52} x2={96} y2={52} stroke="var(--border)" strokeWidth={2} />
            <rect x={10} y={30} width={22} height={20} fill="var(--muted-foreground)" /><rect x={8} y={26} width={26} height={5} fill="var(--muted-foreground)" />
            <rect x={6} y={24} width={30} height={28} fill="none" stroke="var(--bien)" strokeWidth={1.8} />
            <rect x={66} y={40} width={11} height={10} fill="var(--muted-foreground)" /><rect x={65} y={38} width={13} height={3} fill="var(--muted-foreground)" />
            <rect x={63} y={36} width={17} height={16} fill="none" stroke="var(--bien)" strokeWidth={1.8} />
        </svg>
    );
}
