"use client";

import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "react-tooltip";
import { ShieldCheck, Users, Cpu, Type, Loader2, Save, Home, Car, Radar, HardDrive, AlertTriangle } from "lucide-react";
import { Cajon, CajonContenido } from "@/components/ui/cajon";
import { Button } from "@/components/ui/button";
import { Campo, Bloque, Heroe, chipHeroe, ListaElegible } from "@/components/ui/cajon-campos";
import { getAccessGroupDetail, saveAccessGroup } from "@/app/actions/groups";
import { getUsers } from "@/app/actions/users";
import { getDevices } from "@/app/actions/devices";
import { cn } from "@/lib/utils";
import { sileo as toast } from "sileo";

/**
 * Grupo de acceso en un cajón: nombre, quiénes lo integran y por qué equipos pasan.
 * Un grupo une PERSONAS con EQUIPOS: una persona del grupo pasa por las cámaras/lectoras del
 * grupo. Sin equipos, el grupo no habilita nada; sin personas, no deja pasar a nadie.
 */
const TT = "tt-grupo";
const ICONO: Record<string, { I: any; c: string; t: string }> = {
    LPR_CAMERA: { I: Car, c: "text-amber-500", t: "LPR" }, CAMERA: { I: Radar, c: "text-red-500", t: "Intrusión" }, NVR: { I: HardDrive, c: "text-sky-500", t: "NVR" },
};

