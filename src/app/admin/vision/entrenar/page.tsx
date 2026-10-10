"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Plus } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Chip, ErrorEstado, Cargando } from "@/components/ui/estados";
import { useTiempoReal } from "@/lib/tiempo-real";
import { CajonZona, FORM_VACIO, aCuerpo, type FormZona } from "@/components/vision/FormZonaEntrenable";
import { RECOMENDADO_POR_CLASE } from "@/lib/zona-entrenable";
import { EstadoAhora, haceCuanto, type ZonaLista } from "@/components/vision/ZonaComun";

/**
 * OmniVision › Entrenar: las analíticas que arma uno. Cada tarjeta dice lo que importa para
 * confiar en ella: en qué estado está ahora, si decide con frases o con lo entrenado, y cuántos
 * ejemplos tiene.
 */
function Tarjeta({ z }: { z: ZonaLista }) {
    const ejemplos = z.conteo.pos + z.conteo.neg;
    return (
        <Link href={`/admin/vision/entrenar/${z.id}`} className="rounded-[10px] border border-border bg-card overflow-hidden hover:border-[var(--accion)] transition-colors flex flex-col">
            <div className="relative aspect-[4/3] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {z.estado?.muestraUrl ? <img src={`${z.estado.muestraUrl}?w=640`} alt="" className="absolute inset-0 w-full h-full object-contain" />
                    : <div className="absolute inset-0 grid place-items-center text-[12px] text-white/50">Sin muestras todavía</div>}
                {!z.activa && <span className="absolute top-2 left-2"><Chip tono="quieto">Pausada</Chip></span>}
            </div>
            <div className="p-3 space-y-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-[14px] font-bold leading-tight truncate">{z.nombre}</div>
                        <div className="text-[12px] text-muted-foreground truncate">{z.camara} · {z.positivo} / {z.negativo}</div>
                    </div>
                    <EstadoAhora z={z} />
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-muted-foreground tabular-nums">
                    {z.modelo ? <Chip tono="bien">Entrenada · {z.modelo.exactitud != null ? `${Math.round(z.modelo.exactitud * 100)} % de acierto` : "sin medir"}</Chip> : <Chip tono="info">Con frases</Chip>}
                    <span>{ejemplos ? `${z.conteo.pos} + ${z.conteo.neg} ejemplos` : `faltan ejemplos (meta ${RECOMENDADO_POR_CLASE} + ${RECOMENDADO_POR_CLASE})`}</span>
                    {z.estado?.al && <span className="ml-auto">{haceCuanto(z.estado.al)}</span>}
                </div>
                {!z.avisar && <div className="text-[11.5px] text-muted-foreground">No avisa a la guardia: sólo registra.</div>}
            </div>
        </Link>
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
            <div className="rounded-[10px] border border-border bg-card px-4 py-3 flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-muted shrink-0"><GraduationCap size={20} /></span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-[17px] font-bold leading-tight">Analíticas entrenables</h1>
                        {datos && !datos.activa && <Chip tono="quieto">Apagada en Analíticas: no mira ninguna</Chip>}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        Una zona fija de una cámara que se distingue en dos estados: contenedor desbordado o normal, portón abierto o cerrado, lugar ocupado o libre. Arranca con frases; con ejemplos etiquetados aprende esa zona en particular. No sirve para cosas que aparecen en cualquier parte del cuadro (humo, una pelea).
                    </p>
                </div>
                <Button onClick={() => setNueva(true)} disabled={!datos}><Plus size={15} /> Nueva</Button>
            </div>

            {error && !datos ? <ErrorEstado mensaje={error} alReintentar={cargar} />
                : !datos ? <Cargando texto="Trayendo las analíticas…" />
                    : datos.zonas.length === 0 ? (
                        <div className="rounded-[10px] border border-dashed border-border p-10 text-center space-y-2">
                            <p className="text-[13px] text-muted-foreground">Todavía no hay ninguna. Elegí una cámara, dibujá la zona y describí los dos estados.</p>
                            <Button onClick={() => setNueva(true)}><Plus size={15} /> Crear la primera</Button>
                        </div>
                    ) : <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">{datos.zonas.map((z) => <Tarjeta key={z.id} z={z} />)}</div>}

            {nueva && datos && <CajonZona inicial={FORM_VACIO} nueva camaras={datos.camaras} guardando={guardando} alCerrar={() => setNueva(false)} alGuardar={crear} />}
        </div>
    );
}
