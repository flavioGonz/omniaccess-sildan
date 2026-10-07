
"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { getUsers, deleteUser } from "@/app/actions/users";
import { getPersonasEnListaNegra } from "@/app/actions/watchlist";
import { ListaVigilancia } from "@/components/users/ListaVigilancia";
import { getUnits } from "@/app/actions/units";
import { getAccessGroups } from "@/app/actions/groups";
import { getParkingSlots } from "@/app/actions/parking";
import { getDevices, getLprSyncMap } from "@/app/actions/devices";
import { UserRole } from "@prisma/client";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    UserCheck,
    UserX,
    Users,
    Briefcase,
    Car,
    Plus,
    Trash2,
    Edit,
    Search,
    ScanFace,
    Camera,
    CreditCard,
    KeyRound,
    Fingerprint,
    Server,
    Shield,
    Loader2,
    Filter,
    MoreHorizontal,
    Mail,
    Phone,
    MapPin,

    Hash,
    Truck,
    ShieldAlert
} from "lucide-react";
import { CajonUsuario } from "@/components/users/CajonUsuario";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { ExportUsersButton } from "@/components/ExportUsersButton";
import { ImportUsersDialog } from "@/components/ImportUsersDialog";
import { SyncToDevicesDialog } from "@/components/SyncToDevicesDialog";
import { cn } from "@/lib/utils";
import { TablaUsuarios, ROLES } from "@/components/users/TablaUsuarios";
import { Filtros } from "@/components/ui/filtros";

// Mock User with relations until prisma generate is ready
interface UserWithRelations {
    id: string;
    name: string;
    username: string | null;
    email: string | null;
    phone: string | null;
    dni: string | null;
    cara: string | null;
    role: UserRole;
    observations: string | null;
    blacklistReason: string | null;
    rolAnterior: UserRole | null;
    createdBy: string | null;
    apartment: string | null;
    accessTags: string[];
    createdAt: Date;
    updatedAt: Date;
    unitId: string | null;
    parkingSlotId: string | null;
    appRoleId: string | null;
    unit: any | null;
    credentials: any[];
    accessGroups: any[];
    vehicles: any[];
    [key: string]: any; // Allow additional properties
}

/* ROLE_LABELS se mudó a `TablaUsuarios` como `ROLES`, con los tonos del sistema en vez de
   siete colores inventados. Acá quedaba sólo porque la tabla vivía en esta página. */

/** El rol que no se ofrece como filtro de Personas: su lugar es la pestaña Lista de vigilancia. */
const ROL_LISTA_NEGRA = "BLACKLISTED";

/** Cuántas filas entran de una. Con la tabla midiendo su propio scroll, 40 llena una
 *  pantalla grande sin pedir la siguiente enseguida. */
const PAGINA = 40;

