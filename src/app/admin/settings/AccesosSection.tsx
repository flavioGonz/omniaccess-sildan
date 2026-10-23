"use client";

/**
 * Ajustes › Accesos al panel: los usuarios del sistema y los roles de la aplicación.
 *
 * Antes era "Usuarios del Sistema": una tabla propia dentro de un marco gris, un modal con
 * cuatro campos y un `<select>` con dos opciones fijas (Administrador / Solo lectura). El 7/10
 * pasó a dos pestañas con una grilla de casillas sueltas, una por pantalla.
 *
 * El 23/10 (openspec roles-y-permisos; Nico: «faltan secciones, módulos y que sea más
 * profesional») el rol se edita como una MATRIZ: una fila por sección, agrupadas por módulo
 * (Operación, LPR, Video, Intrusión, Alarm Hub, OmniVision…), y una columna por nivel (Ver,
 * Operar, Configurar). Cada módulo dice si está activo en esta instalación; cada permiso explica
 * qué habilita; los delicados (Accesos, Mantenimiento, enlaces de pantalla, armar y desarmar)
 * llevan su marca. Un rol nuevo puede salir de una plantilla. Cada cambio queda en Auditoría.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Plus, Loader2, Pencil, Trash2, Copy, ShieldCheck, ShieldAlert, KeyRound, User as UserIco, Lock, Camera, Upload, Check, Info, AlertTriangle,
    Eye, Hand, Settings2, LayoutGrid, Car, Video, Radar, RadioTower, ScanEye, ScanFace, Rows3, ShieldHalf, Users, Cpu, SlidersHorizontal, FileStack, Minus,
} from "lucide-react";
import { sileo as toast } from "sileo";
import { cn } from "@/lib/utils";
import { Tabla, type ColumnaTabla } from "@/components/ui/tabla";
import { Identidad, Estado, Momento, Nada } from "@/components/ui/celdas";
import { Filtros } from "@/components/ui/filtros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cajon, CajonContenido, CajonSeccion, CajonCampo } from "@/components/ui/cajon";
import { Pista } from "@/components/ui/pista";
import { ConfirmarAccion } from "@/components/DeleteConfirmDialog";
import { useSessionRole } from "@/hooks/useSessionRole";
import { useFuncion } from "@/lib/funciones-cliente";
import { getEnabledModules } from "@/app/actions/modules";
import {
    PERMISOS, MODULOS, NIVELES, SECCIONES_PERMISOS, PLANTILLAS_ROL, resumirPermisos, esAdministrador, normalizarPermisos, nivelesPorModulo,
    type ModuloId, type Nivel, type Permiso,
} from "@/lib/permisos";
import {
    getUsuariosSistema, saveUsuarioSistema, deleteUsuarioSistema,
    getRolesApp, saveRolApp, duplicarRolApp, deleteRolApp,
    type UsuarioSistema, type RolApp,
} from "@/app/actions/accesos";

const fotoUrl = (cara?: string | null) => (cara ? (cara.startsWith("/") || cara.startsWith("http") ? cara : `/api/files/${cara}`) : null);

/* ─────────────────────────── Módulos ─────────────────────────── */

const ICONO_MODULO: Record<ModuloId, React.ComponentType<{ size?: number; className?: string }>> = {
    operacion: LayoutGrid, lpr: Car, video: Video, intrusion: Radar, hub: RadioTower, vision: ScanEye, rostro: ScanFace,
    filas: Rows3, guardia: ShieldHalf, padron: Users, equipos: Cpu, administracion: SlidersHorizontal,
};
const ICONO_NIVEL: Record<Nivel, React.ComponentType<{ size?: number; className?: string }>> = { ver: Eye, operar: Hand, configurar: Settings2 };

/**
 * Qué módulos están activos en esta instalación (el modo y las funciones). Un módulo apagado se
 * puede asignar igual —la instalación puede prenderlo mañana— pero se ve atenuado y lo dice.
 */
function useModulosActivos(): Record<ModuloId, boolean> | null {
    const [modos, setModos] = useState<Record<string, boolean> | null>(null);
    useEffect(() => { getEnabledModules().then((m) => setModos(m as any)).catch(() => setModos({})); }, []);
    const intrusion = useFuncion("FUNC_INTRUSION"), recepcion = useFuncion("FUNC_ALARMAS_RECEPCION");
    if (!modos) return null;
    return {
        operacion: true, video: true, vision: true, guardia: true, padron: true, equipos: true, administracion: true,
        lpr: !!modos.MODULE_LPR, rostro: !!modos.MODULE_FACE, filas: !!modos.MODULE_QUEUE,
        intrusion: intrusion !== false, hub: recepcion === true,
    };
}

/* ─────────────────────────── La matriz de permisos ─────────────────────────── */

