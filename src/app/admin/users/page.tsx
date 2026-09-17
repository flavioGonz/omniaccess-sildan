
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

const ROLE_LABELS: Record<string, { label: string, color: string, icon: any }> = {
    RESIDENT: { label: "Residente", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: UserCheck },
    VISITOR: { label: "Visitante", color: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: UserX },
    STAFF: { label: "Personal", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: Briefcase },
    PROVIDER: { label: "Proveedor", color: "bg-amber-500/10 text-amber-500 border-amber-500/20", icon: Truck },
    ADMIN: { label: "Admin", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: Shield },
    WHITELISTED: { label: "Lista Blanca", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: UserCheck },
    BLACKLISTED: { label: "Lista Negra", color: "bg-red-500/10 text-red-500 border-red-500/20", icon: ShieldAlert },
};

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
    const [createInitialData, setCreateInitialData] = useState<{ cara?: string; plate?: string } | undefined>(undefined);
    const observerTarget = useRef(null);
    const pageSize = 20; // Increased for denser view
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

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && !searchQuery && !filterRole && visibleUsers.length < users.length) {
                    handleLoadMore();
                }
            },
            { threshold: 0.1 }
        );
        if (observerTarget.current) observer.observe(observerTarget.current);
        return () => observer.disconnect();
    }, [visibleUsers, users, searchQuery, filterRole]);

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
            setVisibleUsers(usersData.slice(0, pageSize) as UserWithRelations[]);
        } catch (error) {
            console.error("Error loading data:", error);
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

    const handleLoadMore = () => {
        const nextBatch = users.slice(visibleUsers.length, visibleUsers.length + pageSize);
        if (nextBatch.length > 0) {
            setVisibleUsers(prev => [...prev, ...nextBatch]);
        }
    };

    const filteredUsers = users.filter(user => {
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

    const usersToDisplay = (searchQuery || filterRole) ? filteredUsers : visibleUsers;

    const getCredentialsInfo = (user: UserWithRelations) => {
        // Safe access helpers
        const creds = user.credentials || [];
        const hasFace = creds.some((c: any) => c.type === 'FACE') || !!user.cara;
        const tags = creds.filter((c: any) => c.type === 'TAG');
        const pins = creds.filter((c: any) => c.type === 'PIN');
        const plates = creds.filter((c: any) => c.type === 'PLATE').map((c: any) => c.value);

        // Merge with vehicle plates if distinct
        user.vehicles?.forEach((v: any) => {
            if (!plates.includes(v.plate)) plates.push(v.plate);
        });

        return { hasFace, tags, pins, plates };
    };

    return (
        <TooltipProvider>
            <div className="relative h-full flex flex-col pt-0 pb-4 px-6 overflow-hidden bg-muted">
                {/* Compact Header Toolbar */}
                <div className="flex items-center justify-between py-4 border-b border-border bg-muted/40 -mx-6 px-6 mb-4">
                    <div className="flex items-center gap-4">
                        <div className="bg-indigo-600/10 p-2 rounded-lg border border-indigo-600/20">
                            <Users size={18} className="text-indigo-400" />
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
                            className="h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-foreground text-xs font-bold uppercase tracking-wide rounded-md ml-2 border border-border shadow-lg shadow-indigo-500/10"
                        >
                            <Plus size={14} className="mr-2" />
                            Nuevo
                        </Button>
                    </div>
                </div>

                {/* Filters & Search - Ultra Compact */}
                <div className="flex items-center gap-3 mb-4">
                    <div className="relative flex-1 max-w-sm group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-indigo-400 transition-colors" size={13} />
                        <Input
                            placeholder="Buscar usuario, DNI, unidad..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-8 bg-card border-border focus:border-indigo-500/30 text-xs rounded-md transition-all"
                        />
                    </div>

                    <div className="h-4 w-px bg-foreground/10" />

                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFilterRole(null)}
                            className={cn(
                                "h-6 px-3 text-[10px] font-bold uppercase tracking-wider rounded-full border transition-all",
                                filterRole === null ? "bg-white text-black border-white" : "text-muted-foreground border-transparent hover:bg-accent"
                            )}
                        >
                            Todos
                        </Button>
                        {Object.entries(ROLE_LABELS).map(([key, info]) => {
                            const RoleIcon = info.icon;
                            return (
                                <Button
                                    key={key}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setFilterRole(key)}
                                    className={cn(
                                        "h-6 px-3 text-[10px] font-bold uppercase tracking-wider rounded-full border transition-all flex items-center gap-1.5",
                                        filterRole === key
                                            ? cn(info.color, "bg-opacity-10 border-opacity-30")
                                            : "text-muted-foreground border-transparent hover:bg-accent"
                                    )}
                                >
                                    <RoleIcon size={12} />
                                    {info.label}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                {/* Dense Table — tabla nativa para que el ENCABEZADO quede sticky
                    contra este contenedor de scroll (el <Table> de shadcn envuelve en
                    un div overflow-auto propio que rompía el sticky). */}
                <div className="flex-1 border border-border rounded-lg overflow-auto custom-scrollbar bg-card/40 relative">
                    <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-20">
                            <tr className="bg-card shadow-sm [&>th]:border-b [&>th]:border-border [&>th]:h-11 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-muted-foreground [&>th]:bg-card">
                                <th className="w-[300px] text-left px-4">Identidad</th>
                                <th className="w-[130px] text-left px-2">Unidad / DNI</th>
                                <th className="w-[130px] text-center px-2">Matrículas</th>
                                <th className="w-[130px] text-center px-2">RFID / Tags</th>
                                <th className="w-[90px] text-center px-2">PIN Code</th>
                                <th className="w-[80px] text-center px-2">Biometría</th>
                                <th className="text-right px-4">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="h-32 text-center text-xs text-muted-foreground">
                                        <Loader2 className="animate-spin inline-block mr-2" size={14} /> Cargando registros...
                                    </td>
                                </tr>
                            ) : usersToDisplay.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="h-32 text-center text-xs text-muted-foreground uppercase tracking-widest">
                                        Sin resultados
                                    </td>
                                </tr>
                            ) : (
                                <>
                                    {usersToDisplay.map((user) => {
                                        const roleInfo = ROLE_LABELS[user.role] || ROLE_LABELS.RESIDENT;
                                        const { hasFace, tags, pins, plates } = getCredentialsInfo(user);

                                        return (
                                            <tr
                                                key={user.id}
                                                onClick={() => { setSelectedUser(user); setIsFormOpen(true); }}
                                                className="border-b border-border hover:bg-foreground/[0.05] group transition-colors cursor-pointer"
                                                title="Ver / editar usuario"
                                            >
                                                {/* IDENTITY + CONTACTO visible */}
                                                <td className="py-2.5 px-4 align-middle">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center border border-border overflow-hidden shrink-0">
                                                            {user.cara ? (
                                                                <img src={user.cara} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <span className="text-[10px] font-bold text-muted-foreground">{user.name.charAt(0)}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs font-medium text-foreground truncate max-w-[150px]">{user.name}</span>
                                                                <Badge variant="outline" className={cn("text-[8px] h-3.5 px-1 rounded-[3px] border-0 capitalize font-bold", roleInfo.color)}>
                                                                    {roleInfo.label.toLowerCase()}
                                                                </Badge>
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                                                                {user.phone ? (
                                                                    <span className="flex items-center gap-1 truncate"><Phone size={9} className="shrink-0" /> {user.phone}</span>
                                                                ) : null}
                                                                {user.email ? (
                                                                    <span className="flex items-center gap-1 truncate max-w-[180px]"><Mail size={9} className="shrink-0" /> {user.email}</span>
                                                                ) : null}
                                                                {!user.phone && !user.email && <span className="italic opacity-60">Sin contacto</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* UNIT / DNI */}
                                                <td className="py-2.5 px-2 align-middle">
                                                    <div className="flex flex-col">
                                                        {user.unit ? (
                                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                                <MapPin size={10} className="text-muted-foreground" />
                                                                <span className="text-[10px] font-bold">{user.unit.name}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] text-muted-foreground italic">--</span>
                                                        )}
                                                        <div className="flex items-center gap-1.5 text-muted-foreground mt-0.5">
                                                            <Hash size={9} />
                                                            <span className="text-[9px] font-mono">{user.dni || "S/DNI"}</span>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* PLATES (LPR) */}
                                                <td className="py-2.5 px-2 text-center align-middle">
                                                    {plates.length > 0 ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            {plates.slice(0, 1).map((p: string) => (
                                                                <div key={p} className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20 max-w-[120px]">
                                                                    <span className="font-mono text-[9px] font-bold text-blue-400 truncate">{p}</span>
                                                                </div>
                                                            ))}
                                                            {plates.length > 1 && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="text-[9px] text-muted-foreground cursor-help">+{plates.length - 1} más</span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent className="bg-black border-border p-2">
                                                                        <div className="space-y-1">
                                                                            {plates.map((p: string) => (
                                                                                <div key={p} className="flex items-center gap-2 bg-foreground/10 px-2 py-1 rounded border border-border">
                                                                                    <div className="w-1 h-1 rounded-full bg-blue-500" />
                                                                                    <span className="font-mono text-xs text-blue-200">{p}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>

                                                {/* RFID / TAGS */}
                                                <td className="py-2.5 px-2 text-center align-middle">
                                                    {tags.length > 0 ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            {tags.slice(0, 1).map((t: any) => (
                                                                <div key={t.id} className="flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 max-w-[120px]">
                                                                    <span className="font-mono text-[9px] font-bold text-emerald-400 truncate">{t.value}</span>
                                                                </div>
                                                            ))}
                                                            {tags.length > 1 && (
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <span className="text-[9px] text-muted-foreground cursor-help">+{tags.length - 1} más</span>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent className="bg-black border-border p-2">
                                                                        <div className="space-y-1">
                                                                            {tags.map((t: any) => (
                                                                                <div key={t.id} className="font-mono text-xs text-emerald-200 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                                                                    {t.value}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>

                                                {/* PIN CODE */}
                                                <td className="py-2.5 px-2 text-center align-middle">
                                                    {pins.length > 0 ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            {pins.slice(0, 1).map((p: any) => (
                                                                <div key={p.id} className="flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                                    <span className="font-mono text-[9px] font-bold text-amber-500 tracking-widest">{p.value}</span>
                                                                </div>
                                                            ))}
                                                            {pins.length > 1 && (
                                                                <span className="text-[9px] text-muted-foreground">+{pins.length - 1}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>

                                                {/* BIOMETRY */}
                                                <td className="py-2.5 px-2 text-center align-middle">
                                                    {hasFace ? (
                                                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400" title="Rostro enrolado">
                                                            <ScanFace size={12} />
                                                        </div>
                                                    ) : (
                                                        <div className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-foreground/10 border border-border text-muted-foreground">
                                                            <ScanFace size={12} />
                                                        </div>
                                                    )}
                                                </td>

                                                {/* ACTIONS */}
                                                <td className="py-2.5 px-4 text-right align-middle">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => { e.stopPropagation(); setSelectedUser(user); setIsFormOpen(true); }}
                                                            className="h-7 w-7 p-0 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                                            title="Editar"
                                                        >
                                                            <Edit size={12} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => { e.stopPropagation(); setUserToDelete(user); }}
                                                            className="h-7 w-7 p-0 rounded-md hover:bg-red-900/20 text-muted-foreground hover:text-red-400"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 size={12} />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Sentinel for Infinite Scroll */}
                                    {!isLoading && !searchQuery && !filterRole && visibleUsers.length < users.length && (
                                        <tr>
                                            <td colSpan={7} className="p-0 border-0">
                                                <div ref={observerTarget} className="h-10 w-full flex items-center justify-center">
                                                    <Loader2 className="animate-spin text-muted-foreground" size={14} />
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
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
