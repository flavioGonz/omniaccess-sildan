"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eraser, Loader2, RotateCcw, Search, SlidersHorizontal, Video } from "lucide-react";
import { sileo as toast } from "sileo";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { LIMITES_ROSTROS, normalizarAjustesRostros, veredictoCamara, USO_CAMARAS_DIAS, type AjustesRostros, type EstadoAjustesRostros, type UsoCamaraRostros } from "@/lib/rostros";

/*
 * Las propiedades del motor de rostros, en la columna de la derecha (13/11, Nico: «debo poder
 * ajustar los % de aciertos»; «un sidebar derecho con las propiedades»).
 *
 * Antes había un solo número («umbral de identidad», 0,89) en un campo de texto, y era el del
 * padrón enrolado a mano: los dos que de verdad deciden si una cara vista se suma a una conocida
 * o nace como nueva (FACE_UMBRAL_MISMA y FACE_UMBRAL_PARECIDA) no se podían tocar desde ningún
 * lado. Ahora están los tres, cada uno diciendo QUÉ pasa de un lado y del otro, y una regla que
 * los muestra juntos: se ve dónde cae «otra persona», «se parece» y «misma persona».
 *
 * Nada se guarda al mover: se guarda con el botón, y mientras tanto dice que hay cambios.
 */

const pct = (v: number) => `${Math.round(v * 100)} %`;

export function PropiedadesAciertos({ estado, alGuardar, puedeCambiar }: {
    estado: EstadoAjustesRostros | null;
    alGuardar: (a: AjustesRostros) => Promise<EstadoAjustesRostros & { avisos: string[] }>;
    puedeCambiar: boolean;
}) {
    const [a, setA] = useState<AjustesRostros | null>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (estado) setA({ misma: estado.misma, parecida: estado.parecida, padron: estado.padron, pxMin: estado.pxMin, anonimosDias: estado.anonimosDias }); }, [estado]);
    if (!estado || !a) return <Bloque titulo="Aciertos" icono={SlidersHorizontal}><p className="text-[12.5px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Leyendo los ajustes…</p></Bloque>;

    const claves = ["misma", "parecida", "padron", "pxMin", "anonimosDias"] as const;
    const cambio = claves.some((k) => a[k] !== estado[k]);
    const deFabrica = claves.every((k) => a[k] === estado.porDefecto[k]);
    // Mover «misma» por debajo de «se parece» arrastra a la otra: nunca se muestran cruzadas.
    const poner = (k: keyof AjustesRostros, v: number) => setA((x) => {
        if (!x) return x;
        const y = { ...x, [k]: v };
        if (k === "misma" && y.parecida > v) y.parecida = v;
        if (k === "parecida" && v > y.misma) y.misma = v;
        return y;
    });
    const guardar = async () => {
        setGuardando(true);
        try {
            const r = await alGuardar(normalizarAjustesRostros(a, estado).ajustes);
            toast.success({ title: "Ajustes guardados", description: "El modo face los toma solo, en menos de un minuto. No cambian lo ya decidido." });
            r.avisos.forEach((t) => toast.warning({ title: "Se corrigió un valor", description: t }));
        } catch (e: any) { toast.error({ title: "No se pudo guardar", description: e?.message }); }
        finally { setGuardando(false); }
    };

    return (
        <Bloque titulo="Aciertos" icono={SlidersHorizontal} extra={cambio ? <span className="text-[11px] font-semibold tono-aviso">sin guardar</span> : undefined}>
            <Regla misma={a.misma} parecida={a.parecida} />

            <Perilla rotulo="Misma persona" valor={a.misma} texto={pct(a.misma)} min={LIMITES_ROSTROS.misma.min} max={LIMITES_ROSTROS.misma.max} paso={0.01} deshabilitada={!puedeCambiar}
                alCambiar={(v) => poner("misma", v)} defecto={estado.porDefecto.misma}
                ayuda={<>De acá para arriba la pasada <b className="font-semibold text-foreground">se suma sola</b> a esa cara. Más alto: menos confusiones, pero una misma persona puede quedar partida en dos.</>} />
            <Perilla rotulo="Se parece" valor={a.parecida} texto={pct(a.parecida)} min={LIMITES_ROSTROS.parecida.min} max={LIMITES_ROSTROS.parecida.max} paso={0.01} deshabilitada={!puedeCambiar}
                alCambiar={(v) => poner("parecida", v)} defecto={estado.porDefecto.parecida}
                ayuda={<>Entre éste y el de arriba nace una cara nueva con la <b className="font-semibold text-foreground">sugerencia de unirla</b>: alguien decide. Por debajo, es otra persona y no se pregunta.</>} />
            <Perilla rotulo="Padrón enrolado a mano" valor={a.padron} texto={pct(a.padron)} min={LIMITES_ROSTROS.padron.min} max={LIMITES_ROSTROS.padron.max} paso={0.01} deshabilitada={!puedeCambiar}
                alCambiar={(v) => poner("padron", v)} defecto={estado.porDefecto.padron}
                ayuda={<>Para reconocer a quien se enroló con su foto desde Usuarios. Va más alto porque de eso sale un acceso <b className="font-semibold text-foreground">a nombre de una persona</b>.</>} />

            <div className="h-px bg-border" />

            <Perilla rotulo="Cara mínima" valor={a.pxMin} texto={`${a.pxMin} px`} min={LIMITES_ROSTROS.pxMin.min} max={240} paso={2} deshabilitada={!puedeCambiar}
                alCambiar={(v) => poner("pxMin", v)} defecto={estado.porDefecto.pxMin}
                ayuda={<>Alto de la cara para darle identidad. Con caras más chicas el motor <b className="font-semibold text-foreground">confunde personas distintas</b>: bajar esto llena la lista de caras mal unidas.</>} />
            <Perilla rotulo="Olvidar a quien no se registró" valor={a.anonimosDias} texto={a.anonimosDias === 1 ? "1 día" : `${a.anonimosDias} días`} min={LIMITES_ROSTROS.anonimosDias.min} max={180} paso={1} deshabilitada={!puedeCambiar}
                alCambiar={(v) => poner("anonimosDias", v)} defecto={estado.porDefecto.anonimosDias}
                ayuda={<>Días sin verla tras los que se borra una cara sin nombre, con su foto y sus pasadas. Las registradas no se olvidan.</>} />

            {puedeCambiar && (
                <div className="flex items-center gap-2 pt-1">
                    <Button onClick={guardar} disabled={!cambio || guardando} className="gap-1.5 flex-1">{guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Guardar</Button>
                    {cambio ? <Button variant="outline" onClick={() => setA({ misma: estado.misma, parecida: estado.parecida, padron: estado.padron, pxMin: estado.pxMin, anonimosDias: estado.anonimosDias })} disabled={guardando}>Deshacer</Button>
                        : !deFabrica ? <Button variant="outline" onClick={() => setA({ ...estado.porDefecto })} className="gap-1.5" title="Los valores con que se midió el 13/11"><RotateCcw size={13} /> Los medidos</Button> : null}
                </div>
            )}
        </Bloque>
    );
}