/** Una casilla de la matriz: marcada, desmarcada, o marcada y trabada (la incluye un nivel más alto). */
function Casilla({ p, on, trabada, soloLectura, alTocar }: { p: Permiso; on: boolean; trabada: boolean; soloLectura?: boolean; alTocar: () => void }) {
    const texto = (
        <span className="block">
            {p.descripcion}
            {p.delicado && <span className="mt-1.5 flex items-start gap-1 tono-aviso font-semibold"><ShieldAlert size={12} className="mt-0.5 shrink-0" />{p.delicado}</span>}
            {trabada && <span className="mt-1.5 block text-muted-foreground">Lo incluye un nivel más alto de esta sección.</span>}
            {p.rutas.length > 0 && <span className="mt-1.5 block text-muted-foreground">Abre: {p.rutas.join(", ")}</span>}
        </span>
    );
    return (
        <Pista titulo={p.rotulo} texto={texto} ancho={320} lado="arriba">
            <button type="button" onClick={alTocar} disabled={soloLectura || trabada} aria-pressed={on} aria-label={p.rotulo}
                className={cn("relative h-7 w-7 rounded-[7px] border grid place-items-center transition-colors",
                    on ? (p.delicado ? "bg-[var(--aviso)] border-[var(--aviso)] text-white" : "bg-[var(--accion)] border-[var(--accion)] text-white") : "border-border bg-background hover:border-[var(--accion)]",
                    trabada && "opacity-60", (soloLectura || trabada) && "cursor-default")}>
                {on ? <Check size={14} strokeWidth={3} /> : null}
                {p.delicado && !on && <ShieldAlert size={10} className="absolute -top-1 -right-1 tono-aviso bg-card rounded-full" />}
            </button>
        </Pista>
    );
}

/**
 * La matriz: módulos como cabeceras (con su estado en la instalación y un interruptor para todo el
 * módulo y para cada nivel del módulo), secciones como filas y Ver / Operar / Configurar como
 * columnas. Operar y Configurar arrastran Ver: Ver queda trabado mientras haya uno más alto.
 */
