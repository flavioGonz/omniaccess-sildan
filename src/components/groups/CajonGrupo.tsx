"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Camera, Check, DoorOpen, Info, KeyRound, Loader2, Navigation, ScanFace, ShieldCheck, Users } from "lucide-react";
import { toast } from "@/lib/avisos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Seek } from "@/components/ui/search";
import { Pista } from "@/components/ui/pista";
import { Cajon, CajonCampo, CajonContenido, CajonSeccion } from "@/components/ui/cajon";
import { Cargando, ErrorEstado } from "@/components/ui/estados";
import { datosParaGrupo, getGrupo, guardarGrupo } from "@/app/actions/groups";
import { cn } from "@/lib/utils";

/**
 * El cajón de un grupo de acceso: crearlo y editarlo en el mismo lugar.
 *
 * Antes era un diálogo con un solo campo, el nombre, y nada más: el grupo nacía vacío y no
 * había ninguna pantalla donde ponerle equipos ni gente. La ficha de un equipo decía "los
 * grupos se cambian en Grupos de Acceso" y en Grupos de Acceso no se podía. Ahora el grupo
 * se arma entero acá, en tres bloques: cómo se llama, qué abre, quiénes lo tienen.
 *
 * Lo que NO tiene, a propósito: horarios. El modelo tiene una tabla de horarios por grupo,
 * pero nada la lee — ni la sincronización con los equipos ni la decisión de la barrera.
 * Ofrecer un selector de horario sería prometer algo que no pasa. Se dice abajo, en
 * "Cómo se usa".
 */

type Equipo = { id: string; name: string; deviceType: string; direction: string | null; location: string | null };
type Persona = { id: string; name: string; role: string; unidad: string | null };

/** Cómo se nombra y se dibuja cada tipo de equipo que puede estar en un grupo. */
const TIPO: Record<string, { nombre: string; icono: React.ComponentType<{ size?: number; className?: string }> }> = {
    LPR_CAMERA: { nombre: "Lectora de matrículas", icono: Camera },
    LPR_INTERIOR: { nombre: "Cámara interior", icono: Navigation },
    FACE_TERMINAL: { nombre: "Terminal facial", icono: ScanFace },
    ACCESS_CONTROL: { nombre: "Control de acceso", icono: KeyRound },
    DOOR_INTERCOM: { nombre: "Portero", icono: BellRing },
};

const ROL: Record<string, string> = {
    RESIDENT: "Residente", VISITOR: "Visita", STAFF: "Personal", ADMIN: "Administrador", PROVIDER: "Proveedor",
    TEMPORARY_VISITOR: "Visita temporal", BLACKLISTED: "Lista negra", WHITELISTED: "Lista blanca",
    SECURITY: "Seguridad", OPERATOR: "Operador",
};

/** Cuántas personas se dibujan a la vez. Con un padrón de miles, el resto se encuentra buscando. */
const PERSONAS_VISIBLES = 80;

