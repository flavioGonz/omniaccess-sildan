import { getTags } from "@/app/actions/tags";
import { getUsers } from "@/app/actions/users";
import { TagList } from "@/components/rfid/TagList";
import { CreditCard } from "lucide-react";

export default async function RFIDPage() {
    const tags = await getTags();
    const users = await getUsers();

    const asignados = tags.filter((t) => t.userId).length;

    return (
        <div className="h-full flex flex-col bg-background overflow-hidden animate-in fade-in duration-500">
            <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                        <CreditCard size={20} />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Tags RFID</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Las tarjetas del barrio y de quién es cada una
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-8">
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Asignados</p>
                        <p className="text-2xl font-bold text-foreground tabular-nums">{asignados}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">En el cajón</p>
                        <p className="text-2xl font-bold text-muted-foreground tabular-nums">{tags.length - asignados}</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-hidden px-8 py-6 flex flex-col">
                {/* Sin tarjeta alrededor de la tabla: la tabla es la pantalla. El aire lo
                    pone el margen, no un borde. */}
                <div className="flex-1 flex flex-col min-h-0">
                    <TagList initialTags={tags as any} users={users as any} />
                </div>
            </main>
        </div>
    );
}