function MatrizPermisos({ valor, onChange, soloLectura }: { valor: string[]; onChange?: (v: string[]) => void; soloLectura?: boolean }) {
    const set = new Set(valor);
    const activos = useModulosActivos();
    const fijar = (claves: string[], prender: boolean) => {
        if (soloLectura || !onChange) return;
        const n = new Set(set);
        claves.forEach((k) => (prender ? n.add(k) : n.delete(k)));
        // Al apagar un Ver que algún nivel alto todavía pide, normalizar lo vuelve a poner: se apagan también los altos de esa sección.
        if (!prender) for (const k of claves) { const p = PERMISOS.find((x) => x.clave === k); if (p?.nivel === "ver") PERMISOS.filter((q) => q.seccion === p.seccion).forEach((q) => n.delete(q.clave)); }
        onChange(normalizarPermisos([...n]));
    };
    return (
        <div className="rounded-[10px] border border-border overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,84px)] items-center bg-muted/50 border-b border-border px-3 h-9 text-[11px] font-semibold text-muted-foreground sticky top-0 z-[1]">
                <span>Sección</span>
                {NIVELES.map((n) => { const I = ICONO_NIVEL[n.id]; return <Pista key={n.id} titulo={n.nombre} texto={n.ayuda}><span className="inline-flex items-center justify-center gap-1"><I size={12} /> {n.nombre}</span></Pista>; })}
            </div>
            {MODULOS.map((m) => {
                const I = ICONO_MODULO[m.id];
                const secciones = SECCIONES_PERMISOS.filter((s) => s.modulo === m.id);
                const del = PERMISOS.filter((p) => p.modulo === m.id);
                const marcados = del.filter((p) => set.has(p.clave)).length;
                const activo = activos ? activos[m.id] : true;
                return (
                    <section key={m.id} className={cn("border-b border-border last:border-0", !activo && "opacity-70")}>
                        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,84px)] items-center px-3 py-2 bg-card">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-muted text-muted-foreground shrink-0"><I size={15} /></span>
                                <Pista titulo={m.nombre} texto={m.descripcion}><span className="text-[13px] font-semibold truncate">{m.nombre}</span></Pista>
                                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{marcados}/{del.length}</span>
                                {!activo && <span className="text-[10.5px] rounded-full border border-border px-1.5 py-px text-muted-foreground shrink-0">apagado en esta instalación</span>}
                                {!soloLectura && (
                                    <button type="button" onClick={() => fijar(del.map((p) => p.clave), marcados < del.length)}
                                        className="ml-1 text-[11px] font-semibold text-[var(--accion)] hover:underline shrink-0">{marcados < del.length ? "Todo el módulo" : "Nada del módulo"}</button>
                                )}
                            </div>
                            {NIVELES.map((n) => {
                                const delNivel = del.filter((p) => p.nivel === n.id);
                                if (!delNivel.length || soloLectura) return <span key={n.id} />;
                                const todos = delNivel.every((p) => set.has(p.clave));
                                return (
                                    <div key={n.id} className="grid place-items-center">
                                        <Pista titulo={`${n.nombre} en todo ${m.nombre}`} texto={todos ? "Apagar este nivel en todas las secciones del módulo." : "Prender este nivel en todas las secciones del módulo."}>
                                            <button type="button" onClick={() => fijar(delNivel.map((p) => p.clave), !todos)} aria-label={`${n.nombre} en todo ${m.nombre}`}
                                                className={cn("h-6 w-6 rounded-full grid place-items-center text-[11px]", todos ? "text-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_14%,transparent)]" : "text-muted-foreground hover:bg-accent")}>
                                                {todos ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
                                            </button>
                                        </Pista>
                                    </div>
                                );
                            })}
                        </div>
                        {secciones.map((s) => {
                            const altos = (["operar", "configurar"] as Nivel[]).some((n) => s.niveles[n] && set.has(s.niveles[n]!.clave));
                            return (
                                <div key={s.seccion} className="grid grid-cols-[minmax(0,1fr)_repeat(3,84px)] items-center px-3 py-1.5 pl-12 border-t border-border/60 hover:bg-muted/30">
                                    <span className="text-[12.5px] truncate">{s.nombre}</span>
                                    {NIVELES.map((n) => {
                                        const p = s.niveles[n.id];
                                        if (!p) return <span key={n.id} className="grid place-items-center text-muted-foreground/40"><Minus size={12} /></span>;
                                        const trabada = n.id === "ver" && altos;
                                        return (
                                            <div key={n.id} className="grid place-items-center">
                                                <Casilla p={p} on={set.has(p.clave)} trabada={trabada} soloLectura={soloLectura} alTocar={() => fijar([p.clave], !set.has(p.clave))} />
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </section>
                );
            })}
        </div>
    );
}

/** El resumen por módulo, en chips: el nivel más alto que tiene en cada uno. Para tablas y la ficha del usuario. */
function ResumenPorModulo({ permisos, max = 12 }: { permisos: string[]; max?: number }) {
    if (esAdministrador(permisos)) return <span className="text-[12px] text-foreground font-semibold">Todo el panel</span>;
    const filas = nivelesPorModulo(permisos).filter((x) => x.nivel);
    if (!filas.length) return <span className="text-[12px] text-muted-foreground">Sin permisos: puede entrar pero no abre nada.</span>;
    return (
        <div className="flex flex-wrap gap-1">
            {filas.slice(0, max).map((x) => {
                const I = ICONO_NIVEL[x.nivel!];
                const nivel = NIVELES.find((n) => n.id === x.nivel)!;
                return (
                    <Pista key={x.modulo.id} titulo={x.modulo.nombre} texto={`${x.cuantos} de ${x.total} permisos · hasta ${nivel.nombre}`}>
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[10.5px] font-semibold">
                            <I size={10} className={x.nivel === "configurar" ? "tono-aviso" : x.nivel === "operar" ? "text-[var(--accion)]" : "text-muted-foreground"} />{x.modulo.nombre}
                        </span>
                    </Pista>
                );
            })}
        </div>
    );
}

/** El encabezado del rol: cuántos permisos, cuántos delicados, cuántos usuarios. */
function ContadorRol({ permisos, usuarios }: { permisos: string[]; usuarios?: number }) {
    const delicados = PERMISOS.filter((p) => p.delicado && permisos.includes(p.clave));
    return (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 h-7 font-semibold tabular-nums"><ShieldCheck size={13} /> {permisos.length} de {PERMISOS.length} permisos</span>
            {delicados.length > 0 && (
                <Pista titulo="Permisos delicados" texto={delicados.map((p) => `${p.rotulo}: ${p.delicado}`).join(" · ")}>
                    <span className="inline-flex items-center gap-1.5 rounded-full chip-aviso border px-2.5 h-7 font-semibold"><ShieldAlert size={13} /> {delicados.length} delicado{delicados.length === 1 ? "" : "s"}</span>
                </Pista>
            )}
            {usuarios != null && <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 h-7 text-muted-foreground tabular-nums"><Users size={13} /> {usuarios} usuario{usuarios === 1 ? "" : "s"}</span>}
        </div>
    );
}

/* ─────────────────────────── Cajón del usuario ─────────────────────────── */

function CajonUsuarioSistema({ usuario, roles, abierto, onOpenChange, onGuardado, soyYo }: {
    usuario: UsuarioSistema | null; roles: RolApp[]; abierto: boolean; onOpenChange: (o: boolean) => void; onGuardado: () => void; soyYo: boolean;
}) {
    const esAlta = !usuario;
    const [f, setF] = useState({ name: "", email: "", phone: "", password: "", appRoleId: "" });
    const [foto, setFoto] = useState<File | null>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => {
        if (!abierto) return;
        setF({ name: usuario?.name || "", email: usuario?.email || "", phone: usuario?.phone || "", password: "", appRoleId: usuario?.appRoleId || roles.find((r) => r.id === "rol-operador")?.id || roles[0]?.id || "" });
        setFoto(null);
    }, [abierto, usuario, roles]);
    const rol = roles.find((r) => r.id === f.appRoleId) || null;
    const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

    const guardar = async () => {
        setGuardando(true);
        try {
            const datos = new FormData();
            if (usuario) datos.append("id", usuario.id);
            datos.append("name", f.name.trim()); datos.append("email", f.email.trim()); datos.append("phone", f.phone.trim());
            datos.append("password", f.password); datos.append("appRoleId", f.appRoleId);
            datos.append("currentPhoto", usuario?.cara || "");
            if (foto) datos.append("photo", foto);
            const r: any = await saveUsuarioSistema(datos);
            if (!r.ok) { toast.error({ title: "No se pudo guardar", description: r.error }); return; }
            toast.success({ title: esAlta ? "Usuario creado" : "Usuario guardado", description: rol ? `Rol ${rol.nombre}. ${usuario ? "Los cambios de rol se aplican cuando vuelva a iniciar sesión." : ""}` : undefined });
            onOpenChange(false); onGuardado();
        } finally { setGuardando(false); }
    };

    const previa = foto ? URL.createObjectURL(foto) : fotoUrl(usuario?.cara);
    return (
        <Cajon open={abierto} onOpenChange={onOpenChange}>
            <CajonContenido ancho="intermedio" titulo={esAlta ? "Nuevo usuario del panel" : usuario!.name}
                descripcion={esAlta ? "Una cuenta para entrar al panel de administración. Lo que puede abrir lo decide su rol." : `${usuario!.rolNombre || "Sin rol"} · creado ${usuario!.createdAt ? new Date(usuario!.createdAt).toLocaleDateString("es-UY") : ""}${usuario!.createdBy ? ` por ${usuario!.createdBy}` : ""}`}
                pie={
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted-foreground">{rol ? resumirPermisos(rol.permisos) : "Elegí un rol"}</span>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="button" onClick={guardar} disabled={guardando || !f.name.trim() || !f.appRoleId || (esAlta && !f.password)}>
                                {guardando ? <Loader2 size={14} className="animate-spin mr-1" /> : null}{esAlta ? "Crear usuario" : "Guardar"}
                            </Button>
                        </div>
                    </div>
                }>
                <CajonSeccion titulo="Quién es" icono={UserIco}>
                    <div className="flex gap-4 items-start">
                        <label className="relative w-20 h-20 rounded-full bg-muted border border-border overflow-hidden cursor-pointer shrink-0 group">
                            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-20 cursor-pointer" onChange={(e) => setFoto(e.target.files?.[0] || null)} />
                            {previa ? <img src={previa} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-0.5"><Camera size={18} /><span className="text-[9px] font-bold uppercase">Foto</span></div>}
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none"><Upload className="text-white" size={18} /></div>
                        </label>
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <CajonCampo etiqueta="Usuario (login)" pista="Con esto entra. Sin espacios; se escribe tal cual en la pantalla de ingreso.">
                                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="ej: jperez" disabled={!esAlta && usuario?.esLider} />
                            </CajonCampo>
                            <CajonCampo etiqueta="Email" ayuda="Opcional">
                                <Input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="usuario@empresa.com" />
                            </CajonCampo>
                            <CajonCampo etiqueta="Teléfono" ayuda="Opcional. Si coincide con el de un residente o personal, el bot de WhatsApp lo reconoce.">
                                <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="099 123 456" />
                            </CajonCampo>
                        </div>
                    </div>
                </CajonSeccion>

                <CajonSeccion titulo="Cómo entra" icono={Lock}>
                    {/* Nadie ve la contraseña de nadie (está cifrada). A uno mismo se le ofrece cambiarla;
                        a otro administrador, resetearla: ponerle una nueva sin conocer la actual. */}
                    <CajonCampo etiqueta={esAlta ? "Contraseña" : soyYo ? "Cambiar mi contraseña" : "Resetear contraseña"}
                        ayuda={esAlta ? "Se guarda cifrada." : soyYo ? "Dejar vacío para no cambiarla. Se guarda cifrada." : "La actual no se puede ver: se guarda cifrada. Escribí una nueva para resetearla y pasásela por un canal seguro; vacío la deja como está."}>
                        <PasswordInput value={f.password} onChange={(e) => set("password", e.target.value)} placeholder={esAlta ? "mínimo 6 caracteres" : "••••••"} />
                    </CajonCampo>
                    {!esAlta && (
                        <p className="mt-2 text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
                            {usuario!.tienePassword ? <><Check size={12} className="text-[var(--bien)]" /> Tiene contraseña cargada.</> : <><AlertTriangle size={12} className="text-[var(--aviso)]" /> No tiene contraseña: no puede entrar hasta que se le ponga una.</>}
                        </p>
                    )}
                </CajonSeccion>

                <CajonSeccion titulo="Qué puede hacer" icono={ShieldCheck}
                    ayuda="El rol decide qué pantallas abre y qué ve en el menú. Los roles se editan en la pestaña Roles.">
                    <CajonCampo etiqueta="Rol de la aplicación">
                        <Select value={f.appRoleId} onValueChange={(v) => set("appRoleId", v)}>
                            <SelectTrigger><SelectValue placeholder="Elegir rol…" /></SelectTrigger>
                            <SelectContent>
                                {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.nombre}{r.esSistema ? " · sistema" : ""} — {resumirPermisos(r.permisos, 2)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </CajonCampo>
                    {soyYo && rol && !rol.permisos.includes("accesos") && (
                        <p className="mt-2 text-[12px] text-[var(--mal)] inline-flex items-center gap-1.5"><AlertTriangle size={12} /> Este rol no incluye «Accesos al panel»: te dejaría afuera de esta pantalla. No se va a guardar.</p>
                    )}
                    {rol && (
                        <div className="mt-3">
                            <p className="text-[12px] text-muted-foreground mb-2">{rol.descripcion || "Sin descripción."}</p>
                            <ContadorRol permisos={rol.permisos} />
                            <div className="mt-3"><ResumenPorModulo permisos={rol.permisos} /></div>
                        </div>
                    )}
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

/* ─────────────────────────── Cajón del rol ─────────────────────────── */

function CajonRol({ rol, abierto, onOpenChange, onGuardado }: { rol: RolApp | null; abierto: boolean; onOpenChange: (o: boolean) => void; onGuardado: () => void }) {
    const esAlta = !rol;
    const [nombre, setNombre] = useState("");
    const [descripcion, setDescripcion] = useState("");
    const [permisos, setPermisos] = useState<string[]>([]);
    const [plantilla, setPlantilla] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (abierto) { setNombre(rol?.nombre || ""); setDescripcion(rol?.descripcion || ""); setPermisos(rol?.permisos || []); setPlantilla(null); } }, [abierto, rol]);
    const esAdminSistema = rol?.id === "rol-administrador";
    const usar = (id: string | null) => {
        setPlantilla(id);
        const t = PLANTILLAS_ROL.find((x) => x.id === id);
        if (!t) { setPermisos([]); return; }
        setPermisos(t.permisos);
        // El nombre y la descripción de la plantilla, salvo que ya se hayan escrito otros.
        setNombre((n) => (!n.trim() || PLANTILLAS_ROL.some((x) => x.nombre === n) ? t.nombre : n));
        setDescripcion((d) => (!d.trim() || PLANTILLAS_ROL.some((x) => x.descripcion === d) ? t.descripcion : d));
    };
    const guardar = async () => {
        setGuardando(true);
        try {
            const r: any = await saveRolApp({ id: rol?.id, nombre, descripcion, permisos });
            if (!r.ok) { toast.error({ title: "No se pudo guardar el rol", description: r.error }); return; }
            toast.success({ title: esAlta ? "Rol creado" : "Rol guardado", description: rol && rol.usuarios > 0 ? `${rol.usuarios} usuario${rol.usuarios === 1 ? "" : "s"} con este rol: los cambios se aplican cuando vuelvan a iniciar sesión.` : undefined });
            onOpenChange(false); onGuardado();
        } finally { setGuardando(false); }
    };
    return (
        <Cajon open={abierto} onOpenChange={onOpenChange}>
            <CajonContenido ancho="ancho" titulo={esAlta ? "Nuevo rol" : rol!.nombre}
                descripcion={esAlta ? "Un conjunto de permisos con nombre, para asignárselo a usuarios del panel. Se puede partir de una plantilla." : `${rol!.usuarios} usuario${rol!.usuarios === 1 ? "" : "s"} con este rol${rol!.esSistema ? " · rol de sistema" : ""}`}
                pie={
                    <div className="flex items-center justify-between gap-3">
                        <ContadorRol permisos={permisos} usuarios={rol?.usuarios} />
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="button" onClick={guardar} disabled={guardando || !nombre.trim() || esAdminSistema}>{guardando ? <Loader2 size={14} className="animate-spin mr-1" /> : null}{esAlta ? "Crear rol" : "Guardar"}</Button>
                        </div>
                    </div>
                }>
                {esAlta && (
                    <CajonSeccion titulo="Partir de una plantilla" icono={FileStack} ayuda="Ninguna incluye Accesos ni Mantenimiento. Después se ajusta en la matriz.">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {[{ id: null as string | null, nombre: "En blanco", descripcion: "Sin ningún permiso: se marca a mano.", permisos: [] as string[] }, ...PLANTILLAS_ROL].map((t) => (
                                <button key={t.id || "blanco"} type="button" onClick={() => usar(t.id)}
                                    className={cn("text-left rounded-[10px] border p-3 transition-colors", plantilla === t.id ? "border-[var(--accion)] bg-[color-mix(in_oklab,var(--accion)_8%,transparent)]" : "border-border hover:bg-accent")}>
                                    <div className="flex items-center gap-2"><span className="text-[13px] font-semibold">{t.nombre}</span><span className="ml-auto text-[11px] text-muted-foreground tabular-nums">{t.permisos.length}</span></div>
                                    <p className="mt-1 text-[11.5px] text-muted-foreground leading-snug line-clamp-3">{t.descripcion}</p>
                                </button>
                            ))}
                        </div>
                    </CajonSeccion>
                )}
                <CajonSeccion titulo="Cómo se llama" icono={KeyRound}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        <CajonCampo etiqueta="Nombre">
                            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej: Guardia de noche" disabled={!!rol?.esSistema} />
                        </CajonCampo>
                        <CajonCampo etiqueta="Para qué es" ayuda="Una frase que diga a quién se le da.">
                            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ej: Mira el monitor y el historial, carga lista negra, no toca padrón." />
                        </CajonCampo>
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Qué puede hacer" icono={ShieldCheck}
                    ayuda={esAdminSistema ? "Administrador tiene siempre todo, también lo que se agregue después: si se le pudiera sacar Accesos al panel, nadie podría volver a esta pantalla." : "Ver abre la pantalla; Operar hace la tarea del día; Configurar cambia cómo funciona. Operar y Configurar incluyen Ver. Pasá el mouse por cada casilla para ver qué habilita."}>
                    <MatrizPermisos valor={permisos} onChange={setPermisos} soloLectura={esAdminSistema} />
                    {esAdministrador(permisos) && !esAdminSistema && (
                        <p className="mt-3 text-[12px] text-muted-foreground inline-flex items-center gap-1.5"><Info size={12} /> Con todos los permisos, este rol equivale a Administrador.</p>
                    )}
                </CajonSeccion>
            </CajonContenido>
        </Cajon>
    );
}

/* ─────────────────────────── La sección ─────────────────────────── */

export default function AccesosSection() {
    const { name: miNombre, tiene, loaded } = useSessionRole();
    const [pestania, setPestania] = useState<"usuarios" | "roles">("usuarios");
    const [usuarios, setUsuarios] = useState<UsuarioSistema[]>([]);
    const [roles, setRoles] = useState<RolApp[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState("");
    const [filtroRol, setFiltroRol] = useState("todos");
    const [cajonUsuario, setCajonUsuario] = useState<{ abierto: boolean; usuario: UsuarioSistema | null }>({ abierto: false, usuario: null });
    const [cajonRol, setCajonRol] = useState<{ abierto: boolean; rol: RolApp | null }>({ abierto: false, rol: null });
    const [aBorrar, setABorrar] = useState<UsuarioSistema | null>(null);
    const [rolABorrar, setRolABorrar] = useState<RolApp | null>(null);

    // Los usuarios y los roles los lee sólo quien tiene Accesos (spec permisos-aplicacion, lecturas delicadas).
    const conAccesos = loaded && tiene("accesos");
    const cargar = useCallback(() => {
        if (!conAccesos) { setCargando(false); return; }
        setCargando(true); setError(null);
        Promise.all([getUsuariosSistema(), getRolesApp()])
            .then(([u, r]) => { setUsuarios(u); setRoles(r); })
            .catch((e) => setError(e?.message || "No se pudo leer"))
            .finally(() => setCargando(false));
    }, [conAccesos]);
    useEffect(() => { if (loaded) cargar(); }, [loaded, cargar]);

    const puedoEditar = !loaded || tiene("accesos");

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return usuarios.filter((u) => (filtroRol === "todos" || u.appRoleId === filtroRol) &&
            (!q || u.name.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.rolNombre || "").toLowerCase().includes(q)));
    }, [usuarios, busqueda, filtroRol]);

    const columnas: ColumnaTabla<UsuarioSistema>[] = [
        {
            clave: "usuario", titulo: "Usuario", ancho: 260, ordenable: true, valor: (u) => u.name,
            celda: (u) => <Identidad foto={fotoUrl(u.cara)} nombre={u.name} sub={u.email || <span className="italic opacity-70">sin email</span>}
                insignia={<span className="inline-flex gap-1">{u.esLider && <Estado tono="aviso">líder</Estado>}{u.name === miNombre && <Estado tono="info">vos</Estado>}</span>} />,
        },
        {
            clave: "rol", titulo: "Rol", ancho: 170, ordenable: true, valor: (u) => u.rolNombre || "",
            celda: (u) => u.rolNombre
                ? <Pista titulo={u.rolNombre} texto={roles.find((r) => r.id === u.appRoleId)?.descripcion || "Rol legado sin migrar."}><span><Estado tono={esAdministrador(u.permisos) ? "mal" : "neutro"} icono={ShieldCheck}>{u.rolNombre}</Estado></span></Pista>
                : <Nada />,
        },
        {
            clave: "permisos", titulo: "Qué puede hacer", ayuda: "Por módulo, el nivel más alto que le da su rol (ojo = ver, mano = operar, engranaje = configurar). El detalle, en la ficha.", valor: (u) => resumirPermisos(u.permisos, 99),
            celda: (u) => <div className="max-w-[560px]"><ResumenPorModulo permisos={u.permisos} max={8} /></div>,
        },
        {
            clave: "entrada", titulo: "Última entrada", ancho: 130, ordenable: true, valor: (u) => (u.ultimaEntrada ? new Date(u.ultimaEntrada).toISOString() : ""),
            celda: (u) => u.ultimaEntrada ? <Momento t={u.ultimaEntrada} /> : <Pista titulo="Sin entradas registradas" texto="Las entradas al panel se registran desde el 23/10."><span className="text-[12px] text-muted-foreground">—</span></Pista>,
        },
        { clave: "phone", titulo: "Teléfono", ancho: 130, valor: (u) => u.phone || "", celda: (u) => u.phone ? <span className="text-[12px] tabular-nums">{u.phone}</span> : <Nada /> },
        {
            clave: "acceso", titulo: "Acceso", ancho: 130, valor: (u) => u.tienePassword ? "con clave" : "sin clave",
            celda: (u) => u.tienePassword ? <Estado tono="bien">con clave</Estado> : <Pista titulo="Sin contraseña" texto="No puede entrar hasta que se le cargue una desde su ficha."><span><Estado tono="aviso">sin clave</Estado></span></Pista>,
        },
        { clave: "createdAt", titulo: "Alta", ancho: 110, ordenable: true, valor: (u) => new Date(u.createdAt).toISOString(), celda: (u) => <Momento t={u.createdAt} soloFecha /> },
        { clave: "createdBy", titulo: "Creó", ancho: 120, valor: (u) => u.createdBy || "", celda: (u) => u.createdBy ? <span className="text-[12px] text-muted-foreground">{u.createdBy}</span> : <Nada /> },
        {
            clave: "acciones", titulo: "", ancho: 90, auxiliar: true,
            celda: (u) => (
                <div className="flex items-center justify-end gap-1">
                    <Pista titulo="Editar" texto="Datos, contraseña y rol."><button onClick={() => setCajonUsuario({ abierto: true, usuario: u })} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={14} /></button></Pista>
                    {!u.esLider && u.name !== miNombre && puedoEditar && (
                        <Pista titulo="Borrar" texto="Deja de poder entrar al panel. Sus eventos y bitácora quedan." lado="izquierda"><button onClick={() => setABorrar(u)} className="p-1.5 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)]"><Trash2 size={14} /></button></Pista>
                    )}
                </div>
            ),
        },
    ];

    const columnasRoles: ColumnaTabla<RolApp>[] = [
        { clave: "nombre", titulo: "Rol", ancho: 200, ordenable: true, valor: (r) => r.nombre, celda: (r) => <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className={esAdministrador(r.permisos) ? "text-[var(--mal)]" : "text-muted-foreground"} /><span className="font-semibold text-[13px]">{r.nombre}</span>{r.esSistema && <Estado tono="quieto">sistema</Estado>}</span> },
        { clave: "descripcion", titulo: "Para qué es", valor: (r) => r.descripcion, celda: (r) => r.descripcion ? <span className="text-[12px] text-muted-foreground">{r.descripcion}</span> : <Nada /> },
        { clave: "permisos", titulo: "Qué puede hacer", valor: (r) => resumirPermisos(r.permisos, 99), celda: (r) => <ResumenPorModulo permisos={r.permisos} max={8} /> },
        {
            clave: "delicados", titulo: "", ancho: 60, auxiliar: true, valor: (r) => PERMISOS.filter((p) => p.delicado && r.permisos.includes(p.clave)).length,
            celda: (r) => { const d = PERMISOS.filter((p) => p.delicado && r.permisos.includes(p.clave)); return d.length ? <Pista titulo="Permisos delicados" texto={d.map((p) => p.rotulo).join(", ")}><span className="inline-flex items-center gap-1 tono-aviso text-[12px] font-semibold"><ShieldAlert size={13} />{d.length}</span></Pista> : null; },
        },
        { clave: "usuarios", titulo: "Usuarios", ancho: 90, alinear: "der", ordenable: true, valor: (r) => r.usuarios, celda: (r) => <span className="tabular-nums text-[12px]">{r.usuarios}</span> },
        { clave: "updatedAt", titulo: "Editado", ancho: 110, valor: (r) => new Date(r.updatedAt).toISOString(), celda: (r) => <Momento t={r.updatedAt} soloFecha /> },
        {
            clave: "acciones", titulo: "", ancho: 120, auxiliar: true,
            celda: (r) => (
                <div className="flex items-center justify-end gap-1">
                    <Pista titulo="Editar" texto="Nombre, descripción y permisos."><button onClick={() => setCajonRol({ abierto: true, rol: r })} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil size={14} /></button></Pista>
                    <Pista titulo="Duplicar" texto="Un rol nuevo con los mismos permisos, para ajustarlo."><button onClick={async () => { const x: any = await duplicarRolApp(r.id); if (!x.ok) toast.error({ title: "No se pudo duplicar", description: x.error }); else { toast.success({ title: `Rol "${x.rol.nombre}" creado` }); cargar(); } }} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Copy size={14} /></button></Pista>
                    {!r.esSistema && (
                        <Pista titulo="Borrar" texto={r.usuarios > 0 ? `${r.usuarios} usuario(s) lo usan: asignales otro rol antes.` : "Sólo si nadie lo usa."} lado="izquierda"><button onClick={() => setRolABorrar(r)} disabled={r.usuarios > 0} className="p-1.5 rounded hover:bg-[var(--mal-suave)] text-[var(--mal)] disabled:opacity-40"><Trash2 size={14} /></button></Pista>
                    )}
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Accesos al panel</h2>
                    <p className="text-sm text-muted-foreground mt-1">Quién entra al panel de administración y qué puede abrir cada uno. El rol decide; los roles se arman acá mismo.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-full border border-border bg-card p-0.5">
                        {([["usuarios", `Usuarios · ${usuarios.length}`], ["roles", `Roles · ${roles.length}`]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setPestania(k)} className={cn("h-8 px-4 rounded-full text-[12px] font-semibold", pestania === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                        ))}
                    </div>
                    {puedoEditar && (pestania === "usuarios"
                        ? <Button onClick={() => setCajonUsuario({ abierto: true, usuario: null })} className="h-8"><Plus size={14} className="mr-1" /> Nuevo usuario</Button>
                        : <Button onClick={() => setCajonRol({ abierto: true, rol: null })} className="h-8"><Plus size={14} className="mr-1" /> Nuevo rol</Button>)}
                </div>
            </div>

            {loaded && !puedoEditar && (
                <p className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5"><Info size={12} /> Tu rol no incluye «Accesos al panel»: los usuarios y los roles los ve y los cambia quien lo tiene.</p>
            )}

            <div className="h-[calc(100vh-260px)] min-h-[420px]">
                {pestania === "usuarios" ? (
                    <Tabla<UsuarioSistema>
                        filas={visibles} clave={(u) => u.id} columnas={columnas}
                        cargando={cargando} error={error} alReintentar={cargar}
                        vacio={{ icono: UserIco, titulo: busqueda || filtroRol !== "todos" ? "Ninguno coincide" : "Sin usuarios del panel", ayuda: "Creá el primero con «Nuevo usuario»." }}
                        alClickFila={(u) => setCajonUsuario({ abierto: true, usuario: u })}
                        barra={
                            <Filtros busqueda={busqueda} alBuscar={setBusqueda} placeholder="Usuario, email o rol"
                                grupos={[{ clave: "rol", titulo: "Rol", valor: filtroRol, alElegir: setFiltroRol, opciones: [{ valor: "todos", rotulo: "Todos" }, ...roles.map((r) => ({ valor: r.id, rotulo: r.nombre }))] }]} />
                        }
                    />
                ) : (
                    <Tabla<RolApp>
                        filas={roles} clave={(r) => r.id} columnas={columnasRoles}
                        cargando={cargando} error={error} alReintentar={cargar}
                        vacio={{ icono: ShieldCheck, titulo: "Sin roles", ayuda: "Los dos de sistema se crean solos al entrar." }}
                        alClickFila={(r) => setCajonRol({ abierto: true, rol: r })}
                        barra={<p className="text-[12px] text-muted-foreground">Un rol es un conjunto de permisos por módulo y nivel (ver, operar, configurar). Los cambios se aplican cuando el usuario vuelve a iniciar sesión, y quedan en Auditoría.</p>}
                    />
                )}
            </div>

            <CajonUsuarioSistema usuario={cajonUsuario.usuario} roles={roles} abierto={cajonUsuario.abierto} onOpenChange={(o) => setCajonUsuario((c) => ({ ...c, abierto: o }))} onGuardado={cargar} soyYo={cajonUsuario.usuario?.name === miNombre} />
            <CajonRol rol={cajonRol.rol} abierto={cajonRol.abierto} onOpenChange={(o) => setCajonRol((c) => ({ ...c, abierto: o }))} onGuardado={cargar} />

            {aBorrar && (
                <ConfirmarAccion open onOpenChange={(o) => { if (!o) setABorrar(null); }} id={aBorrar.id} title={aBorrar.name}
                    description="Deja de poder entrar al panel. No se borran los eventos ni la bitácora que haya registrado: esos quedan con su nombre."
                    onDelete={async (id: string) => { const r: any = await deleteUsuarioSistema(id); return { success: !!r.ok, error: r.error || null }; }}
                    onSuccess={() => { setABorrar(null); cargar(); }} />
            )}
            {rolABorrar && (
                <ConfirmarAccion open onOpenChange={(o) => { if (!o) setRolABorrar(null); }} id={rolABorrar.id} title={`Rol ${rolABorrar.nombre}`}
                    description="Se borra el rol. Sólo se puede si ningún usuario lo tiene asignado."
                    onDelete={async (id: string) => { const r: any = await deleteRolApp(id); return { success: !!r.ok, error: r.error || null }; }}
                    onSuccess={() => { setRolABorrar(null); cargar(); }} />
            )}
        </div>
    );
}
