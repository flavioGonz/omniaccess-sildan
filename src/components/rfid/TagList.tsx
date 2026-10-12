"use client";

import { useState } from "react";
import { Tooltip } from "react-tooltip";
import { Credential, User, Unit } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Search, Plus, Edit, Trash2, UserPlus, UserMinus, X, CreditCard, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTag, assignTag, unassignTag, createTag, purgeTags } from "@/app/actions/tags";
import { CajonTag } from "@/components/rfid/CajonTag";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

type TagWithUser = Credential & {
    user: (User & { unit: Unit | null }) | null;
};

interface TagListProps {
    initialTags: TagWithUser[];
    users: User[];
}

export function TagList({ initialTags, users }: TagListProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [filter, setFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
    const [selectedTag, setSelectedTag] = useState<TagWithUser | null>(null);
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [newTagValue, setNewTagValue] = useState("");

    // Filter tags
    const filteredTags = initialTags.filter(tag => {
        const matchesSearch = tag.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (tag.user?.name && tag.user.name.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesFilter =
            filter === 'all' ? true :
                filter === 'assigned' ? (tag.userId && tag.userId !== "") :
                    (!tag.userId || tag.userId === "");

        return matchesSearch && matchesFilter;
    });

    const handleDelete = async (id: string) => {
        if (confirm("¿Estás seguro de eliminar este tag?")) {
            await deleteTag(id);
            window.location.reload();
        }
    };

    const handleAssign = async (tagId: string, userId: string) => {
        await assignTag(tagId, userId);
        setShowAssignDialog(false);
        setSelectedTag(null);
        window.location.reload();
    };

    const handleUnassign = async (tagId: string) => {
        if (confirm("¿Desasignar este tag del usuario?")) {
            await unassignTag(tagId);
            window.location.reload();
        }
    };

    const handleCreate = async () => {
        if (!newTagValue.trim()) {
            alert("Ingresa un valor para el tag");
            return;
        }
        await createTag({ value: newTagValue });
        setNewTagValue("");
        setShowCreateDialog(false);
        window.location.reload();
    };

    const handlePurge = async () => {
        if (confirm("⚠️ CUIDADO: ¿Estás seguro de que quieres ELIMINAR TODOS los tags del sistema? Esta acción no se puede deshacer.")) {
            const res = await purgeTags();
            if (res.success) {
                window.location.reload();
            } else {
                alert(res.error);
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <Input
                        placeholder="Buscar por tag o usuario..."
                        className="pl-10 bg-card border-border h-11 rounded-xl"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X size={15} />
                        </button>
                    )}
                </div>

                <div className="flex gap-2">
                    <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                        <SelectTrigger className="w-[180px] bg-card border-border">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="assigned">Asignados</SelectItem>
                            <SelectItem value="unassigned">Disponibles</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        onClick={handlePurge}
                        className="border-red-500/20 bg-red-500/5 text-red-500 hover:bg-red-500 hover:text-foreground"
                    >
                        <Trash2 size={16} className="mr-2" />
                        Purgar Datos
                    </Button>

                    <Button onClick={() => { setSelectedTag(null); setShowCreateDialog(true); }} className="bg-emerald-600 hover:bg-emerald-700">
                        <Plus size={16} className="mr-2" />
                        Nuevo Tag
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="border border-border/60 rounded-lg overflow-hidden bg-background/50">
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                    <table className="w-full">
                        <thead className="sticky top-0 z-10 bg-card">
                            <tr className="border-b border-border/60 bg-card/60">
                                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Tag / UID</th>
                                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Usuario Asignado</th>
                                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Unidad</th>
                                <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                                <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTags.map((tag, index) => (
                                <tr
                                    key={tag.id}
                                    onClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; setSelectedTag(tag); setShowAssignDialog(true); }}
                                    className="border-b border-border/50 last:border-0 hover:bg-foreground/[0.04] transition-colors group cursor-pointer"
                                                                    >
                                    {/* Tag Value */}
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center border border-border group-hover:border-emerald-500/30 transition-colors">
                                                <CreditCard size={16} className="text-muted-foreground group-hover:text-emerald-400 transition-colors" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-foreground font-mono tracking-wider">
                                                    {tag.value}
                                                </p>
                                                <p className="text-[10px] text-muted-foreground font-mono">
                                                    ID: {tag.id.slice(0, 8)}
                                                </p>
                                            </div>
                                        </div>
                                    </td>

                                    {/* User */}
                                    <td className="px-3 py-2">
                                        {tag.user && tag.userId ? (
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                                                    {tag.user.name.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-foreground">
                                                        {tag.user.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {tag.user.email || tag.user.phone}
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">Sin asignar</span>
                                        )}
                                    </td>

                                    {/* Unit */}
                                    <td className="px-3 py-2">
                                        {tag.user?.unit ? (
                                            <span className="text-sm text-muted-foreground">
                                                {tag.user.unit.name}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">-</span>
                                        )}
                                    </td>

                                    {/* Status */}
                                    <td className="px-3 py-2">
                                        {tag.userId && tag.userId !== "" ? (
                                            <Badge variant="default" className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                                ASIGNADO
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-[10px] font-bold bg-blue-500/10 text-blue-400 border-blue-500/20">
                                                DISPONIBLE
                                            </Badge>
                                        )}
                                    </td>

                                    {/* Actions */}
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-0.5">
                                            {tag.userId && tag.userId !== "" ? (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => handleUnassign(tag.id)}
                                                    className="h-7 w-7 rounded-md text-muted-foreground hover:bg-orange-500/10 hover:text-orange-400"
                                                    data-tooltip-id="tt-tags" data-tooltip-content="Liberar el tag (queda disponible)"
                                                >
                                                    <UserMinus size={15} />
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    onClick={() => {
                                                        setSelectedTag(tag);
                                                        setShowAssignDialog(true);
                                                    }}
                                                    className="h-7 w-7 rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
                                                    data-tooltip-id="tt-tags" data-tooltip-content="Asignar a una persona"
                                                >
                                                    <UserPlus size={15} />
                                                </Button>
                                            )}
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => handleDelete(tag.id)}
                                                data-tooltip-id="tt-tags" data-tooltip-content="Eliminar tag"
                                                className="h-7 w-7 rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                                            >
                                                <Trash2 size={15} />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Empty State */}
                    {filteredTags.length === 0 && (
                        <div className="py-20 text-center">
                            <CreditCard size={48} className="mx-auto text-muted-foreground mb-4 animate-pulse" />
                            <h3 className="text-lg font-bold text-foreground mb-2">
                                No se encontraron tags
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {searchTerm ? 'Intenta con otro término de búsqueda' : 'Agrega tu primer tag RFID'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Results Counter */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
                <p>
                    Mostrando <span className="font-bold text-foreground">{filteredTags.length}</span> de{' '}
                    <span className="font-bold text-foreground">{initialTags.length}</span> tags
                </p>
            </div>

            <Tooltip id="tt-tags" place="top" className="!text-[12px] !rounded-lg !z-[9999]" />

            {/* Alta / asignación en cajón */}
            <CajonTag open={showCreateDialog || showAssignDialog} onOpenChange={(v) => { if (!v) { setShowCreateDialog(false); setShowAssignDialog(false); } }}
                tag={showAssignDialog ? selectedTag : null} users={users} onListo={() => window.location.reload()} />
        </div>
    );
}
