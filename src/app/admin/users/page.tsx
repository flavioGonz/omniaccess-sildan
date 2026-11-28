
"use client";

import { useFuncion } from "@/lib/funciones-cliente";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { sileo as toast } from "sileo";
import { getUsers, deleteUser } from "@/app/actions/users";
import { getPersonasEnListaNegra } from "@/app/actions/watchlist";
import {
    getFichasListaNegra, getComportamientoPadron, guardarComportamientoPadron, getAvisosListaNegra,
    type FichaListaNegra,
} from "@/app/actions/padron";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots } from "@/app/actions/parking";
import { getDevices, getLprSyncMap } from "@/app/actions/devices";
import { UserRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Users, Plus, Camera, Home, Briefcase, Truck, DoorOpen, Ban, Search, Send, Layers } from "lucide-react";
import { useConfirmar } from "@/components/ui/use-confirmar";
import { buscadorDeCenso, conInvitacion, type InvitacionResumen } from "@/lib/censo-estado";
import { CajonUsuario } from "@/components/users/CajonUsuario";
import { CajonListaNegra } from "@/components/users/CajonListaNegra";
import { TablaListaNegra } from "@/components/users/TablaListaNegra";
import { ComportamientoPestania } from "@/components/users/ComportamientoPestania";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { ExportUsersButton } from "@/components/ExportUsersButton";
import { ImportUsersDialog } from "@/components/ImportUsersDialog";
import { SyncToDevicesDialog } from "@/components/SyncToDevicesDialog";
import { cn } from "@/lib/utils";
import { TablaUsuarios } from "@/components/users/TablaUsuarios";
import { TablaProveedores, ORIGEN } from "@/components/users/TablaProveedores";
import { CajonLote } from "@/components/lotes/CajonLote";
import { FormServicio } from "@/components/administraciones/FormServicio";
import { serviciosReunidos } from "@/app/actions/proveedores";
import { contarProveedores, filtrarProveedores, reunirProveedores, type FiltroOrigen, type ProveedorReunido, type ServicioDeAdmCrudo, type ServicioDeLoteCrudo } from "@/lib/proveedores-reunidos";
import { Filtros } from "@/components/ui/filtros";
import {
    PESTANIAS, pestaniaDeRol, normalizarComportamiento, COMPORTAMIENTO_DEFECTO, SIN_IDENTIFICAR, esPestaniaDeFichas, NIVEL_DE_PESTANIA, estadoRevision,
    type NivelListaNegra, type ClavePestania, type ClaveComportamiento, type Comportamiento, type Interruptores,
} from "@/lib/padron";

interface UserWithRelations {
    id: string;
    name: string;
    username: string | null;
    email: string | null;
    phone: string | null;
    dni: string | null;
    cara: string | null;
    role: UserRole;
    unit: any | null;
    credentials: any[];
    accessGroups: any[];
    vehicles: any[];
    [key: string]: any;
}

/**
 * El padrón, en pestañas: Residentes · Personal · Proveedores · Visitas · Lista negra.
 *
 * Antes eran dos pestañas —Personas (con chips de rol) y Lista de vigilancia (por matrícula,
 * con lista negra, VIP y en búsqueda)— y confundía: el VIP podía ser un rol o una matrícula, la
 * lista negra una matrícula o una persona, y no había un lugar donde ver cómo se trataba a
 * cada uno. Ahora cada clase tiene su pestaña, se crea con su cajón, y arriba dice cómo se
 * comporta (lib/padron). La lista negra son FICHAS: una persona o un vehículo con sus
 * matrículas, en dos niveles.
 *
 * ?tab=listanegra la abre directo (el atajo del monitor); ?tab=vigilancia, el enlace viejo,
 * también.
 */

/** Cuántas filas entran de una. Con la tabla midiendo su propio scroll, 40 llena una pantalla grande. */
const PAGINA = 40;

/** El ícono de cada pestaña: se reconoce de un vistazo antes de leer. La lista negra lleva el de
 *  prohibido, el mismo que la alerta máxima en la tabla y en el cajón. */
