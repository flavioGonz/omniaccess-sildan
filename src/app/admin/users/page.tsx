
"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { getUsers, deleteUser } from "@/app/actions/users";
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
import { UserFormDialog } from "@/components/UserFormDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { ExportUsersButton } from "@/components/ExportUsersButton";
import { ImportUsersDialog } from "@/components/ImportUsersDialog";
import { SyncToDevicesDialog } from "@/components/SyncToDevicesDialog";
import { cn } from "@/lib/utils";
import { TablaUsuarios, ROLES } from "@/components/users/TablaUsuarios";
import { Seek } from "@/components/ui/search";

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
    createdBy: string | null;
    apartment: string | null;
    accessTags: string[];
    createdAt: Date;
    updatedAt: Date;
    unitId: string | null;
    parkingSlotId: string | null;
    unit: any | null;
    credentials: any[];
    accessGroups: any[];
    vehicles: any[];
    [key: string]: any; // Allow additional properties
}

/* ROLE_LABELS se mudó a `TablaUsuarios` como `ROLES`, con los tonos del sistema en vez de
   siete colores inventados. Acá quedaba sólo porque la tabla vivía en esta página. */

/** Cuántas filas entran de una. Con la tabla midiendo su propio scroll, 40 llena una
 *  pantalla grande sin pedir la siguiente enseguida. */
const PAGINA = 40;

export default function UsersPage() {
    const [users, setUsers] = useState<UserWithRelations[]>([]);
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
            const [usersData, unitsData, groupsData, parkingData, devicesData] = await Promise.all([
                getUsers(),
                getUnits(),
                getAccessGroups(),
                getParkingSlots(),
                getDevices()
            ]);
            setUsers(usersData as UserWithRelations[]);
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
            <div className="relative h-full flex flex-col pt-0 pb-4 px-6 overflow-hidden bg-muted">
                {/* Compact Header Toolbar */}
                <div className="flex items-center justify-between py-4 border-b border-border bg-muted/40 -mx-6 px-6 mb-4">
                    <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg border border-border bg-muted">
                            <Users size={18} className="tono-accion" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-foreground">Gestión de Identidades</h1>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
                                {users.length} Registros Totales
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
                </div>

                {/* Los filtros se mudaron adentro del marco de la tabla: son SUS
                    controles, no una tira suelta que casualmente está encima. */}

                {/* La tabla de la aplicación, con los filtros adentro de su mismo marco. */}
                <TablaUsuarios
                    usuarios={aMostrar}
                    cargando={isLoading}
                    error={error}
                    alReintentar={() => { setError(null); loadData(); }}
                    hayMas={hayMas}
                    traerMas={() => setALaVista((n) => n + PAGINA)}
                    alAbrir={(u) => { setSelectedUser(u as any); setIsFormOpen(true); }}
                    alBorrar={(u) => setUserToDelete(u as any)}
                    barra={
                        <div className="flex items-center gap-2 px-2.5 py-2 overflow-x-auto omni-sin-barra">
                            <div className="shrink-0">
                                <Seek value={searchQuery} onChange={setSearchQuery}
                                    placeholder="Nombre, DNI, unidad o contacto" startOpen width={280} alto={34} />
                            </div>
                            <span className="w-px h-6 bg-border shrink-0 mx-0.5" />
                            {/* Un rol por vez: son excluyentes, así que es una elección y no
                                una lista de interruptores. Por eso van en píldora. */}
                            <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 border border-border/50 shrink-0">
                                <button type="button" onClick={() => setFilterRole(null)}
                                    className={cn("h-7 px-2.5 rounded-md text-[11.5px] font-semibold whitespace-nowrap transition-colors",
                                        filterRole === null ? "accion" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                    Todos
                                </button>
                                {Object.entries(ROLES).map(([clave, info]) => {
                                    const Ico = info.icono;
                                    return (
                                        <button key={clave} type="button" onClick={() => setFilterRole(clave)}
                                            className={cn("h-7 px-2.5 rounded-md text-[11.5px] font-semibold whitespace-nowrap transition-colors inline-flex items-center gap-1.5",
                                                filterRole === clave ? "accion" : "text-muted-foreground hover:text-foreground hover:bg-accent")}>
                                            <Ico size={12} />{info.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    }
                />
            </div>

            {/* Dialogs */}
            <UserFormDialog
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