/** Los dos umbrales sobre una misma regla, con lo que pasa en cada tramo. */
function Regla({ misma, parecida }: { misma: number; parecida: number }) {
    // La regla va de 30 % a 100 %: por debajo no se puede poner ningún umbral.
    const x = (v: number) => `${((Math.min(1, Math.max(0.3, v)) - 0.3) / 0.7) * 100}%`;
    return (
        <div>
            <div className="relative h-2.5 rounded-full overflow-hidden bg-muted" role="img" aria-label={`Otra persona hasta ${pct(parecida)}, se parece hasta ${pct(misma)}, misma persona desde ${pct(misma)}`}>
                <span className="absolute inset-y-0 pleno-aviso transition-[left,width] duration-150" style={{ left: x(parecida), width: `calc(${x(misma)} - ${x(parecida)})` }} />
                <span className="absolute inset-y-0 right-0 pleno-bien transition-[left] duration-150" style={{ left: x(misma) }} />
            </div>
            <div className="mt-1.5 grid grid-cols-3 text-[10.5px] leading-tight text-muted-foreground">
                <span>Otra persona<br /><b className="font-semibold text-foreground/80">nace sola</b></span>
                <span className="text-center">Se parece<br /><b className="font-semibold tono-aviso">sugiere unir</b></span>
                <span className="text-right">Misma<br /><b className="font-semibold tono-bien">se suma sola</b></span>
            </div>
        </div>
    );
}

