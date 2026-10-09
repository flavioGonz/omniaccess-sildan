
"use client";

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
import { Users, Plus, Camera } from "lucide-react";
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
import { Filtros } from "@/components/ui/filtros";
import {
    PESTANIAS, pestaniaDeRol, normalizarComportamiento, COMPORTAMIENTO_DEFECTO, SIN_IDENTIFICAR,
    type ClavePestania, type ClaveComportamiento, type Comportamiento, type Interruptores,
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
    const [cargandoFichas, setCargandoFichas] = useState(true);
    const [errorFichas, setErrorFichas] = useState<string | null>(null);
    const [fichaAbierta, setFichaAbierta] = useState<FichaListaNegra | null>(null);
    const [altaFicha, setAltaFicha] = useState<{ plate?: string } | null>(null);
    const [filtroEstado, setFiltroEstado] = useState("activas");
    const [filtroNivel, setFiltroNivel] = useState("todos");

    // Cómo se comporta cada pestaña
    const [comportamiento, setComportamiento] = useState<Comportamiento>(normalizarComportamiento(COMPORTAMIENTO_DEFECTO));
    const [guardandoComp, setGuardandoComp] = useState(false);
    const [avisos, setAvisos] = useState<{ activas: number; total: number; canales: string[] } | null>(null);

    const searchParams = useSearchParams();
    const router = useRouter();

    // ?tab=… y ?action=create&face=…|plate=… (desde la ficha de un evento o el monitor)
    useEffect(() => {
        const t = TAB_DE_URL(searchParams.get("tab"));
        if (t) setPestania(t);
        const action = searchParams.get("action");
        const face = searchParams.get("face");
        const plateQ = searchParams.get("plate");
        if (action === "create") {
            if (face) setCreateInitialData({ cara: decodeURIComponent(face) });
            if (plateQ) setCreateInitialData({ plate: decodeURIComponent(plateQ).toUpperCase() });
            setSelectedUser(null);
            setIsFormOpen(true);
            router.replace("/admin/users", { scroll: false });
        } else if (action === "listanegra") {
            setPestania("listanegra");
            setAltaFicha({ plate: plateQ ? decodeURIComponent(plateQ).toUpperCase() : undefined });
            router.replace("/admin/users?tab=listanegra", { scroll: false });
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

    /** Cuántos hay en cada pestaña, para el número de la pestaña. */
    const cuentas = useMemo(() => {
        const c: Record<ClavePestania, number> = { residentes: 0, personal: 0, proveedores: 0, visitas: 0, listanegra: 0 };
        for (const u of users) { const k = pestaniaDeRol(u.role); if (k !== "listanegra") c[k]++; }
        c.listanegra = fichas.filter((f) => f.activa).length;
        return c;
    }, [users, fichas]);

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
    useEffect(() => { setALaVista(PAGINA); }, [searchQuery, pestania]);

    const fichasVisibles = useMemo(() => {
        const q = searchQuery.trim().toUpperCase();
        return fichas.filter((f) =>
            (filtroEstado === "todas" || (filtroEstado === "activas" ? f.activa : !f.activa)) &&
            (filtroNivel === "todos" || f.nivel === filtroNivel) &&
            (!q || (f.nombre || SIN_IDENTIFICAR).toUpperCase().includes(q) || (f.motivo || "").toUpperCase().includes(q)
                || f.matriculas.some((m) => m.includes(q.replace(/[^A-Z0-9]/g, ""))) || (f.cargo || "").toUpperCase().includes(q)));
    }, [fichas, searchQuery, filtroEstado, filtroNivel]);

    const elegirPestania = (k: ClavePestania) => {
        setPestania(k);
        router.replace(k === "residentes" ? "/admin/users" : `/admin/users?tab=${k}`, { scroll: false });
    };

    const nuevo = () => {
        if (pestania === "listanegra") { setAltaFicha({}); return; }
        setSelectedUser(null); setIsFormOpen(true);
    };

    const abrirPersona = (userId: string) => {
        const u = users.find((x) => x.id === userId);
        if (!u) { toast.warning({ title: "No está en el padrón", description: "La persona ya no existe o no se cargó todavía." }); return; }
        setFichaAbierta(null); setSelectedUser(u); setIsFormOpen(true);
    };

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
                        {PESTANIAS.map((p) => (
                            <button key={p.clave} type="button" onClick={() => elegirPestania(p.clave)} aria-pressed={pestania === p.clave}
                                className={cn("h-8 px-4 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5",
                                    pestania === p.clave ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                {p.titulo}
                                <span className={cn("tabular-nums text-[10px] px-1.5 py-0.5 rounded-md",
                                    p.clave === "listanegra" && cuentas.listanegra > 0 ? "chip-mal" : "bg-muted text-muted-foreground")}>
                                    {cuentas[p.clave]}
                                </span>
                            </button>
                        ))}
                    </div>
                    <ComportamientoPestania pestania={pestania} comportamiento={comportamiento} alCambiar={cambiarComportamiento}
                        guardando={guardandoComp} avisos={avisos} />
                </div>

                <main className="flex-1 overflow-hidden px-8 py-4 flex flex-col">
                    {pestania === "listanegra" ? (
                        <TablaListaNegra
                            fichas={fichasVisibles}
                            cargando={cargandoFichas}
                            error={errorFichas}
                            alReintentar={cargarFichas}
                            alAbrir={setFichaAbierta}
                            barra={
                                <Filtros
                                    busqueda={searchQuery} alBuscar={setSearchQuery}
                                    placeholder="Nombre, matrícula, motivo o quién cargó"
                                    grupos={[
                                        { clave: "nivel", titulo: "Nivel", valor: filtroNivel, alElegir: setFiltroNivel, opciones: [{ valor: "todos", rotulo: "Todos" }, { valor: "BLACKLISTED", rotulo: "Alerta máxima" }, { valor: "SEARCH", rotulo: "En búsqueda" }] },
                                        { clave: "estado", titulo: "Estado", valor: filtroEstado, alElegir: setFiltroEstado, opciones: [{ valor: "activas", rotulo: "Activas" }, { valor: "baja", rotulo: "Dadas de baja" }, { valor: "todas", rotulo: "Todas" }] },
                                    ]}
                                />
                            }
                        />
                    ) : (
                        <TablaUsuarios
                            titulo={tab.columna}
                            plural={tab.plural}
                            enListaNegra={enListaNegra}
                            usuarios={aMostrar}
                            cargando={isLoading}
                            error={error}
                            alReintentar={() => { setError(null); loadData(); }}
                            hayMas={hayMas}
                            traerMas={() => setALaVista((n) => n + PAGINA)}
                            alAbrir={(u) => { setSelectedUser(u as any); setIsFormOpen(true); }}
                            alBorrar={(u) => setUserToDelete(u as any)}
                            barra={<Filtros busqueda={searchQuery} alBuscar={setSearchQuery} placeholder="Nombre, DNI, unidad, matrícula o contacto" />}
                        />
                    )}
                </main>
            </div>

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

            <CajonListaNegra
                abierta={!!fichaAbierta || !!altaFicha}
                ficha={fichaAbierta}
                chapaInicial={altaFicha?.plate}
                alCerrar={() => { setFichaAbierta(null); setAltaFicha(null); }}
                alCambiar={() => { cargarFichas(); loadData(); }}
                alAbrirPersona={abrirPersona}
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
