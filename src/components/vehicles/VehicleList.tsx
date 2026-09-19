"use client";

import { useState, useEffect, useCallback } from "react";
import { Vehicle, User } from "@prisma/client";
import { History, Pencil, X } from "lucide-react";
import { Seek } from "@/components/ui/search";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Cargando, Vacio } from "@/components/ui/estados";
import { Estado, Matricula, Momento } from "@/components/ui/celdas";
import { TablaVehiculos, type VehiculoFila } from "./TablaVehiculos";
import { VehicleDialog } from "./VehicleDialog";
import { getVehicles, getVehicleHistory } from "@/app/actions/vehicles";

const PAGINA = 40;

interface VehicleListProps {
    initialVehicles: (Vehicle & { user: User })[];
    initialTotal: number;
    users: User[];
}

function useDebounce<T>(value: T, delay = 500): T {
    const [v, setV] = useState<T>(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return v;
}

export function VehicleList({ initialVehicles, initialTotal, users }: VehicleListProps) {
    const [vehiculos, setVehiculos] = useState<VehiculoFila[]>(initialVehicles as any);
    const [total, setTotal] = useState(initialTotal);
    const [busqueda, setBusqueda] = useState("");
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hayMas, setHayMas] = useState(initialVehicles.length < initialTotal);
    const [recargar, setRecargar] = useState(0);

    const [historialDe, setHistorialDe] = useState<VehiculoFila | null>(null);
    const [historial, setHistorial] = useState<any[]>([]);
    const [historialCargando, setHistorialCargando] = useState(false);
    const [foto, setFoto] = useState<string | null>(null);

    const termino = useDebounce(busqueda, 500);

    /** La primera tanda, y cada vez que cambia la búsqueda. */
    useEffect(() => {
        let vivo = true;
        (async () => {
            setCargando(true);
            const r = await getVehicles(0, PAGINA, termino);
            if (!vivo) return;
            setError(r.error ?? null);
            setVehiculos(r.vehicles as any);
            setTotal(r.total);
            setHayMas(!r.error && r.vehicles.length < r.total);
            setCargando(false);
        })();
        return () => { vivo = false; };
    }, [termino, recargar]);

    const traerMas = useCallback(async () => {
        if (cargando || !hayMas) return;
        setCargando(true);
        const r = await getVehicles(vehiculos.length, PAGINA, termino);
        setError(r.error ?? null);
        if (!r.error) {
            setVehiculos((prev) => {
                const juntos = [...prev, ...(r.vehicles as any[])];
                setHayMas(juntos.length < r.total);
                return juntos as any;
            });
            setTotal(r.total);
        }
        setCargando(false);
    }, [cargando, hayMas, vehiculos.length, termino]);

    /** El historial se pide recién cuando se abre la ventana, no antes. */
    useEffect(() => {
        if (!historialDe) { setHistorial([]); return; }
        let vivo = true;
        (async () => {
            setHistorialCargando(true);
            const r = await getVehicleHistory(historialDe.plate);
            if (!vivo) return;
            setHistorial((r as any).events || []);
            setHistorialCargando(false);
        })();
        return () => { vivo = false; };
    }, [historialDe]);

    const volverAPedir = useCallback(() => setRecargar((n) => n + 1), []);

    const editar = useCallback((v: VehiculoFila) => (
        <VehicleDialog
            users={users}
            vehicle={v as any}
            onSuccess={volverAPedir}
            trigger={
                <button type="button" title="Editar"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                    <Pencil size={13} />
                </button>
            }
        />
    ), [users, volverAPedir]);

    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <TablaVehiculos
                vehiculos={vehiculos}
                cargando={cargando}
                error={error}
                alReintentar={volverAPedir}
                hayMas={hayMas}
                traerMas={traerMas}
                total={total}
                alVerHistorial={setHistorialDe}
                alAbrirFoto={setFoto}
                alRecargar={volverAPedir}
                editar={editar}
                barra={
                    <div className="flex items-center justify-between gap-3 w-full">
                        <Seek value={busqueda} onChange={setBusqueda}
                            placeholder="Matrícula, propietario, marca o modelo"
                            startOpen width={320} alto={34} />
                        <VehicleDialog users={users} onSuccess={volverAPedir} />
                    </div>
                }
            />

            {/* Historial de pasos de esta matrícula. */}
            <Dialog open={!!historialDe} onOpenChange={(o) => !o && setHistorialDe(null)}>
                <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
                    <DialogHeader className="px-5 py-4 border-b border-border">
                        <DialogTitle className="flex items-center gap-2.5 text-[15px]">
                            <History size={16} className="text-muted-foreground" />
                            Historial de accesos
                            {historialDe && <Matricula p={historialDe.plate} />}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto p-3">
                        {historialCargando ? (
                            <Cargando texto="Buscando pasos…" />
                        ) : historial.length ? (
                            <ul className="divide-y divide-border">
                                {historial.map((e) => (
                                    <li key={e.id} className="flex items-center justify-between gap-4 px-2 py-2.5">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[13px] font-semibold truncate">
                                                    {e.location || e.device?.location || "Punto de acceso"}
                                                </span>
                                                <Estado tono={e.decision === "GRANT" ? "bien" : "mal"}>
                                                    {e.decision === "GRANT" ? "Abrió" : "Denegado"}
                                                </Estado>
                                            </div>
                                            <div className="text-[11px] text-muted-foreground truncate">
                                                {e.device?.name || "Dispositivo sin nombre"}
                                            </div>
                                        </div>
                                        <Momento t={e.timestamp} />
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <Vacio
                                icono={History}
                                titulo="Sin pasos registrados"
                                ayuda="Esta matrícula no tiene eventos de acceso guardados. Puede haber sido leída por las cámaras de calle sin llegar a abrir ninguna barrera."
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* El cuadro entero. */}
            {foto && (
                <div className="fixed inset-0 z-[200] bg-background/90 backdrop-blur-sm flex items-center justify-center p-8"
                    onClick={() => setFoto(null)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={foto.includes("?") ? `${foto}&w=1200` : `${foto}?w=1200`} alt=""
                        className="max-w-full max-h-full rounded-xl object-contain sombra-flotante"
                        onClick={(e) => e.stopPropagation()} />
                    <button type="button" onClick={() => setFoto(null)} title="Cerrar"
                        className="absolute top-5 right-5 w-9 h-9 rounded-full bg-card border border-border text-foreground flex items-center justify-center hover:bg-accent transition-colors">
                        <X size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