function Perilla({ rotulo, valor, texto, min, max, paso, alCambiar, ayuda, defecto, deshabilitada }: {
    rotulo: string; valor: number; texto: string; min: number; max: number; paso: number; alCambiar: (v: number) => void; ayuda: React.ReactNode; defecto: number; deshabilitada?: boolean;
}) {
    return (
        <label className="block">
            <span className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold">{rotulo}</span>
                <span className="text-[15px] font-bold tabular-nums leading-none">{texto}</span>
            </span>
            <input type="range" min={min} max={max} step={paso} value={valor} disabled={deshabilitada} onChange={(e) => alCambiar(Number(e.target.value))}
                className="mt-1.5 block w-full h-5 cursor-pointer disabled:cursor-default [accent-color:var(--accion)]" />
            <span className="block text-[11.5px] text-muted-foreground leading-snug">{ayuda}{valor !== defecto && <> <span className="whitespace-nowrap text-foreground/60">Medido: {paso < 1 ? pct(defecto) : defecto}.</span></>}</span>
        </label>
    );
}

export type CamaraFacial = { id: string; name: string; tipo: string; facial: boolean };

/**
 * Qué cámaras miran caras: una lista con interruptores, las elegidas primero. Debajo de cada una,
 * lo que dio en la última semana (13/11: había 17 elegidas y casi todas entregaban caras de 16 a
 * 33 px, que no alcanzan nunca: se elegía a ciegas). Con eso a la vista se sabe cuál apagar.
 */
export function PropiedadesCamaras({ camaras, alCambiar, puedeCambiar, uso, pxMin }: {
    camaras: CamaraFacial[] | null; alCambiar: (ids: string[]) => Promise<void>; puedeCambiar: boolean;
    /** Lo que dio cada cámara (por id) y el mínimo vigente, para decir si sus caras alcanzan. */
    uso?: UsoCamaraRostros[] | null; pxMin?: number;
}) {
    const [q, setQ] = useState("");
    const [ocupada, setOcupada] = useState<string | null>(null);
    const elegidas = useMemo(() => (camaras || []).filter((c) => c.facial), [camaras]);
    const visibles = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (camaras || []).filter((c) => !t || c.name.toLowerCase().includes(t)).sort((a, b) => Number(b.facial) - Number(a.facial) || a.name.localeCompare(b.name, "es", { numeric: true }));
    }, [camaras, q]);
    const usoDe = useMemo(() => new Map((uso || []).map((u) => [u.deviceId, u])), [uso]);
    const chicas = elegidas.filter((c) => veredictoCamara(usoDe.get(c.id), pxMin || 80)?.tono === "aviso").length;
    const alternar = async (c: CamaraFacial) => {
        setOcupada(c.id);
        try { await alCambiar(c.facial ? elegidas.filter((x) => x.id !== c.id).map((x) => x.id) : [...elegidas.map((x) => x.id), c.id]); }
        catch (e: any) { toast.error({ title: "No se pudo cambiar", description: e?.message }); }
        finally { setOcupada(null); }
    };
    return (
        <Bloque titulo="Cámaras que miran caras" icono={Video} extra={camaras ? <span className="text-[11.5px] font-semibold tabular-nums text-muted-foreground">{elegidas.length} de {camaras.length}</span> : undefined}>
            <p className="text-[11.5px] text-muted-foreground leading-snug -mt-1">Sirven las que ven a la gente de frente y cerca (un portero, un acceso). En una cámara de escena la cara queda chica y no alcanza.</p>
            {!camaras ? <p className="text-[12.5px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Leyendo las cámaras…</p> : (
                <>
                    {camaras.length > 8 && (
                        <label className="relative block">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar una cámara" className="h-[34px] w-full rounded-md border border-border bg-background pl-8 pr-3 text-[12.5px] outline-none focus:border-[var(--accion)]" />
                        </label>
                    )}
                    {chicas > 0 && (
                        <p className="rounded-[10px] border chip-aviso px-3 py-2 text-[12px] leading-snug"><span className="text-foreground">{chicas === 1 ? "Una cámara elegida entrega" : `${chicas} cámaras elegidas entregan`} caras que nunca alcanzan: conviene apagarlas acá, o acercarlas.</span></p>
                    )}
                    <div className="max-h-[340px] overflow-y-auto -mx-1.5 px-1.5 divide-y divide-border/60">
                        {visibles.length === 0 && <p className="py-4 text-[12.5px] text-muted-foreground text-center">Ninguna cámara con ese nombre.</p>}
                        {visibles.map((c) => { const v = veredictoCamara(usoDe.get(c.id), pxMin || 80); return (
                            <label key={c.id} className={cn("flex items-center gap-2.5 min-h-10 py-1.5 cursor-pointer", !puedeCambiar && "cursor-default")}>
                                <span className="min-w-0 flex-1">
                                    <span className={cn("block truncate text-[12.5px] leading-tight", c.facial ? "font-semibold" : "text-foreground/80")}>{c.name}</span>
                                    {v && <span className={cn("block truncate text-[11px] leading-tight mt-0.5 tabular-nums", v.tono === "aviso" ? "tono-aviso" : v.tono === "bien" ? "tono-bien" : "text-muted-foreground")} title={`Últimos ${USO_CAMARAS_DIAS} días`}>{v.texto}</span>}
                                </span>
                                {ocupada === c.id && <Loader2 size={12} className="animate-spin text-muted-foreground shrink-0" />}
                                <Switch checked={c.facial} disabled={!puedeCambiar || !!ocupada} onCheckedChange={() => alternar(c)} aria-label={`${c.name}: mirar caras`} />
                            </label>
                        ); })}
                    </div>
                </>
            )}
        </Bloque>
    );
}

