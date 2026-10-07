"use client";

/**
 * Ajustes › Accesos al panel: los usuarios del sistema y los roles de la aplicación.
 *
 * Antes era "Usuarios del Sistema": una tabla propia dentro de un marco gris, un modal con
 * cuatro campos y un `<select>` con dos opciones fijas (Administrador / Solo lectura). No
 * se podía decir "este operador ve monitor e historial y nada más", ni se veía en la tabla
 * qué podía hacer cada uno.
 *
 * Ahora: dos pestañas. **Usuarios**, con la tabla de la aplicación (`ui/tabla`) y un cajón
 * (`ui/cajon`) en bloques: quién es, cómo entra, qué puede hacer — con la grilla de permisos
 * del rol a la vista. **Roles**, donde se editan los roles con la grilla de permisos
 * (`lib/permisos`): se crean, se duplican, se borran si nadie los usa. Lo que se marca acá
 * es lo que el middleware corta y lo que el menú muestra.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Pencil, Trash2, Copy, ShieldCheck, KeyRound, User as UserIco, Lock, Camera, Upload, Check, Info, AlertTriangle } from "lucide-react";
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
import { PERMISOS, GRUPOS_PERMISOS, resumirPermisos, esAdministrador, type Permiso } from "@/lib/permisos";
import {
    getUsuariosSistema, saveUsuarioSistema, deleteUsuarioSistema,
    getRolesApp, saveRolApp, duplicarRolApp, deleteRolApp,
    type UsuarioSistema, type RolApp,
} from "@/app/actions/accesos";

const fotoUrl = (cara?: string | null) => (cara ? (cara.startsWith("/") || cara.startsWith("http") ? cara : `/api/files/${cara}`) : null);

/* ─────────────────────────── La grilla de permisos ─────────────────────────── */

/**
 * Los permisos agrupados, como casillas o como lectura. Es la misma pieza en el cajón del
 * usuario (sólo lectura: lo que su rol le da) y en el editor de roles (editable).
 */