export function CajonGrupoAcceso({ open, onOpenChange, grupoId, onListo }: { open: boolean; onOpenChange: (v: boolean) => void; grupoId?: string | null; onListo: () => void }) {
    const esNuevo = !grupoId;
    const [nombre, setNombre] = useState("");
    const [usuarios, setUsuarios] = useState<any[]>([]);
    const [equipos, setEquipos] = useState<any[]>([]);
    const [selU, setSelU] = useState<Set<string>>(new Set());
    const [selD, setSelD] = useState<Set<string>>(new Set());
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [inicial, setInicial] = useState<{ u: number; d: number }>({ u: 0, d: 0 });

    useEffect(() => {
        if (!open) return;
        setCargando(true);
        Promise.all([getUsers(), getDevices(), grupoId ? getAccessGroupDetail(grupoId) : Promise.resolve(null)])
            .then(([u, d, g]: any) => {
                setUsuarios((u || []).filter((x: any) => x).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name))));
                setEquipos((d || []).filter((x: any) => x.deviceType !== "NVR").sort((a: any, b: any) => String(a.deviceType).localeCompare(String(b.deviceType)) || String(a.name).localeCompare(String(b.name))));
                setNombre(g?.name || ""); setSelU(new Set(g?.userIds || [])); setSelD(new Set(g?.deviceIds || []));
                setInicial({ u: g?.userIds?.length || 0, d: g?.deviceIds?.length || 0 });
            })
            .catch((e) => toast.error({ title: "No se pudo cargar", description: e?.message }))
            .finally(() => setCargando(false));
    }, [open, grupoId]);

    const lprElegidas = useMemo(() => equipos.filter((d) => selD.has(d.id) && d.deviceType === "LPR_CAMERA").length, [equipos, selD]);

    const guardar = async () => {
        if (!nombre.trim()) { toast.error({ title: "Falta el nombre del grupo" }); return; }
        setGuardando(true);
        try {
            const r: any = await saveAccessGroup({ id: grupoId || null, name: nombre, userIds: [...selU], deviceIds: [...selD] });
            if (!r?.success) { toast.error({ title: "No se pudo guardar", description: r?.error }); return; }
            toast.success({ title: esNuevo ? "Grupo creado" : "Grupo guardado", description: `${selU.size} personas · ${selD.size} equipos` });
            onOpenChange(false); onListo();
        } finally { setGuardando(false); }
    };

    return (
        <Cajon open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
            <CajonContenido ancho="intermedio" tituloOculto titulo={esNuevo ? "Nuevo grupo de acceso" : `Grupo ${nombre}`} descripcion="Quiénes pasan y por qué equipos"
                pie={<div className="flex items-center gap-2 w-full">
                    <span className="flex-1 text-[12px] text-muted-foreground truncate">{!esNuevo && (selU.size !== inicial.u || selD.size !== inicial.d) ? "Después de guardar, sincronizá las matrículas a las cámaras." : ""}</span>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || cargando} className="gap-1.5">{guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {esNuevo ? "Crear grupo" : "Guardar"}</Button>
                </div>}>
                <Heroe titulo={nombre || (esNuevo ? "Nuevo grupo de acceso" : "Grupo")} subtitulo="Personas del grupo × equipos del grupo = quién pasa por dónde"
                    fondo="bg-[radial-gradient(120%_120%_at_0%_0%,#3b0764_0%,#1e1035_55%,#000_100%)]"
                    chips={<><span className={chipHeroe}><Users size={11} /> {selU.size} personas</span><span className={chipHeroe}><Cpu size={11} /> {selD.size} equipos</span>{lprElegidas > 0 && <span className={chipHeroe}><Car size={11} /> {lprElegidas} LPR</span>}</>}>
                    <div className="flex items-center gap-3 mt-1">
                        <span className="h-12 w-12 rounded-xl bg-purple-500/25 ring-1 ring-white/15 grid place-items-center"><ShieldCheck size={24} className="text-purple-200" /></span>
                        <div className="flex-1 grid grid-cols-2 gap-2">
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.14em] text-white/60">Personas</div><div className="text-[22px] font-black tabular-nums">{selU.size}</div></div>
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.14em] text-white/60">Equipos</div><div className="text-[22px] font-black tabular-nums">{selD.size}</div></div>
                        </div>
                    </div>
                </Heroe>

                {cargando ? (
                    <div className="py-16 grid place-items-center text-muted-foreground text-[13px] gap-2"><Loader2 size={22} className="animate-spin" /> Cargando…</div>
                ) : (<>
                    <Bloque titulo="Grupo" icono={ShieldCheck} tt={TT}>
                        <Campo etiqueta="Nombre" icono={Type} value={nombre} onChange={setNombre} placeholder="Residentes, Proveedores, Personal de obra…" autoFocus={esNuevo} tt={TT}
                            ayuda="Cómo se llama el grupo. Ej.: «Residentes», «Proveedores con horario», «Personal Club House»." />
                        {(selU.size === 0 || selD.size === 0) && (
                            <p className="text-[12px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                {selD.size === 0 ? "Sin equipos el grupo no habilita ningún acceso." : "Sin personas el grupo no deja pasar a nadie."}</p>
                        )}
                    </Bloque>
                    <Bloque titulo="Personas" icono={Users} tt={TT} ayuda="Quiénes integran el grupo. Pasan por los equipos del grupo con sus matrículas y tags.">
                        <ListaElegible items={usuarios} elegidos={selU} onCambiar={setSelU} placeholder="Buscar por nombre o lote. Ej.: Pérez, G18"
                            buscar={(u: any) => `${u.name} ${u.unit?.name || ""} ${u.phone || ""}`}
                            render={(u: any) => (
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="text-[13px] font-semibold truncate">{u.name}</span>
                                    {u.unit?.name && <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1 shrink-0"><Home size={10} /> {u.unit.name}</span>}
                                </span>
                            )} />
                    </Bloque>
                    <Bloque titulo="Equipos" icono={Cpu} tt={TT} ayuda="Por dónde pasa el grupo: cámaras LPR de las garitas, lectoras, terminales.">
                        <ListaElegible items={equipos} elegidos={selD} onCambiar={setSelD} placeholder="Buscar equipo o IP. Ej.: P1, Entrada, 172.16.2.207" alto="max-h-64"
                            buscar={(d: any) => `${d.name} ${d.ip} ${d.location || ""}`}
                            render={(d: any) => {
                                const m = ICONO[d.deviceType] || { I: Cpu, c: "text-muted-foreground", t: d.deviceType };
                                return (
                                    <span className="flex items-center gap-2 min-w-0">
                                        <m.I size={14} className={cn("shrink-0", m.c)} />
                                        <span className="text-[13px] font-semibold truncate">{d.name}</span>
                                        {d.deviceType === "LPR_CAMERA" && d.direction && <span className={cn("text-[9.5px] font-bold px-1 rounded", d.direction === "EXIT" ? "bg-orange-500/15 text-orange-500" : "bg-emerald-500/15 text-emerald-500")}>{d.direction === "EXIT" ? "SAL" : "ENT"}</span>}
                                        <span className="ml-auto text-[11px] font-mono text-muted-foreground shrink-0">{d.ip}</span>
                                    </span>
                                );
                            }} />
                    </Bloque>
                </>)}
                <Tooltip id={TT} place="top" className="!max-w-[280px] !text-[12px] !rounded-lg !z-[9999]" />
            </CajonContenido>
        </Cajon>
    );
}
