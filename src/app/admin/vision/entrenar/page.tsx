"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus, Boxes } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CajonZona, FORM_VACIO, aCuerpo, type FormZona } from "@/components/vision/FormZonaEntrenable";
import { RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";
import { haceCuanto, type ZonaLista } from "@/components/vision/ZonaComun";
import { MuestraVista, Medidor } from "@/components/vision/entrenar/Piezas";
import type { Analisis } from "@/lib/vision-capa";
import { motion } from "motion/react";

/**
 * OmniVision › Entrenar: las analíticas que arma uno. Cada tarjeta dice lo que importa para
 * confiar en ella: en qué estado está ahora, si decide con frases o con lo entrenado, y cuántos
 * ejemplos tiene.
 */
function Tarjeta({ z, i }: { z: ZonaLista & { estado: (ZonaLista["estado"] & { analisis?: Analisis | null }) | null }; i: number }) {
    const ejemplos = z.conteo.pos + z.conteo.neg;
    return (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.35 }}>
            <Link href={`/admin/vision/entrenar/${z.id}`} className="group rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors flex flex-col h-full">
                <div className="relative">
                    {z.estado?.muestraUrl ? <MuestraVista url={z.estado.muestraUrl} analisis={z.estado.analisis} ancho={640} className="aspect-[4/3] transition-transform duration-500 group-hover:scale-[1.02]" />
                        : <div className="aspect-[4/3] bg-black grid place-items-center text-[12px] text-white/50">Sin muestras todavía</div>}
                    {!z.activa && <span className="absolute top-2 left-2"><Chip tono="quieto">Pausada</Chip></span>}
                </div>
                <div className="p-3 flex gap-3 flex-1">
                    <Medidor prob={z.estado?.prob ?? null} umbral={z.umbral} positivo={z.positivo} negativo={z.negativo} tam={84} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="text-[14px] font-bold leading-tight truncate">{z.nombre}</div>
                        <div className="text-[12px] text-muted-foreground truncate">{z.camara}</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {z.modelo ? <Chip tono="bien">Entrenada · {z.modelo.exactitud != null ? `${Math.round(z.modelo.exactitud * 100)} %` : "sin medir"}</Chip> : <Chip tono="info">Con frases</Chip>}
                            {!z.avisar && <Chip tono="quieto">Sólo registra</Chip>}
                        </div>
                        <div className="text-[11.5px] text-muted-foreground tabular-nums">
                            {ejemplos ? `${z.conteo.pos} «${z.positivo}» + ${z.conteo.neg} «${z.negativo}»` : `sin ejemplos todavía (meta ${RECOMENDADO_POR_CLASE} de cada uno)`}
                            {z.estado?.al && ` · ${haceCuanto(z.estado.al)}`}
                        </div>
                        {z.estado?.error && <div className="text-[11.5px] tono-mal truncate">{z.estado.error}</div>}
                    </div>
                </div>
            </Link>
        </motion.div>
    );
}