const ICONO_PESTANIA: Record<ClavePestania, React.ComponentType<{ size?: number; className?: string }>> = {
    residentes: Home, personal: Briefcase, proveedores: Truck, visitas: DoorOpen, listanegra: Ban, listaamarilla: Search,
};

const TAB_DE_URL = (v: string | null): ClavePestania | null => {
    if (v === "vigilancia") return "listanegra";
    return PESTANIAS.some((p) => p.clave === v) ? (v as ClavePestania) : null;
};

export default function UsersPage() {
    const [users, setUsers] = useState<UserWithRelations[]>([]);
    const [enListaNegra, setEnListaNegra] = useState<Set<string>>(new Set());
    const [pestania, setPestania] = useState<ClavePestania>("residentes");
    const [units, setUnits] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [parkingSlots, setParkingSlots] = useState<any[]>([]);
    const [devices, setDevices] = useState<any[]>([]);
    const [isSyncLoading, setIsSyncLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedUser, setSelectedUser] = useState<UserWithRelations | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<UserWithRelations | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [aLaVista, setALaVista] = useState(PAGINA);
    const [createInitialData, setCreateInitialData] = useState<{ cara?: string; plate?: string } | undefined>(undefined);

    // Lista negra
    const [fichas, setFichas] = useState<FichaListaNegra[]>([]);
    // Sin «Lista Amarilla» (función de LPR, apagada en San Nicolás): la pestaña es sólo lista negra.
    const busquedaOn = useFuncion("LPR_BUSQUEDA");
    const fichasLN = useMemo(() => (busquedaOn ? fichas : fichas.filter((f) => f.nivel !== "SEARCH")), [fichas, busquedaOn]);
    // La Lista Amarilla es una pestaña sólo con su función prendida; sin ella, ni se ofrece.
    const pestanias = useMemo(() => PESTANIAS.filter((p) => p.clave !== "listaamarilla" || busquedaOn), [busquedaOn]);
    const [cargandoFichas, setCargandoFichas] = useState(true);
    const [errorFichas, setErrorFichas] = useState<string | null>(null);
    const [fichaAbierta, setFichaAbierta] = useState<FichaListaNegra | null>(null);
    const [altaFicha, setAltaFicha] = useState<{ plate?: string; nivel?: NivelListaNegra } | null>(null);
    const [filtroEstado, setFiltroEstado] = useState("activas");
    // Lista Amarilla: sólo las que hay que volver a mirar (por vencer y vencidas).
    const [filtroRevision, setFiltroRevision] = useState("todas");
    // Una ficha que acaba de pasar de la amarilla a la negra: se abre en su pestaña nueva cuando
    // la lista termina de recargar.
    const [abrirClave, setAbrirClave] = useState<string | null>(null);

    // Cómo se comporta cada pestaña
    const [comportamiento, setComportamiento] = useState<Comportamiento>(normalizarComportamiento(COMPORTAMIENTO_DEFECTO));
    const [guardandoComp, setGuardandoComp] = useState(false);
    const [avisos, setAvisos] = useState<{ activas: number; total: number; canales: string[] } | null>(null);

    /* La invitación al censo de cada residente (pedido de Nico, 21/11): una columna con en qué está
       y un botón para mandársela a esa persona. Sólo con la función del censo prendida, y sólo si
       la sesión puede manejarlo — si el servidor dice que no, la columna no se dibuja. */
    const censoOn = useFuncion("PADRON_CENSO");
    /* Con la característica Face apagada (25/11) no hay columna Rostro. */
    const faceOn = useFuncion("FUNC_FACE");
    const [censo, setCenso] = useState<{ correoListo: boolean; copiaAdmin: string; aSpam: string | null; invitaciones: InvitacionResumen[] } | null>(null);
    const [enviandoCenso, setEnviandoCenso] = useState<string | null>(null);
    const { confirmar, elemento: confirmacion } = useConfirmar();
    const traerCenso = useCallback(() => {
        fetch("/api/censo/invitaciones?resumen=1", { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null)).then(setCenso).catch(() => setCenso(null));
    }, []);
    useEffect(() => { if (censoOn) traerCenso(); }, [censoOn, traerCenso]);
    const estadoCenso = useMemo(() => buscadorDeCenso(censo?.invitaciones || []), [censo]);

    /** Le manda la invitación a UNA persona. Pregunta antes: un clic de más es un correo a un vecino. */
    const enviarCenso = useCallback(async (u: { id: string; name: string; email: string | null }) => {
        if (!censo) return;
        if (!censo.correoListo) { toast.error({ title: "Falta el servidor de correo", description: "Cargalo en Ajustes → Sistema → Correo (SMTP)." }); return; }
        const ya = estadoCenso(u).que !== "sin-enviar";
        const ok = await confirmar({
            titulo: `${ya ? "Volver a enviarle" : "Enviarle"} la invitación del censo a ${u.name}`,
            descripcion: [
                `Sale ahora a ${u.email}, desde la casilla de su administración${censo.copiaAdmin ? `, con copia oculta a esa casilla y a ${censo.copiaAdmin}` : ""}.`,
                ya ? "Es el mismo enlace y la misma clave que ya tiene." : "",
                censo.aSpam ? `Ojo: ${censo.aSpam} Mirá el aviso en Censo › Invitaciones antes de mandar.` : "",
            ].filter(Boolean).join(" "),
            accion: ya ? "Reenviar" : "Enviar", variante: "accion", icono: Send,
        });
        if (!ok) return;
        setEnviandoCenso(u.id);
        try {
            const r = await fetch("/api/censo/invitaciones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "persona", userId: u.id }) });
            const j = await r.json().catch(() => null);
            if (j?.invitacion) setCenso((c) => (c ? { ...c, invitaciones: conInvitacion(c.invitaciones, j.invitacion) } : c));
            if (!r.ok || !j?.ok) toast.error({ title: "No se pudo enviar", description: j?.error || `El servidor respondió ${r.status}` });
            else toast.success({ title: "Invitación enviada", description: `A ${j.invitacion?.email || u.email}.` });
        } catch { toast.error({ title: "No se pudo enviar", description: "No hubo respuesta del servidor." }); }
        finally { setEnviandoCenso(null); }
    }, [censo, estadoCenso, confirmar]);
    const columnaCenso = useMemo(() => (censoOn && censo && pestania === "residentes"
        ? { de: estadoCenso, alEnviar: enviarCenso, enviando: enviandoCenso } : undefined), [censoOn, censo, pestania, estadoCenso, enviarCenso, enviandoCenso]);

    /* Proveedores, reunidos (28/11, Nico: «ese panel debe juntarlos y distinguirlos»): a las personas
       del padrón con rol de proveedor se les suman los servicios de las administraciones y los de
       cada lote. Vienen en una sola consulta aparte; null es «todavía no llegaron». */
    const [servicios, setServicios] = useState<{ administraciones: ServicioDeAdmCrudo[]; lotes: ServicioDeLoteCrudo[] } | null>(null);
    const [errorServicios, setErrorServicios] = useState<string | null>(null);
    const [origenProv, setOrigenProv] = useState<FiltroOrigen>("todos");
    const [bajasProv, setBajasProv] = useState(false);
    /** El lote abierto desde un servicio de lote: su cajón de siempre, donde el servicio se corrige. */
    const [loteAbierto, setLoteAbierto] = useState<string | null>(null);
    /** El servicio de una administración que se está corrigiendo, con el cajón de Administraciones. */
    const [servicioAdm, setServicioAdm] = useState<ServicioDeAdmCrudo | null>(null);
    const cargarServicios = useCallback(() => {
        setErrorServicios(null);
        serviciosReunidos().then(setServicios)
            .catch((e) => { setServicios({ administraciones: [], lotes: [] }); setErrorServicios(e?.message || "No se pudieron traer los servicios de los lotes y las administraciones."); });
    }, []);

    const searchParams = useSearchParams();
    const router = useRouter();

    // ?tab=… y ?action=create&face=…|plate=… (desde la ficha de un evento o el monitor)
    useEffect(() => {
        const t = TAB_DE_URL(searchParams.get("tab"));
        const action = searchParams.get("action");
        // Sin ?tab= se vuelve a Residentes: el menú tiene «Usuarios» y «Lista negra» sobre la misma
        // página, y tocar «Usuarios» estando en la lista negra no cambiaba nada.
        if (t) setPestania(t); else if (!action) setPestania("residentes");
        const face = searchParams.get("face");
        const plateQ = searchParams.get("plate");
        if (action === "create") {
            if (face) setCreateInitialData({ cara: decodeURIComponent(face) });
            if (plateQ) setCreateInitialData({ plate: decodeURIComponent(plateQ).toUpperCase() });
            setSelectedUser(null);
            setIsFormOpen(true);
            router.replace("/admin/users", { scroll: false });
        } else if (action === "listanegra" || action === "listaamarilla") {
            setPestania(action);
            setAltaFicha({ plate: plateQ ? decodeURIComponent(plateQ).toUpperCase() : undefined, nivel: NIVEL_DE_PESTANIA[action] });
            router.replace(`/admin/users?tab=${action}`, { scroll: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [usersData, unitsData, groupsData, parkingData, devicesData, negras] = await Promise.all([
                getUsers(), getUnits(), getAccessGroups(), getParkingSlots(), getDevices(),
                getPersonasEnListaNegra().catch(() => [] as string[]),
            ]);
            setUsers(usersData as UserWithRelations[]);
            setEnListaNegra(new Set(negras));
            setUnits(unitsData);
            setGroups(groupsData);
            setParkingSlots(parkingData);
            setDevices(devicesData);
            setError(null);
        } catch (e: any) {
            /* Un padrón vacío porque el servidor se cayó no puede verse igual que un barrio sin residentes. */
            console.error("Error loading data:", e);
            setError(e?.message || "No hubo respuesta del servidor.");
        } finally {
            setIsLoading(false);
        }
    };

    const cargarFichas = useCallback(() => {
        setCargandoFichas(true); setErrorFichas(null);
        getFichasListaNegra().then(setFichas)
            .catch((e) => setErrorFichas(e?.message || "No se pudo leer la lista negra"))
            .finally(() => setCargandoFichas(false));
    }, []);

    const fetchSyncMap = async () => {
        setIsSyncLoading(true);
        try { await getLprSyncMap(); } catch (e) { console.error("Error fetching sync map:", e); }
        finally { setIsSyncLoading(false); }
    };

    useEffect(() => {
        loadData();
        cargarFichas();
        cargarServicios();
        fetchSyncMap();
        getComportamientoPadron().then(setComportamiento).catch(() => { /* queda el defecto, que es lo que el monitor ya hace */ });
        getAvisosListaNegra().then(setAvisos).catch(() => setAvisos({ activas: 0, total: 0, canales: [] }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Cambiar un interruptor: se ve al instante y se guarda; si falla, vuelve atrás y lo dice. */
    const cambiarComportamiento = async (clave: ClaveComportamiento, cambio: Partial<Interruptores>) => {
        const antes = comportamiento;
        const nuevo = { ...comportamiento, [clave]: { ...comportamiento[clave], ...cambio } };
        setComportamiento(nuevo); setGuardandoComp(true);
        try {
            const r = await guardarComportamientoPadron(nuevo);
            if (!r.ok) { setComportamiento(antes); toast.error({ title: "No se guardó", description: r.error }); }
            else toast.success({ title: "Guardado", description: "El monitor LPR lo toma al recargar la pantalla." });
        } finally { setGuardandoComp(false); }
    };

    const tab = PESTANIAS.find((p) => p.clave === pestania)!;
    // Con la función apagada no hay pestaña amarilla: quien llegó por un enlace viejo cae en la negra.
    useEffect(() => { if (busquedaOn === false && pestania === "listaamarilla") setPestania("listanegra"); }, [busquedaOn, pestania]);

    /** Los proveedores de las tres fuentes en una lista, y cuántos hay de cada una. */
    const proveedores = useMemo(() => reunirProveedores(
        users.filter((u) => pestaniaDeRol(u.role) === "proveedores"), servicios?.administraciones || [], servicios?.lotes || [],
    ), [users, servicios]);
    const cuentasProv = useMemo(() => contarProveedores(proveedores), [proveedores]);
    const proveedoresVistos = useMemo(() => filtrarProveedores(proveedores, { origen: origenProv, bajas: bajasProv, q: searchQuery }), [proveedores, origenProv, bajasProv, searchQuery]);
    // Sin bajas no hay filtro de «dejaron de venir»: si la última se reactivó, se vuelve a los que vienen.
    useEffect(() => { if (bajasProv && cuentasProv.bajas === 0) setBajasProv(false); }, [bajasProv, cuentasProv.bajas]);

    /** Abrir una fila de proveedores donde se corrige: la persona, el lote, o el servicio de la administración. */
    const abrirProveedor = (f: ProveedorReunido) => {
        if (f.origen === "barrio") { const u = users.find((x) => x.id === f.id); if (u) { setSelectedUser(u); setIsFormOpen(true); } return; }
        if (f.origen === "lote") { if (f.de) setLoteAbierto(f.de.id); return; }
        setServicioAdm(servicios?.administraciones.find((x) => x.id === f.id) || null);
    };

    /** Cuántos hay en cada pestaña, para el número de la pestaña. */
    const cuentas = useMemo(() => {
        const c: Record<ClavePestania, number> = { residentes: 0, personal: 0, proveedores: 0, visitas: 0, listanegra: 0, listaamarilla: 0 };
        for (const u of users) { const k = pestaniaDeRol(u.role); if (!esPestaniaDeFichas(k)) c[k]++; }
        // Proveedores cuenta lo que su pestaña muestra: los del padrón más los servicios vigentes.
        c.proveedores = cuentasProv.todos;
        // Cada lista cuenta lo suyo: la negra, la alerta máxima; la amarilla, lo que está en seguimiento.
        for (const f of fichasLN) if (f.activa) c[f.nivel === "SEARCH" ? "listaamarilla" : "listanegra"]++;
        return c;
    }, [users, fichasLN, cuentasProv.todos]);

    /** Las personas de la pestaña, filtradas por la búsqueda, y recién después recortadas. */
    const filtrados = useMemo(() => {
        const q = searchQuery.toLowerCase();
        return users.filter((u) => pestaniaDeRol(u.role) === pestania && (
            !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.phone?.toLowerCase().includes(q)
            || u.unit?.name?.toLowerCase().includes(q) || u.dni?.toLowerCase().includes(q) || (u.empresa || "").toLowerCase().includes(q)
            || (u.credentials || []).some((c: any) => c.type === "PLATE" && String(c.value).toLowerCase().includes(q))));
    }, [users, searchQuery, pestania]);
    const aMostrar = filtrados.slice(0, aLaVista);
    const hayMas = aLaVista < filtrados.length;
    useEffect(() => { setALaVista(PAGINA); }, [searchQuery, pestania, origenProv, bajasProv]);

    const fichasVisibles = useMemo(() => {
        const q = searchQuery.trim().toUpperCase();
        // El nivel lo decide la pestaña (antes era un filtro adentro de la lista negra).
        const nivel = esPestaniaDeFichas(pestania) ? NIVEL_DE_PESTANIA[pestania] : null;
        return fichasLN.filter((f) =>
            (filtroEstado === "todas" || (filtroEstado === "activas" ? f.activa : !f.activa)) &&
            (!nivel || f.nivel === nivel) &&
            (pestania !== "listaamarilla" || filtroRevision === "todas" || (f.activa && estadoRevision(f.revisarEl).estado !== "al-dia")) &&
            (!q || (f.nombre || SIN_IDENTIFICAR).toUpperCase().includes(q) || (f.motivo || "").toUpperCase().includes(q)
                || f.matriculas.some((m) => m.includes(q.replace(/[^A-Z0-9]/g, ""))) || (f.cargo || "").toUpperCase().includes(q)));
    }, [fichasLN, searchQuery, filtroEstado, filtroRevision, pestania]);

    /** Cuántas amarillas activas hay para revisar: el número que acompaña al filtro. */
    const paraRevisar = useMemo(() => fichasLN.filter((f) => f.nivel === "SEARCH" && f.activa && estadoRevision(f.revisarEl).estado !== "al-dia").length, [fichasLN]);
    useEffect(() => {
        if (!abrirClave) return;
        // Hasta que la lista recargue, la ficha sigue figurando amarilla: se espera a verla negra,
        // o se abriría con los datos viejos.
        const f = fichas.find((x) => x.clave === abrirClave && x.nivel === "BLACKLISTED");
        if (f) { setFichaAbierta(f); setAbrirClave(null); }
    }, [fichas, abrirClave]);

    const elegirPestania = (k: ClavePestania) => {
        setPestania(k);
        router.replace(k === "residentes" ? "/admin/users" : `/admin/users?tab=${k}`, { scroll: false });
    };

    const nuevo = () => {
        if (esPestaniaDeFichas(pestania)) { setAltaFicha({ nivel: NIVEL_DE_PESTANIA[pestania] }); return; }
        setSelectedUser(null); setIsFormOpen(true);
    };

    const abrirPersona = (userId: string) => {
        const u = users.find((x) => x.id === userId);
        if (!u) { toast.warning({ title: "No está en el padrón", description: "La persona ya no existe o no se cargó todavía." }); return; }
        setFichaAbierta(null); setSelectedUser(u); setIsFormOpen(true);
    };

    const comportaEnBarra = <ComportamientoPestania conBusqueda={!!busquedaOn} pestania={pestania} comportamiento={comportamiento} alCambiar={cambiarComportamiento}
        guardando={guardandoComp} avisos={avisos} />;

    return (
        <TooltipProvider>
            <div className="relative h-full flex flex-col overflow-hidden bg-background">
                <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                            <Users size={20} />
                        </span>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Usuarios y residentes</h1>
                            <p className="text-sm text-muted-foreground mt-1">Quién es cada uno en el barrio, con qué entra, y cómo lo trata el monitor</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-card rounded-md border border-border p-1">
                            <ExportUsersButton users={users} />
                            <div className="w-px h-4 bg-foreground/10 mx-1" />
                            <ImportUsersDialog onSuccess={() => { loadData(); fetchSyncMap(); }} />
                            <div className="w-px h-4 bg-foreground/10 mx-1" />
                            <SyncToDevicesDialog onSuccess={() => { loadData(); fetchSyncMap(); }} />
                        </div>
                        <Button onClick={fetchSyncMap} disabled={isSyncLoading} variant="ghost" size="sm"
                            className="h-8 w-8 p-0 rounded-full hover:bg-muted text-muted-foreground" title="Actualizar Sync Map">
                            <Camera size={14} className={isSyncLoading ? "animate-spin" : ""} />
                        </Button>
                        <Button onClick={nuevo} className="accion h-8 px-4 text-xs font-bold rounded-md ml-2">
                            <Plus size={14} className="mr-1.5" /> {tab.nuevo}
                        </Button>
                    </div>
                </header>

                {/* Las pestañas: una por clase. La pastilla es elección, el número cuántos hay. */}
                <div className="px-8 pt-4 shrink-0 flex flex-col gap-3">
                    <div className="inline-flex self-start rounded-full border border-border bg-card p-0.5 flex-wrap">
                        {pestanias.map((p) => {
                            const Ic = ICONO_PESTANIA[p.clave];
                            const activa = pestania === p.clave;
                            // La lista negra se distingue de las demás aunque no esté elegida: fondo
                            // rojo suave siempre, rojo pleno cuando es la abierta. Es estado (mal),
                            // no acción, así que va con el tono y no con el azul.
                            // La amarilla, igual pero en ámbar: es el mismo gesto con otro significado
                            // (en seguimiento, no prohibido), y el color es lo que las separa de lejos.
                            const negra = p.clave === "listanegra";
                            const amarilla = p.clave === "listaamarilla";
                            return (
                                <button key={p.clave} type="button" onClick={() => elegirPestania(p.clave)} aria-pressed={activa}
                                    className={cn("h-8 px-3.5 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 border border-transparent",
                                        negra ? (activa ? "pleno-mal" : "chip-mal ml-1 hover:brightness-110")
                                            : amarilla ? (activa ? "pleno-aviso ml-1" : "chip-aviso ml-1 hover:brightness-110")
                                            : activa ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    <Ic size={13} />
                                    {p.titulo}
                                    <span className={cn("tabular-nums text-[10px] px-1.5 py-0.5 rounded-md",
                                        negra ? (activa ? "bg-white/20 text-white" : "pleno-mal")
                                            : amarilla ? (activa ? "bg-black/15" : "pleno-aviso") : "bg-muted text-muted-foreground")}>
                                        {cuentas[p.clave]}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <main className="flex-1 overflow-hidden px-8 py-4 flex flex-col">
                    {/* «Cómo se comporta», en íconos a la derecha de los filtros (17/10, Nico): ni
                        franja arriba ni debajo de la tabla, que ocupaban un renglón entero. */}
                    {esPestaniaDeFichas(pestania) ? (
                        <TablaListaNegra
                            fichas={fichasVisibles}
                            conBusqueda={false}
                            amarilla={pestania === "listaamarilla"}
                            cargando={cargandoFichas}
                            error={errorFichas}
                            alReintentar={cargarFichas}
                            alAbrir={setFichaAbierta}
                            barra={
                                <Filtros
                                    busqueda={searchQuery} alBuscar={setSearchQuery}
                                    placeholder="Nombre, matrícula, motivo o quién cargó"
                                    grupos={[
                                        { clave: "estado", titulo: "Estado", valor: filtroEstado, alElegir: setFiltroEstado, opciones: [{ valor: "activas", rotulo: "Activas" }, { valor: "baja", rotulo: "Dadas de baja" }, { valor: "todas", rotulo: "Todas" }] },
                                        ...(pestania === "listaamarilla" ? [{ clave: "revision", titulo: "Revisión", valor: filtroRevision, alElegir: setFiltroRevision, opciones: [{ valor: "todas", rotulo: "Todas" }, { valor: "revisar", rotulo: paraRevisar ? `Para revisar (${paraRevisar})` : "Para revisar" }] }] : []),
                                    ]}
                                    acciones={comportaEnBarra}
                                />
                            }
                        />
                    ) : pestania === "proveedores" ? (
                        <TablaProveedores
                            filas={proveedoresVistos.slice(0, aLaVista)}
                            cargando={(isLoading && users.length === 0) || servicios === null}
                            error={error || errorServicios}
                            alReintentar={() => { if (error) { setError(null); loadData(); } cargarServicios(); }}
                            hayMas={aLaVista < proveedoresVistos.length}
                            traerMas={() => setALaVista((n) => n + PAGINA)}
                            alAbrir={abrirProveedor}
                            barra={
                                <Filtros
                                    busqueda={searchQuery} alBuscar={setSearchQuery}
                                    placeholder="Nombre, servicio, lote, matrícula o contacto"
                                    grupos={[
                                        {
                                            clave: "origen", titulo: "De quién es cada proveedor", valor: origenProv, alElegir: (v) => setOrigenProv(v as FiltroOrigen),
                                            opciones: [
                                                { valor: "todos", rotulo: "Todos", icono: Layers, cuenta: bajasProv ? undefined : cuentasProv.todos },
                                                ...(["barrio", "administracion", "lote"] as const).map((o) => ({ valor: o, rotulo: ORIGEN[o].rotulo, icono: ORIGEN[o].icono, titulo: ORIGEN[o].que, cuenta: bajasProv ? undefined : cuentasProv[o] })),
                                            ],
                                        },
                                        {
                                            clave: "bajas", titulo: "Los servicios de lote que se dieron de baja quedan en el registro", valor: bajasProv ? "bajas" : "vienen", alElegir: (v) => setBajasProv(v === "bajas"),
                                            oculto: cuentasProv.bajas === 0,
                                            opciones: [{ valor: "vienen", rotulo: "Vienen" }, { valor: "bajas", rotulo: "Dejaron de venir", cuenta: cuentasProv.bajas }],
                                        },
                                    ]}
                                    acciones={comportaEnBarra}
                                />
                            }
                            pie={<span className="tabular-nums">
                                {proveedoresVistos.length} {proveedoresVistos.length === 1 ? "proveedor" : "proveedores"}
                                {!bajasProv && origenProv === "todos" && !searchQuery.trim() && <> · {cuentasProv.barrio} {ORIGEN.barrio.plural} · {cuentasProv.administracion} {ORIGEN.administracion.plural} · {cuentasProv.lote} {ORIGEN.lote.plural}</>}
                            </span>}
                        />
                    ) : (
                        <TablaUsuarios
                            titulo={tab.columna}
                            plural={tab.plural}
                            enListaNegra={enListaNegra}
                            censo={columnaCenso}
                            sinRostro={faceOn === false}
                            usuarios={aMostrar}
                            cargando={isLoading}
                            error={error}
                            alReintentar={() => { setError(null); loadData(); }}
                            hayMas={hayMas}
                            traerMas={() => setALaVista((n) => n + PAGINA)}
                            alAbrir={(u) => { setSelectedUser(u as any); setIsFormOpen(true); }}
                            alBorrar={(u) => setUserToDelete(u as any)}
                            barra={<Filtros busqueda={searchQuery} alBuscar={setSearchQuery} placeholder="Nombre, DNI, unidad, matrícula o contacto" acciones={comportaEnBarra} />}
                        />
                    )}
                </main>
            </div>

            {confirmacion}

            <CajonUsuario
                open={isFormOpen}
                onOpenChange={(open) => { setIsFormOpen(open); if (!open) setCreateInitialData(undefined); }}
                user={(selectedUser as any) || undefined}
                initialData={createInitialData}
                rolInicial={tab.rolNuevo || undefined}
                units={units}
                groups={groups}
                devices={devices}
                parkingSlots={parkingSlots}
                onSuccess={() => {
                    loadData(); cargarFichas(); fetchSyncMap();
                    setIsFormOpen(false); setSelectedUser(null); setCreateInitialData(undefined);
                }}
            />

            {/* Un servicio de lote se corrige en el cajón de su lote, que es donde vive y donde queda el
                historial; al cerrarlo se vuelve a traer la lista, por si cambió. */}
            <CajonLote unitId={loteAbierto} alCerrar={() => { setLoteAbierto(null); cargarServicios(); }} />
            {servicioAdm && (
                <FormServicio administracionId={servicioAdm.administracion.id} nombreAdm={servicioAdm.administracion.nombre} s={servicioAdm}
                    alCerrar={() => setServicioAdm(null)} alGuardar={() => { setServicioAdm(null); cargarServicios(); }} />
            )}

            <CajonListaNegra
                abierta={!!fichaAbierta || !!altaFicha}
                ficha={fichaAbierta}
                chapaInicial={altaFicha?.plate}
                nivelInicial={altaFicha?.nivel}
                alCerrar={() => { setFichaAbierta(null); setAltaFicha(null); }}
                alCambiar={() => { cargarFichas(); loadData(); }}
                alAbrirPersona={abrirPersona}
                alPasarANegra={(clave) => { setAbrirClave(clave); elegirPestania("listanegra"); }}
            />

            <DeleteConfirmDialog
                id={userToDelete?.id || ""}
                open={!!userToDelete}
                onOpenChange={(open) => !open && setUserToDelete(null)}
                title="Eliminar Usuario"
                description={`¿Estás seguro de eliminar a ${userToDelete?.name}?`}
                onDelete={deleteUser}
                onSuccess={() => { loadData(); setUserToDelete(null); }}
            />
        </TooltipProvider>
    );
}