export default function UsersPage() {
    const [users, setUsers] = useState<UserWithRelations[]>([]);
    const [enListaNegra, setEnListaNegra] = useState<Set<string>>(new Set());
    // Dos pestañas: las personas, y la lista de vigilancia (matrículas). ?tab=vigilancia la abre
    // directo: es adonde apunta el atajo del monitor LPR.
    const [pestania, setPestania] = useState<"personas" | "vigilancia">("personas");
    const [visibleUsers, setVisibleUsers] = useState<UserWithRelations[]>([]);
    const [units, setUnits] = useState<any[]>([]);
    const [groups, setGroups] = useState<any[]>([]);
    const [parkingSlots, setParkingSlots] = useState<any[]>([]);
    const [devices, setDevices] = useState<any[]>([]);
    const [lprSyncMap, setLprSyncMap] = useState<Record<string, string[]>>({});
    const [isSyncLoading, setIsSyncLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRole, setFilterRole] = useState<string | null>(null);
    const [selectedUser, setSelectedUser] = useState<UserWithRelations | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [userToDelete, setUserToDelete] = useState<UserWithRelations | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /* Cuántas filas se muestran. Antes se guardaba el arreglo recortado; guardar el NÚMERO
       es lo que permite que la paginación funcione también con búsqueda puesta. */
    const [aLaVista, setALaVista] = useState(20);
    const [createInitialData, setCreateInitialData] = useState<{ cara?: string; plate?: string } | undefined>(undefined);
    const observerTarget = useRef(null);

    const searchParams = useSearchParams();
    const router = useRouter();

    // Handle ?action=create&face=... from EventDetailsDialog
    useEffect(() => {
        if (searchParams.get("tab") === "vigilancia") setPestania("vigilancia");
        const action = searchParams.get("action");
        const face = searchParams.get("face");
        if (action === "create") {
            if (face) setCreateInitialData({ cara: decodeURIComponent(face) });
            const plateQ = searchParams.get("plate"); if (plateQ) setCreateInitialData({ plate: decodeURIComponent(plateQ).toUpperCase() });
            setSelectedUser(null);
            setIsFormOpen(true);
            // Clean URL
            router.replace("/admin/users", { scroll: false });
        }
    }, [searchParams]);

    /* El IntersectionObserver a mano se fue: lo hace `Tabla` con su centinela, adentro de
       su propio contenedor de scroll — que es el único lugar donde puede saber de verdad
       si alguien llegó al final de la lista. */

    const loadData = async () => {
        setIsLoading(true);
        try {
            // Using existing actions but would ideally optimize to fetch lighter objects
            const [usersData, unitsData, groupsData, parkingData, devicesData, negras] = await Promise.all([
                getUsers(),
                getUnits(),
                getAccessGroups(),
                getParkingSlots(),
                getDevices(),
                getPersonasEnListaNegra().catch(() => [] as string[]),
            ]);
            setUsers(usersData as UserWithRelations[]);
            setEnListaNegra(new Set(negras));
            setUnits(unitsData);
            setGroups(groupsData);
            setParkingSlots(parkingData);
            setDevices(devicesData);
            setALaVista(PAGINA);
            setError(null);
        } catch (e: any) {
            /* Era `console.error` y nada más: un padrón vacío porque el servidor se cayó se
               veía exactamente igual que un barrio sin residentes. */
            console.error("Error loading data:", e);
            setError(e?.message || "No hubo respuesta del servidor.");
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSyncMap = async () => {
        setIsSyncLoading(true);
        try {
            const data = await getLprSyncMap();
            setLprSyncMap(data);
        } catch (error) {
            console.error("Error fetching sync map:", error);
        } finally {
            setIsSyncLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        fetchSyncMap();
    }, []);

    /**
     * El padrón filtrado, y recién después recortado.
     *
     * Antes era al revés: se paginaba sobre el arreglo crudo y, cuando había búsqueda o
     * filtro de rol, se mostraba la lista ENTERA de golpe — el scroll infinito se apagaba
     * justo cuando el usuario estaba buscando. Con un padrón chico no se nota; con dos mil
     * residentes, buscar cuelga la pantalla.
     */
    const filtrados = users.filter(user => {
        const query = searchQuery.toLowerCase();
        const matchesSearch = (
            user.name?.toLowerCase().includes(query) ||
            user.email?.toLowerCase().includes(query) ||
            user.phone?.toLowerCase().includes(query) ||
            user.unit?.name?.toLowerCase().includes(query) ||
            user.dni?.toLowerCase().includes(query)
        );
        const matchesRole = filterRole ? user.role === filterRole : true;
        return matchesSearch && matchesRole;
    });

    const aMostrar = filtrados.slice(0, aLaVista);
    const hayMas = aLaVista < filtrados.length;

    // Cambiar de búsqueda o de rol vuelve a la primera página: seguir en la 8 de una lista
    // que ahora tiene 3 elementos deja la pantalla vacía sin motivo.
    useEffect(() => { setALaVista(PAGINA); }, [searchQuery, filterRole]);

    /* `getCredentialsInfo` se mudó a `TablaUsuarios` como `credenciales`: es cómo se
       dibuja una fila, no lógica de la página. */

    return (
        <TooltipProvider>
            {/*
              * El fondo de la pantalla, igual que en todas las demás.
              *
              * Acá era `bg-muted`, una superficie más clara que el resto de la aplicación, y
              * eso se veía de dos maneras: la pantalla no pegaba con las vecinas, y el
              * encabezado fijo de la tabla — que es opaco a la fuerza, porque las filas le
              * pasan por debajo — quedaba como una banda oscura apoyada encima de la lista.
              */}
            <div className="relative h-full flex flex-col overflow-hidden bg-background">
                <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                            <Users size={20} />
                        </span>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Usuarios y residentes</h1>
                            <p className="text-sm text-muted-foreground mt-1">
                                Quién es cada uno en el barrio, y con qué entra
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Compact Actions */}
                        <div className="flex items-center bg-card rounded-md border border-border p-1">
                            <ExportUsersButton users={users} />
                            <div className="w-px h-4 bg-foreground/10 mx-1" />
                            <ImportUsersDialog onSuccess={() => { loadData(); fetchSyncMap(); }} />
                            <div className="w-px h-4 bg-foreground/10 mx-1" />
                            <SyncToDevicesDialog onSuccess={() => { loadData(); fetchSyncMap(); }} />
                        </div>

                        <Button
                            onClick={fetchSyncMap}
                            disabled={isSyncLoading}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-full hover:bg-muted text-muted-foreground"
                            title="Actualizar Sync Map"
                        >
                            <Camera size={14} className={isSyncLoading ? "animate-spin" : ""} />
                        </Button>

                        <Button
                            onClick={() => { setSelectedUser(null); setIsFormOpen(true); }}
                            className="accion h-8 px-4 text-xs font-bold uppercase tracking-wide rounded-md ml-2"
                        >
                            <Plus size={14} className="mr-2" />
                            Nuevo
                        </Button>
                    </div>
                </header>

                {/* Pestañas: una sola pantalla para las personas y para la lista de vigilancia
                    (lista negra / VIP / en búsqueda). El monitor y el bot escriben esa misma lista. */}
                <div className="px-8 pt-4 shrink-0">
                    <div className="inline-flex rounded-full border border-border bg-card p-0.5">
                        {([["personas", "Personas"], ["vigilancia", "Lista de vigilancia"]] as const).map(([k, l]) => (
                            <button key={k} type="button" onClick={() => { setPestania(k); router.replace(k === "vigilancia" ? "/admin/users?tab=vigilancia" : "/admin/users"); }}
                                className={`h-8 px-4 rounded-full text-[12px] font-semibold ${pestania === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                                {l}{k === "vigilancia" && enListaNegra.size > 0 ? <span className="ml-1.5 tabular-nums text-[10px] px-1.5 py-0.5 rounded-md chip-mal">{enListaNegra.size}</span> : null}
                            </button>
                        ))}
                    </div>
                </div>

                <main className="flex-1 overflow-hidden px-8 py-6 flex flex-col">

                {pestania === "vigilancia" ? (
                    <ListaVigilancia personas={users as any} />
                ) : (
                <TablaUsuarios
                    enListaNegra={enListaNegra}
                    usuarios={aMostrar}
                    cargando={isLoading}
                    error={error}
                    alReintentar={() => { setError(null); loadData(); }}
                    hayMas={hayMas}
                    traerMas={() => setALaVista((n) => n + PAGINA)}
                    alAbrir={(u) => { setSelectedUser(u as any); setIsFormOpen(true); }}
                    alBorrar={(u) => setUserToDelete(u as any)}
                    barra={
                        <Filtros
                            busqueda={searchQuery} alBuscar={setSearchQuery}
                            placeholder="Nombre, DNI, unidad o contacto"
                            /* Un rol por vez: son excluyentes, así que es una elección y no
                               una lista de interruptores. */
                            grupos={[{
                                clave: "rol", titulo: "Qué es cada uno en el barrio",
                                valor: filterRole ?? "todos",
                                alElegir: (v) => setFilterRole(v === "todos" ? null : v),
                                opciones: [
                                    { valor: "todos", rotulo: "Todos" },
                                    /* Sin «Lista negra»: las personas en lista negra se ven y se
                                       manejan en la pestaña Lista de vigilancia, junto a las
                                       matrículas. Tenerlas también acá era un segundo lugar para lo
                                       mismo, con menos datos (sin motivo, sin detecciones). */
                                    ...Object.entries(ROLES).filter(([clave]) => clave !== ROL_LISTA_NEGRA).map(([clave, info]) => ({
                                        valor: clave, rotulo: info.label,
                                    })),
                                ],
                            }]}
                        />
                    }
                />
                )}
                </main>
            </div>

            {/* Dialogs */}
            <CajonUsuario
                open={isFormOpen}
                onOpenChange={(open) => {
                    setIsFormOpen(open);
                    if (!open) setCreateInitialData(undefined);
                }}
                user={selectedUser || undefined}
                initialData={createInitialData}
                units={units}
                groups={groups}
                devices={devices}
                parkingSlots={parkingSlots}
                onSuccess={() => {
                    loadData();
                    fetchSyncMap();
                    setIsFormOpen(false);
                    setSelectedUser(null);
                    setCreateInitialData(undefined);
                }}
            />

            <DeleteConfirmDialog
                id={userToDelete?.id || ""}
                open={!!userToDelete}
                onOpenChange={(open) => !open && setUserToDelete(null)}
                title="Eliminar Usuario"
                description={`¿Estás seguro de eliminar a ${userToDelete?.name}?`}
                onDelete={deleteUser}
                onSuccess={() => {
                    loadData();
                    setUserToDelete(null);
                }}
            />

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                    height: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </TooltipProvider>
    );
}
