"use client";

import { useEffect, useState } from "react";
import { getCredentials, deleteCredential } from "@/app/actions/credentials";
import { getUsers } from "@/app/actions/users";
import { CredentialFormDialog } from "@/components/CredentialFormDialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Car,
    ScanFace,
    User,
    Calendar,
    Search,
    Trash2,
    Shield,
    FileKey,
    DoorOpen,
    Plus,
    Pencil
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { cn } from "@/lib/utils";
import Image from "next/image";

export default function CredentialsPage() {
    const [credentials, setCredentials] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [filteredCredentials, setFilteredCredentials] = useState<any[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (!search) {
            setFilteredCredentials(credentials);
        } else {
            const lowerSearch = search.toLowerCase();
            setFilteredCredentials(credentials.filter(c =>
                c.value.toLowerCase().includes(lowerSearch) ||
                c.user.name.toLowerCase().includes(lowerSearch) ||
                c.user.unit?.name.toLowerCase().includes(lowerSearch)
            ));
        }
    }, [search, credentials]);

    async function loadData() {
        setLoading(true);
        try {
            const [credsData, usersData] = await Promise.all([getCredentials(), getUsers()]);
            setCredentials(credsData);
            setFilteredCredentials(credsData);
            setUsers(usersData);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id: string) {
        await deleteCredential(id);
        loadData();
    }

    return (
        <div className="p-6 space-y-6">
            <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-card/50 p-8 border border-border rounded-3xl shadow-lg backdrop-blur-xl">
                <div className="flex items-center gap-6">
                    <div className="p-4 bg-orange-500/10 rounded-2xl border border-orange-500/20 shadow-inner group transition-all hover:scale-110">
                        <FileKey className="text-orange-400 group-hover:rotate-[15deg] transition-transform duration-500" size={32} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">
                            Listas de Acceso
                        </h1>
                        <p className="text-sm text-muted-foreground font-medium">Gestión centralizada de credenciales (LPR y Biometría).</p>
                    </div>
                </div>

                <div className="flex gap-4">
                    <CredentialFormDialog users={users} onSuccess={loadData}>
                        <Button className="bg-orange-600 hover:bg-orange-700 text-foreground font-bold h-12 px-6 rounded-xl transition-all shadow-lg shadow-orange-900/20">
                            <Plus className="mr-2 h-5 w-5" /> Nueva Credencial
                        </Button>
                    </CredentialFormDialog>

                    <div className="relative w-full max-w-sm group">
                        <Search className="absolute left-3 top-3 text-muted-foreground group-focus-within:text-orange-400 transition-colors" size={18} />
                        <Input
                            placeholder="Buscar por placa, nombre o unidad..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 h-12 bg-card border-border rounded-xl focus:ring-2 focus:ring-orange-500/20 transition-all text-sm font-medium"
                        />
                    </div>
                </div>
            </header>

            <div className="border border-border rounded-3xl overflow-hidden bg-card shadow-lg">
                <Table>
                    <TableHeader className="bg-card/80">
                        <TableRow className="border-border hover:bg-transparent">
                            <TableHead className="text-muted-foreground font-bold tracking-widest py-5 pl-8">Tipo de Credencial</TableHead>
                            <TableHead className="text-muted-foreground font-bold tracking-widest">Valor / Identificador</TableHead>
                            <TableHead className="text-muted-foreground font-bold tracking-widest">Usuario Vinculado</TableHead>
                            <TableHead className="text-muted-foreground font-bold tracking-widest">Unidad</TableHead>
                            <TableHead className="text-muted-foreground font-bold tracking-widest text-right pr-8">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredCredentials.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-32 text-muted-foreground">
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="p-8 bg-card rounded-full border border-dashed border-border">
                                            <FileKey size={64} className="opacity-10" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-xl font-bold uppercase tracking-tight">No se encontraron credenciales</p>
                                            <p className="text-sm font-medium opacity-50">Intenta buscar con otros términos o registra nuevos usuarios.</p>
                                        </div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredCredentials.map((cred) => (
                            <TableRow key={cred.id} className="border-border hover:bg-accent transition-all group">
                                <TableCell className="pl-8 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className={cn(
                                            "w-10 h-10 rounded-xl flex items-center justify-center border",
                                            cred.type === 'PLATE'
                                                ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                                : "bg-purple-500/10 border-purple-500/20 text-purple-400"
                                        )}>
                                            {cred.type === 'PLATE' ? <Car size={18} /> : <ScanFace size={18} />}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                                {cred.type === 'PLATE' ? 'Patente LPR' : 'Biometría'}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                                ID: {cred.id.slice(0, 6)}
                                            </span>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {cred.type === 'PLATE' ? (
                                        <div className="inline-flex relative">
                                            <div className="h-8 bg-white text-black font-bold font-mono text-lg px-3 rounded flex items-center border-2 border-border tracking-wider shadow-sm select-all">
                                                {cred.value}
                                            </div>
                                            <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0c0c0c]" />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            {/* Assuming user face image path is consistent with value or fetched from user */}
                                            {cred.user.cara ? (
                                                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-purple-500/30 relative">
                                                    <Image src={cred.user.cara} alt="Face" fill sizes="40px" className="object-cover" />
                                                </div>
                                            ) : (
                                                <div className="px-3 py-1 rounded-lg bg-muted text-muted-foreground text-xs font-mono border border-border">
                                                    HASH: {cred.value.slice(0, 12)}...
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                                            <User size={14} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-foreground">{cred.user.name}</p>
                                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-border text-muted-foreground">
                                                {cred.user.role}
                                            </Badge>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {cred.user.unit ? (
                                        <div className="flex items-center gap-2 text-muted-foreground bg-card/50 px-2 py-1 rounded-lg w-fit border border-border">
                                            <DoorOpen size={12} />
                                            <span className="text-xs font-bold">{cred.user.unit.name}</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-muted-foreground italic">Sin unidad</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right pr-8">
                                    <div className="flex justify-end gap-2">
                                        <DeleteConfirmDialog
                                            id={cred.id}
                                            title={cred.value}
                                            description="Esta credencial será eliminada permanentemente y el usuario ya no podrá acceder mediante ella."
                                            onDelete={handleDelete}
                                            onSuccess={loadData}
                                        >
                                            <Button variant="ghost" size="icon" className="hover:bg-red-500/10 hover:text-red-400 text-muted-foreground transition-colors">
                                                <Trash2 size={18} />
                                            </Button>
                                        </DeleteConfirmDialog>

                                        <CredentialFormDialog credential={cred} users={users} onSuccess={loadData}>
                                            <Button variant="ghost" size="icon" className="hover:bg-blue-500/10 hover:text-blue-400 text-muted-foreground transition-colors">
                                                <Pencil size={18} />
                                            </Button>
                                        </CredentialFormDialog>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div >
    );
}