/** El motor por dentro: lo que tiene enrolado contra lo que la base conoce. */
export function PropiedadesMotor({ motor, gpu, alLimpiar, puedeCambiar }: {
    motor: { conectado: boolean; error: string | null; enMotor: number; identidades: number; delPadron: number; huerfanos: number; sinMotor: number } | null;
    gpu: string | null;
    alLimpiar: () => Promise<void>; puedeCambiar: boolean;
}) {
    const [limpiando, setLimpiando] = useState(false);
    return (
        <Bloque titulo="El motor" icono={SlidersHorizontal} sinIcono>
            {!motor ? <p className="text-[12.5px] text-muted-foreground inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Preguntándole al motor…</p> : (
                <dl className="space-y-2 text-[12.5px]">
                    <Renglon k="Estado" v={motor.conectado ? <span className="font-semibold tono-bien">Conectado</span> : <span className="font-semibold tono-mal">{motor.error || "Sin conexión"}</span>} />
                    {gpu && <Renglon k="GPU" v={<span className="tabular-nums">{gpu}</span>} />}
                    {motor.conectado && <Renglon k="Caras enroladas" v={<span className="tabular-nums">{motor.enMotor}{motor.delPadron > 0 ? ` · ${motor.delPadron} a mano desde Usuarios` : ""}</span>} />}
                    {motor.sinMotor > 0 && <Renglon k="Sin modelo" v={<span className="tono-aviso font-semibold" title="Tienen ficha pero el motor ya no las tiene: no las va a reconocer. Olvidalas, o subí de nuevo su foto.">{motor.sinMotor} con ficha y sin motor</span>} />}
                </dl>
            )}
            {motor && motor.huerfanos > 0 && (
                <div className="rounded-[10px] border chip-aviso p-3 text-[12px] leading-snug">
                    <p className="text-foreground">El motor todavía reconoce {motor.huerfanos === 1 ? "una cara" : `${motor.huerfanos} caras`} que acá ya se {motor.huerfanos === 1 ? "olvidó" : "olvidaron"}.</p>
                    {puedeCambiar && (
                        <Button size="sm" variant="outline" disabled={limpiando} onClick={async () => { setLimpiando(true); try { await alLimpiar(); } finally { setLimpiando(false); } }} className="mt-2 gap-1.5">
                            {limpiando ? <Loader2 size={13} className="animate-spin" /> : <Eraser size={13} />} Sacarlas del motor
                        </Button>
                    )}
                </div>
            )}
        </Bloque>
    );
}

function Renglon({ k, v }: { k: string; v: React.ReactNode }) {
    return <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground shrink-0">{k}</dt><dd className="min-w-0 text-right">{v}</dd></div>;
}

function Bloque({ titulo, icono: Icono, extra, children, sinIcono }: { titulo: string; icono: React.ComponentType<{ size?: number; className?: string }>; extra?: React.ReactNode; children: React.ReactNode; sinIcono?: boolean }) {
    return (
        <section className="rounded-[10px] border border-border bg-card">
            <header className="flex items-center gap-2 px-4 h-11 border-b border-border">
                {!sinIcono && <Icono size={14} className="text-muted-foreground" />}
                <h3 className="text-[13px] font-bold">{titulo}</h3>
                <span className="ml-auto">{extra}</span>
            </header>
            <div className="p-4 space-y-4">{children}</div>
        </section>
    );
}
