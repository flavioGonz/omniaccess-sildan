import { getTags } from "@/app/actions/tags";
import { getUsers } from "@/app/actions/users";
import { TagList } from "@/components/rfid/TagList";
import { CreditCard } from "lucide-react";

export default async function RFIDPage() {
    const tags = await getTags();
    const users = await getUsers();

    const assignedTags = tags.filter(t => t.userId && t.userId !== "");
    const unassignedTags = tags.filter(t => !t.userId || t.userId === "");

    return (
        <div className="p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between bg-card p-6 rounded-xl">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                        <CreditCard size={24} className="text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground tracking-tight uppercase">
                            Tags RFID
                        </h1>
                        <p className="text-sm text-muted-foreground font-medium mt-1">
                            Gestión de tarjetas y credenciales de acceso
                        </p>
                    </div>
                </div>

                {/* Stats */}
                <div className="flex gap-6">
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Total</p>
                        <p className="text-2xl font-bold text-foreground">{tags.length}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Asignados</p>
                        <p className="text-2xl font-bold text-emerald-400">{assignedTags.length}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Disponibles</p>
                        <p className="text-2xl font-bold text-blue-400">{unassignedTags.length}</p>
                    </div>
                </div>
            </div>

            <TagList initialTags={tags as any} users={users as any} />
        </div>
    );
}
