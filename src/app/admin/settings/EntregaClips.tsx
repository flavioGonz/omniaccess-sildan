"use client";

/**
 * Ajustes › Video del evento › Entrega de clips: resolución, calidad, formato de descarga y
 * nombre del archivo. Es lo que leen /api/nvr/playback y /api/events/[id]/export (lib/clips).
 * Cada opción dice qué cuesta: el clip se transcodifica en el momento, así que la resolución
 * es tiempo de espera y peso, no sólo nitidez.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, FileVideo, Package } from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pista } from "@/components/ui/pista";
import { getSetting, updateSetting } from "@/app/actions/settings";
import {
    AJUSTE_CLIP_ALTURA, AJUSTE_CLIP_CALIDAD, AJUSTE_CLIP_NOMBRE, AJUSTE_CLIP_ENTREGA,
    ALTURAS_CLIP, CRF_POR_CALIDAD, CLIP_POR_DEFECTO, TOKENS_NOMBRE, nombreDeClip,
    type AlturaClip, type CalidadClip, type EntregaClip,
} from "@/lib/clips";

const ROTULO_ALTURA: Record<AlturaClip, { rotulo: string; nota: string }> = {
    480: { rotulo: "480p", nota: "Liviano y rápido. Alcanza para ver qué pasó; la chapa se lee si está cerca." },
    720: { rotulo: "720p", nota: "El equilibrio: se lee la chapa y un clip de 20 s pesa unos 3 MB." },
    1080: { rotulo: "1080p", nota: "Más detalle, el doble de peso y de tiempo de conversión." },
    0: { rotulo: "Original", nota: "Tal cual graba el NVR (1080p o 1440p). El más pesado y el más lento de convertir." },
};
const ROTULO_CALIDAD: Record<CalidadClip, { rotulo: string; nota: string }> = {
    alta: { rotulo: "Alta", nota: `Prácticamente igual al original (CRF ${CRF_POR_CALIDAD.alta}). Pesa más.` },
    media: { rotulo: "Media", nota: `Lo normal (CRF ${CRF_POR_CALIDAD.media}): no se nota la diferencia en pantalla.` },
    baja: { rotulo: "Baja", nota: `Para mandar por WhatsApp (CRF ${CRF_POR_CALIDAD.baja}): un tercio del peso, se nota en el detalle fino.` },
};

export default function EntregaClips() {
    const [altura, setAltura] = useState<AlturaClip>(CLIP_POR_DEFECTO.altura);
    const [calidad, setCalidad] = useState<CalidadClip>(CLIP_POR_DEFECTO.calidad);
    const [entrega, setEntrega] = useState<EntregaClip>(CLIP_POR_DEFECTO.entrega);
    const [nombre, setNombre] = useState(CLIP_POR_DEFECTO.nombre);
    const [guardado, setGuardado] = useState({ altura: CLIP_POR_DEFECTO.altura as AlturaClip, calidad: CLIP_POR_DEFECTO.calidad as CalidadClip, entrega: CLIP_POR_DEFECTO.entrega as EntregaClip, nombre: CLIP_POR_DEFECTO.nombre });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        Promise.all([getSetting(AJUSTE_CLIP_ALTURA), getSetting(AJUSTE_CLIP_CALIDAD), getSetting(AJUSTE_CLIP_ENTREGA), getSetting(AJUSTE_CLIP_NOMBRE)]).then(([a, c, e, n]) => {
            const al = Number(a?.value); const ga = (ALTURAS_CLIP as readonly number[]).includes(al) ? (al as AlturaClip) : CLIP_POR_DEFECTO.altura;
            const gc = (c?.value as CalidadClip) in CRF_POR_CALIDAD ? (c!.value as CalidadClip) : CLIP_POR_DEFECTO.calidad;
            const ge = e?.value === "mp4" || e?.value === "zip" ? (e.value as EntregaClip) : CLIP_POR_DEFECTO.entrega;
            const gn = (n?.value || "").trim() || CLIP_POR_DEFECTO.nombre;
            setAltura(ga); setCalidad(gc); setEntrega(ge); setNombre(gn); setGuardado({ altura: ga, calidad: gc, entrega: ge, nombre: gn });
        }).catch(() => { }).finally(() => setCargando(false));
    }, []);

    const cambio = altura !== guardado.altura || calidad !== guardado.calidad || entrega !== guardado.entrega || nombre.trim() !== guardado.nombre;
    const ejemplo = useMemo(() => nombreDeClip(nombre, { camara: "LPR Entrada", matricula: "SDN3149", fecha: new Date(), canal: 3, evento: "a1b2c3" }), [nombre]);

    const guardar = async () => {
        setGuardando(true);
        try {
            await updateSetting(AJUSTE_CLIP_ALTURA, String(altura));
            await updateSetting(AJUSTE_CLIP_CALIDAD, calidad);
            await updateSetting(AJUSTE_CLIP_ENTREGA, entrega);
            await updateSetting(AJUSTE_CLIP_NOMBRE, nombre.trim() || CLIP_POR_DEFECTO.nombre);
            setGuardado({ altura, calidad, entrega, nombre: nombre.trim() || CLIP_POR_DEFECTO.nombre });
            toast.success({ title: "Entrega de clips guardada", description: `${ROTULO_ALTURA[altura].rotulo} · calidad ${ROTULO_CALIDAD[calidad].rotulo.toLowerCase()} · ${entrega === "zip" ? "ZIP con foto y datos" : "sólo el MP4"}` });
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    const Chip = ({ activo, onClick, children, nota }: { activo: boolean; onClick: () => void; children: React.ReactNode; nota: string }) => (
        <Pista titulo={String(children)} texto={nota} lado="abajo">
            <button type="button" onClick={onClick} className={cn("h-9 px-4 rounded-full border text-[11px] font-bold", activo ? "bg-accent text-foreground border-border" : "bg-background text-muted-foreground border-border hover:text-foreground")}>{children}</button>
        </Pista>
    );

    if (cargando) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} /> Leyendo la entrega de clips…</div>;
    return (
        <div className="rounded-[10px] border border-border bg-card p-5 max-w-3xl space-y-5">
            <div>
                <h3 className="text-sm font-bold text-foreground">Entrega de clips</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">Cómo se arma el video cuando se ve o se descarga desde la ficha de un evento, el monitor, el mapa o la consola del guardia. El clip se convierte en el momento: más resolución es más espera y más peso.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Resolución</div>
                    <div className="flex flex-wrap gap-1.5">{ALTURAS_CLIP.map((a) => <Chip key={a} activo={altura === a} onClick={() => setAltura(a)} nota={ROTULO_ALTURA[a].nota}>{ROTULO_ALTURA[a].rotulo}</Chip>)}</div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{ROTULO_ALTURA[altura].nota}</p>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Calidad</div>
                    <div className="flex flex-wrap gap-1.5">{(Object.keys(ROTULO_CALIDAD) as CalidadClip[]).map((c) => <Chip key={c} activo={calidad === c} onClick={() => setCalidad(c)} nota={ROTULO_CALIDAD[c].nota}>{ROTULO_CALIDAD[c].rotulo}</Chip>)}</div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{ROTULO_CALIDAD[calidad].nota}</p>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Al descargar desde la ficha del evento</div>
                    <div className="flex flex-wrap gap-1.5">
                        <Chip activo={entrega === "zip"} onClick={() => setEntrega("zip")} nota="Un ZIP con la captura, el recorte de la matrícula, un evento.json con todos los datos y el clip. Para entregar a un tercero o archivar.">ZIP con foto y datos</Chip>
                        <Chip activo={entrega === "mp4"} onClick={() => setEntrega("mp4")} nota="Sólo el video MP4. Más directo para mandarlo por WhatsApp.">Sólo el MP4</Chip>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">{entrega === "zip" ? <Package size={12} /> : <FileVideo size={12} />}{entrega === "zip" ? "Captura + recorte + evento.json + clip, en una carpeta con el nombre de abajo." : "Un archivo .mp4 con el nombre de abajo."}</p>
                </div>
                <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Nombre del archivo</div>
                    <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="tabular-nums" />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {TOKENS_NOMBRE.map((t) => <button key={t} type="button" onClick={() => setNombre((n) => (n.includes(t) ? n : `${n}_${t}`))} className="chip-neutro rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">{t}</button>)}
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">Quedaría: <span className="font-semibold text-foreground tabular-nums">{ejemplo}.{entrega === "zip" ? "zip" : "mp4"}</span></p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <Button onClick={guardar} disabled={!cambio || guardando}>{guardando ? <Loader2 className="animate-spin mr-2" size={14} /> : <Save className="mr-2" size={14} />} Guardar</Button>
                <span className="text-[11px] text-muted-foreground">Hoy: {ROTULO_ALTURA[guardado.altura].rotulo} · {ROTULO_CALIDAD[guardado.calidad].rotulo.toLowerCase()} · {guardado.entrega === "zip" ? "ZIP" : "MP4"} · {guardado.nombre}</span>
            </div>
        </div>
    );
}
