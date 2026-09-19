import { getVehicles } from "@/app/actions/vehicles";
import { getUsers } from "@/app/actions/users";
import { VehicleList } from "@/components/vehicles/VehicleList";
import { Car } from "lucide-react";

export default async function VehiclesPage() {
  const { vehicles, total } = await getVehicles(0, 40);
  const users = await getUsers();

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden animate-in fade-in duration-500">
      <header className="px-8 py-6 border-b border-border bg-card/40 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span className="w-11 h-11 rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
            <Car size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vehículos</h1>
            <p className="text-sm text-muted-foreground mt-1">
              El padrón del barrio: cada matrícula y a quién pertenece
            </p>
          </div>
        </div>

        {/*
          Antes había dos cifras acá, «Total» y «Activos», y las dos mostraban el mismo
          número — porque «activos» no se calculaba: se imprimía el total en verde. Queda
          una sola, que es la única que se sabe. Cuántos están circulando lo dice la
          columna «Actividad», vehículo por vehículo, que es donde se puede verificar.
        */}
        <div className="text-right">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">En el padrón</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{total}</p>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-8 flex flex-col">
        <div className="bg-card/40 border border-border rounded-lg flex-1 flex flex-col overflow-hidden shadow-lg">
          <VehicleList initialVehicles={vehicles as any} initialTotal={total} users={users as any} />
        </div>
      </main>
    </div>
  );
}