export function CajonGrupo({ abierto, grupoId, alCerrar, alGuardar }: {
    abierto: boolean;
    /** null = grupo nuevo. */
    grupoId: string | null;
    alCerrar: () => void;
    alGuardar: () => void;
}) {
    const [datos, setDatos] = useState<{ equipos: Equipo[]; personas: Persona[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(false);

    const [nombre, setNombre] = useState("");
    const [equipos, setEquipos] = useState<string[]>([]);
    const [personas, setPersonas] = useState<string[]>([]);
    const [buscar, setBuscar] = useState("");
    const [soloElegidas, setSoloElegidas] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [fallo, setFallo] = useState<string | null>(null);

    const cargar = async () => {
        setCargando(true); setError(null);
        try {
            const [d, g] = await Promise.all([datosParaGrupo(), grupoId ? getGrupo(grupoId) : Promise.resolve(null)]);
            setDatos(d as any);
            if (grupoId && !g) { setError("Ese grupo ya no existe."); return; }
            setNombre(g?.name || "");
            setEquipos(g?.equipos || []);
            setPersonas(g?.personas || []);
            setSoloElegidas(!!g && (g.personas.length > 0));
        } catch (e: any) {
            setError(e?.message || "No se pudieron traer los datos del grupo.");
        } finally { setCargando(false); }
    };

    useEffect(() => {
        if (!abierto) return;
        setBuscar(""); setFallo(null);
        cargar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto, grupoId]);

    const alternar = (lista: string[], set: (v: string[]) => void, id: string) =>
        set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

    const porTipo = useMemo(() => {
        const m = new Map<string, Equipo[]>();
        for (const e of datos?.equipos || []) m.set(e.deviceType, [...(m.get(e.deviceType) || []), e]);
        return [...m.entries()];
    }, [datos]);

    const filtradas = useMemo(() => {
        const q = buscar.trim().toLowerCase();
        return (datos?.personas || []).filter((p) =>
            (!soloElegidas || personas.includes(p.id))
            && (!q || p.name.toLowerCase().includes(q) || (p.unidad || "").toLowerCase().includes(q)));
    }, [datos, buscar, soloElegidas, personas]);

    const guardar = async () => {
        setGuardando(true); setFallo(null);
        const r = await guardarGrupo({ id: grupoId, name: nombre, equipos, personas });
        setGuardando(false);
        if (!r.ok) { setFallo(r.error); return; }
        toast.success(grupoId ? "Grupo guardado" : "Grupo creado", { description: `${nombre.trim()} · ${equipos.length} equipo${equipos.length === 1 ? "" : "s"} · ${personas.length} persona${personas.length === 1 ? "" : "s"}` });
        alGuardar();
        alCerrar();
    };

    const listo = !!datos && !cargando && !error;

    return (
        <Cajon open={abierto} onOpenChange={(o) => { if (!o && !guardando) alCerrar(); }}>
            <CajonContenido ancho="intermedio"
                titulo={grupoId ? (nombre || "Grupo de acceso") : "Nuevo grupo de acceso"}
                descripcion="Un grupo junta a la gente que puede pasar por los mismos equipos."
                pie={
                    <>
                        {fallo && <span className="mr-auto text-[12px] tono-mal max-w-[60%] leading-snug">{fallo}</span>}
                        <Button variant="ghost" onClick={alCerrar} disabled={guardando}
                            className="h-9 px-4 rounded-md text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                            Cancelar
                        </Button>
                        <Button onClick={guardar} disabled={!listo || guardando || !nombre.trim()}
                            className="accion h-9 px-4 rounded-md text-[13px] font-semibold gap-1.5">
                            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            {grupoId ? "Guardar" : "Crear grupo"}
                        </Button>
                    </>
                }>

                {cargando && <Cargando texto="Trayendo equipos y personas…" className="py-16" />}
                {error && <ErrorEstado mensaje={error} alReintentar={cargar} className="py-16" />}

                {listo && (
                    <>
                        {/* ── 1. Cómo se llama ── */}
                        <CajonSeccion titulo="Identidad" icono={ShieldCheck}>
                            <CajonCampo etiqueta="Nombre del grupo"
                                ayuda="Conviene que diga a quiénes junta, no qué abre: las puertas cambian más seguido que la gente."
                                pista={<>Es lo que se ve en la ficha de cada persona al elegirle grupos. Ejemplos que funcionan: <b>Residentes</b>, <b>Personal de obra</b>, <b>Proveedores de mañana</b>. Uno que envejece mal: <b>Portón 2</b>.</>}>
                                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={!grupoId}
                                    maxLength={60} placeholder="Ej: Residentes" className="h-10" />
                            </CajonCampo>
                        </CajonSeccion>

                        {/* ── 2. Qué abre ── */}
                        <CajonSeccion titulo="Qué equipos abre" icono={DoorOpen}
                            pista="Los equipos donde este grupo tiene permiso. Sólo se ofrecen los que deciden si alguien pasa (lectoras, terminales, controladoras, porteros): una cámara común o un grabador no abren nada.">
                            {!datos!.equipos.length ? (
                                <p className="text-[12.5px] text-muted-foreground">No hay equipos que abran cargados en el sistema.</p>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] text-muted-foreground tabular-nums">{equipos.length} de {datos!.equipos.length} elegidos</span>
                                        <div className="flex gap-1">
                                            <button type="button" onClick={() => setEquipos(datos!.equipos.map((e) => e.id))}
                                                className="px-2 h-7 rounded-md text-[12px] font-semibold tono-accion hover:bg-accent">Todos</button>
                                            <button type="button" onClick={() => setEquipos([])}
                                                className="px-2 h-7 rounded-md text-[12px] font-semibold text-muted-foreground hover:bg-accent">Ninguno</button>
                                        </div>
                                    </div>
                                    {porTipo.map(([tipo, lista]) => {
                                        const T = TIPO[tipo] || { nombre: tipo, icono: DoorOpen };
                                        return (
                                            <div key={tipo}>
                                                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground mb-1.5">
                                                    <T.icono size={12.5} /> {T.nombre}
                                                </p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                    {lista.map((e) => {
                                                        const puesto = equipos.includes(e.id);
                                                        return (
                                                            <button key={e.id} type="button" onClick={() => alternar(equipos, setEquipos, e.id)}
                                                                aria-pressed={puesto}
                                                                className={cn("flex items-center gap-2.5 px-3 py-2 rounded-md border text-left transition-colors",
                                                                    puesto ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                                                <span className={cn("w-4 h-4 shrink-0 rounded border flex items-center justify-center",
                                                                    puesto ? "bg-[var(--accion)] border-[var(--accion)] text-[var(--accion-texto)]" : "border-border")}>
                                                                    {puesto && <Check size={11} />}
                                                                </span>
                                                                <span className="min-w-0">
                                                                    <span className="block text-[12.5px] font-semibold text-foreground truncate">{e.name}</span>
                                                                    <span className="block text-[11px] text-muted-foreground truncate">
                                                                        {[e.direction === "EXIT" ? "Salida" : e.direction === "ENTRY" ? "Entrada" : null, e.location].filter(Boolean).join(" · ") || "—"}
                                                                    </span>
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </>
                            )}
                        </CajonSeccion>

                        {/* ── 3. Quiénes ── */}
                        <CajonSeccion titulo="Quiénes lo tienen" icono={Users}
                            pista="Las personas con este permiso. Es lo mismo que elegir el grupo en la ficha de cada persona: cambiarlo acá cambia la ficha y al revés. Sacar a alguien del grupo no borra a la persona.">
                            <div className="flex items-center gap-2">
                                <Seek value={buscar} onChange={setBuscar} placeholder="Nombre o lote" startOpen width={260} alto={34} />
                                <Pista texto="Muestra sólo a quienes ya están en el grupo, para revisar o sacar a alguien.">
                                    <button type="button" onClick={() => setSoloElegidas((v) => !v)} aria-pressed={soloElegidas}
                                        className={cn("h-8 px-3 rounded-full border text-[12px] font-semibold transition-colors tabular-nums",
                                            soloElegidas ? "border-[var(--accion)] tono-accion bg-[color-mix(in_oklab,var(--accion)_10%,transparent)]" : "border-border text-muted-foreground hover:bg-accent")}>
                                        En el grupo · {personas.length}
                                    </button>
                                </Pista>
                            </div>
                            <div className="rounded-[10px] border border-border divide-y divide-border max-h-[340px] overflow-y-auto">
                                {filtradas.slice(0, PERSONAS_VISIBLES).map((p) => {
                                    const puesta = personas.includes(p.id);
                                    return (
                                        <button key={p.id} type="button" onClick={() => alternar(personas, setPersonas, p.id)} aria-pressed={puesta}
                                            className={cn("w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                                                puesta ? "bg-[color-mix(in_oklab,var(--accion)_6%,transparent)]" : "hover:bg-accent")}>
                                            <span className={cn("w-4 h-4 shrink-0 rounded border flex items-center justify-center",
                                                puesta ? "bg-[var(--accion)] border-[var(--accion)] text-[var(--accion-texto)]" : "border-border")}>
                                                {puesta && <Check size={11} />}
                                            </span>
                                            <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-foreground truncate">{p.name}</span>
                                            <span className="shrink-0 text-[11px] text-muted-foreground">{[p.unidad, ROL[p.role] || p.role].filter(Boolean).join(" · ")}</span>
                                        </button>
                                    );
                                })}
                                {!filtradas.length && (
                                    <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                                        {soloElegidas && !buscar ? "Todavía no hay nadie en este grupo." : "Nadie coincide con la búsqueda."}
                                    </p>
                                )}
                                {filtradas.length > PERSONAS_VISIBLES && (
                                    <p className="px-3 py-2 text-[11.5px] text-muted-foreground tabular-nums">
                                        Y {filtradas.length - PERSONAS_VISIBLES} más: escribí parte del nombre o del lote para encontrarlas.
                                    </p>
                                )}
                            </div>
                        </CajonSeccion>

                        {/* ── 4. Lo que hay que saber ── */}
                        <CajonSeccion titulo="Cómo se usa" icono={Info}>
                            <ul className="space-y-2 text-[12.5px] leading-relaxed text-foreground/85">
                                <li>El grupo dice <b>qué equipos le corresponden a quién</b>. Cargar la credencial en la memoria de cada equipo se hace desde la ficha de la persona, en «A qué equipos se manda».</li>
                                <li>Un grupo vale <b>las 24 horas</b>: todavía no hay horarios por grupo.</li>
                                <li>Borrar un grupo no borra a su gente: pierden este permiso y conservan los demás.</li>
                            </ul>
                        </CajonSeccion>
                    </>
                )}
            </CajonContenido>
        </Cajon>
    );
}