function GrillaPermisos({ valor, onChange, soloLectura, compacta }: { valor: string[]; onChange?: (v: string[]) => void; soloLectura?: boolean; compacta?: boolean }) {
    const set = new Set(valor);
    const alternar = (p: Permiso) => {
        if (soloLectura || !onChange) return;
        const n = new Set(set);
        if (n.has(p.clave)) n.delete(p.clave); else n.add(p.clave);
        onChange([...n]);
    };
    const alternarGrupo = (g: string, todos: boolean) => {
        if (soloLectura || !onChange) return;
        const n = new Set(set);
        PERMISOS.filter((p) => p.grupo === g).forEach((p) => (todos ? n.add(p.clave) : n.delete(p.clave)));
        onChange([...n]);
    };
    return (
        <div className={cn("grid gap-3", compacta ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
            {GRUPOS_PERMISOS.map((g) => {
                const del = PERMISOS.filter((p) => p.grupo === g);
                const marcados = del.filter((p) => set.has(p.clave)).length;
                return (
                    <div key={g} className="rounded-[10px] border border-border bg-card/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{g}</span>
                            {!soloLectura ? (
                                <button type="button" onClick={() => alternarGrupo(g, marcados < del.length)} className="text-[11px] font-semibold text-[var(--accion)]">
                                    {marcados < del.length ? "Todo el grupo" : "Nada del grupo"}
                                </button>
                            ) : <span className="text-[10px] text-muted-foreground tabular-nums">{marcados}/{del.length}</span>}
                        </div>
                        <ul className="space-y-1">
                            {del.map((p) => {
                                const on = set.has(p.clave);
                                return (
                                    <li key={p.clave}>
                                        <Pista titulo={p.rotulo} texto={<span>{p.descripcion}{p.rutas.length ? <span className="block mt-1 text-muted-foreground">Abre: {p.rutas.join(", ")}</span> : null}</span>} ancho={320} lado="derecha">
                                            <button type="button" onClick={() => alternar(p)} disabled={soloLectura}
                                                className={cn("w-full flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] transition",
                                                    on ? "text-foreground" : "text-muted-foreground",
                                                    !soloLectura && "hover:bg-accent", soloLectura && "cursor-default")}>
                                                <span className={cn("h-4 w-4 rounded-[4px] border flex items-center justify-center shrink-0",
                                                    on ? "bg-[var(--accion)] border-[var(--accion)] text-white" : "border-border bg-background")}>
                                                    {on && <Check size={11} />}
                                                </span>
                                                <span className={cn(on ? "" : "line-through decoration-border")}>{p.rotulo}</span>
                                            </button>
                                        </Pista>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                );
            })}
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
                    <CajonCampo etiqueta={esAlta ? "Contraseña" : "Nueva contraseña"} ayuda={esAlta ? "Se guarda cifrada." : "Dejar vacío para no cambiarla. Se guarda cifrada."}>
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
                            <p className="text-[12px] text-muted-foreground mb-2">{rol.descripcion || "Sin descripción."} Con este rol abre:</p>
                            <GrillaPermisos valor={rol.permisos} soloLectura compacta />
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
    const [guardando, setGuardando] = useState(false);
    useEffect(() => { if (abierto) { setNombre(rol?.nombre || ""); setDescripcion(rol?.descripcion || ""); setPermisos(rol?.permisos || []); } }, [abierto, rol]);
    const esAdminSistema = rol?.id === "rol-administrador";
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
            <CajonContenido ancho="intermedio" titulo={esAlta ? "Nuevo rol" : rol!.nombre}
                descripcion={esAlta ? "Un conjunto de permisos con nombre, para asignárselo a usuarios del panel." : `${rol!.usuarios} usuario${rol!.usuarios === 1 ? "" : "s"} con este rol${rol!.esSistema ? " · rol de sistema" : ""}`}
                pie={
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted-foreground tabular-nums">{resumirPermisos(permisos)}</span>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                            <Button type="button" onClick={guardar} disabled={guardando || !nombre.trim()}>{guardando ? <Loader2 size={14} className="animate-spin mr-1" /> : null}{esAlta ? "Crear rol" : "Guardar"}</Button>
                        </div>
                    </div>
                }>
                <CajonSeccion titulo="Cómo se llama" icono={KeyRound}>
                    <div className="grid grid-cols-1 gap-3.5">
                        <CajonCampo etiqueta="Nombre">
                            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ej: Guardia de noche" disabled={!!rol?.esSistema} />
                        </CajonCampo>
                        <CajonCampo etiqueta="Para qué es" ayuda="Una frase que diga a quién se le da.">
                            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="ej: Mira el monitor y el historial, carga lista negra, no toca padrón." />
                        </CajonCampo>
                    </div>
                </CajonSeccion>
                <CajonSeccion titulo="Qué puede abrir" icono={ShieldCheck}
                    ayuda={esAdminSistema ? "Administrador tiene siempre todo: si se le pudiera sacar Accesos al panel, nadie podría volver a esta pantalla." : "Cada casilla es una pantalla o una función. Pasá el mouse para ver qué habilita y qué rutas abre."}>
                    <GrillaPermisos valor={permisos} onChange={setPermisos} soloLectura={esAdminSistema} />
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

    const cargar = useCallback(() => {
        setCargando(true); setError(null);
        Promise.all([getUsuariosSistema(), getRolesApp()])
            .then(([u, r]) => { setUsuarios(u); setRoles(r); })
            .catch((e) => setError(e?.message || "No se pudo leer"))
            .finally(() => setCargando(false));
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

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
            clave: "permisos", titulo: "Qué puede abrir", ayuda: "Resumen de los permisos del rol. El detalle, en la ficha.", valor: (u) => resumirPermisos(u.permisos, 99),
            celda: (u) => {
                const set = new Set(u.permisos);
                const todos = PERMISOS.every((p) => set.has(p.clave));
                if (todos) return <span className="text-[12px] text-foreground">Todo el panel</span>;
                const tiene = PERMISOS.filter((p) => set.has(p.clave));
                return (
                    <div className="flex flex-wrap gap-1 max-w-[520px]">
                        {tiene.slice(0, 6).map((p) => <span key={p.clave} className="chip-neutro rounded-md border px-1.5 py-0.5 text-[10px] font-semibold">{p.rotulo}</span>)}
                        {tiene.length > 6 && <Pista titulo="Y además" texto={tiene.slice(6).map((p) => p.rotulo).join(", ")}><span className="chip-neutro rounded-md border px-1.5 py-0.5 text-[10px] font-semibold">+{tiene.length - 6}</span></Pista>}
                        {tiene.length === 0 && <span className="text-[12px] text-muted-foreground">Sin permisos: puede entrar pero no abre nada.</span>}
                    </div>
                );
            },
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
        { clave: "permisos", titulo: "Permisos", ancho: 260, valor: (r) => resumirPermisos(r.permisos, 99), celda: (r) => <span className="text-[12px]">{resumirPermisos(r.permisos, 4)}</span> },
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
                <p className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5"><Info size={12} /> Tu rol no incluye «Accesos al panel»: ves la lista pero no podés cambiarla.</p>
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
                        barra={<p className="text-[12px] text-muted-foreground">Un rol es un conjunto de permisos con nombre. Pasá el mouse por cada permiso para ver qué pantallas abre. Los cambios se aplican cuando el usuario vuelve a iniciar sesión.</p>}
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