export default function EntrenarVision() {
    const router = useRouter();
    const [datos, setDatos] = useState<{ zonas: ZonaLista[]; camaras: { id: string; name: string }[]; activa: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nueva, setNueva] = useState(false);
    const [guardando, setGuardando] = useState(false);

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
    const pasos = [
        { n: 1, t: "Dibujá la zona", d: "Sobre el contenedor, el portón o el lugar que importa." },
        { n: 2, t: "Describí los dos estados", d: "«Desbordado» y «Normal», con una frase de cómo se ve cada uno." },
        { n: 3, t: "Enseñale con ejemplos", d: "Toma fotos solas; vos decís qué es cada una. Con 30 de cada uno, aprende tu lugar." },
    ];

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

    return (
        <div className="p-6 lg:p-8 space-y-5 max-w-[1500px] mx-auto">
            <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-foreground text-background shrink-0"><GraduationCap size={18} strokeWidth={2.3} /></span>
                <div className="min-w-0">
                    <h1 className="text-[17px] font-bold leading-tight">Entrenar</h1>
                    <p className="text-[12.5px] text-muted-foreground leading-snug">Enseñarle a OmniVision algo nuevo. Hay dos formas, según qué querés que aprenda.</p>
                </div>
            </div>

            {/* Las dos formas, lado a lado: elegir mal es lo que más tiempo hace perder (zonas para
                objetos que se mueven, o cientos de recuadros para algo que es un estado de un lugar). */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <a href="#zonas" className="rounded-[10px] border-2 border-[var(--accion)] bg-card p-4 flex gap-3.5 hover:bg-accent transition-colors">
                    <IlustracionZona />
                    <div className="min-w-0">
                        <div className="text-[14px] font-bold">Cómo está un lugar</div>
                        <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">La cámara mira siempre el mismo lugar y le enseñás a distinguir dos estados.</p>
                        <p className="text-[12px] mt-1.5"><b>Ej.:</b> contenedor desbordado o normal · portón abierto o cerrado · lugar ocupado o libre.</p>
                        <p className="text-[11.5px] text-muted-foreground mt-1.5">Con 30 ejemplos de cada estado. Es esta página.</p>
                    </div>
                </a>
                <Link href="/admin/vision/entrenar/objetos" className="rounded-[10px] border border-border bg-card p-4 flex gap-3.5 hover:bg-accent hover:border-[var(--accion)] transition-colors">
                    <IlustracionObjeto />
                    <div className="min-w-0">
                        <div className="text-[14px] font-bold inline-flex items-center gap-1.5">Un objeto nuevo <Boxes size={14} /></div>
                        <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">Le enseñás al detector una cosa que no conoce, para que la encuentre en cualquier cámara y lugar.</p>
                        <p className="text-[12px] mt-1.5"><b>Ej.:</b> contenedor de basura · cono · carretilla · volqueta.</p>
                        <p className="text-[11.5px] text-muted-foreground mt-1.5">Con 100 a 300 fotos dibujadas. Abre «Objetos nuevos».</p>
                    </div>
                </Link>
            </div>

            <div id="zonas" className="scroll-mt-4 flex items-center gap-2 flex-wrap pt-1">
                <h2 className="text-[15px] font-bold">Zonas entrenables</h2>
                {datos && !datos.activa && <Chip tono="quieto">Apagada en Analíticas: no mira ninguna</Chip>}
                <Button className="ml-auto" onClick={() => setNueva(true)} disabled={!datos}><Plus size={15} /> Nueva zona</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {pasos.map((p, i) => (
                    <motion.div key={p.n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="rounded-[10px] border border-border bg-card px-4 py-3 flex gap-3">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accion)] text-white text-[13px] font-bold tabular-nums shrink-0">{p.n}</span>
                        <div><div className="text-[13px] font-bold">{p.t}</div><div className="text-[12px] text-muted-foreground leading-snug">{p.d}</div></div>
                    </motion.div>
                ))}
            </div>

            {error && !datos ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Trayendo las analíticas…" />
                    : datos.zonas.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-border p-10 text-center space-y-2">
                            <p className="text-[13px] text-muted-foreground">Todavía no hay ninguna. Elegí una cámara, dibujá la zona y describí los dos estados.</p>
                            <Button onClick={() => setNueva(true)}><Plus size={15} /> Crear la primera</Button>
                        </div>
                    ) : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{datos.zonas.map((z, i) => <Tarjeta key={z.id} z={z} i={i} />)}</div>}

            {nueva && datos && <CajonZona inicial={FORM_VACIO} nueva camaras={datos.camaras} guardando={guardando} alCerrar={() => setNueva(false)} alGuardar={crear} />}
        </div>
    );
}

/** Una cámara mirando siempre el mismo rectángulo, con dos estados: lleno y vacío. */
function IlustracionZona() {
    return (
        <svg viewBox="0 0 96 64" className="w-24 h-16 shrink-0 rounded-[8px]" aria-hidden>
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
        <svg viewBox="0 0 96 64" className="w-24 h-16 shrink-0 rounded-[8px]" aria-hidden>
            <rect width={96} height={64} fill="var(--muted)" />
            <line x1={0} y1={52} x2={96} y2={52} stroke="var(--border)" strokeWidth={2} />
            <rect x={10} y={30} width={22} height={20} fill="var(--muted-foreground)" /><rect x={8} y={26} width={26} height={5} fill="var(--muted-foreground)" />
            <rect x={6} y={24} width={30} height={28} fill="none" stroke="var(--bien)" strokeWidth={1.8} />
            <rect x={66} y={40} width={11} height={10} fill="var(--muted-foreground)" /><rect x={65} y={38} width={13} height={3} fill="var(--muted-foreground)" />
            <rect x={63} y={36} width={17} height={16} fill="none" stroke="var(--bien)" strokeWidth={1.8} />
        </svg>
    );
}
