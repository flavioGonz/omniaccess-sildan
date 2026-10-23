/**
 * Los drivers de centrales de alarma (Alarm Hub). openspec/changes/alarm-hub-sia-dc09, D7.
 *
 * El RECEPTOR es uno solo y habla DC-09 con cualquier central (alarm-receiver.js). Lo que cambia por
 * marca es lo de afuera del protocolo: escribirle a la central a dónde reportar («vincular»), leer
 * sus zonas y su estado, y armar o desarmar. Una central «genérica» no tiene nada de eso: se le
 * cargan los datos a mano y reporta igual.
 */
export type ModeloCentral = "generica" | "ax-pro" | "ax-hybrid";

export type DestinoReceptor = { direccion: string; puerto: number; cuenta: string; clave: string | null; protocolo: "SIA-DCS" | "ADM-CID"; supervisionSeg: number; transporte: "udp" | "tcp" };

export type ZonaLeida = { zona: number; particion: number | null; nombre: string | null; tipo: string | null; estado?: string | null };
export type EstadoParticion = { id: number; nombre: string | null; estado: "ausente" | "presente" | "desarmada" | "alarma" | "desconocido" };
export type EstadoCentral = { particiones: EstadoParticion[]; zonas: ZonaLeida[] };

/** Lo que el driver necesita del equipo para hablarle por ISAPI. */
export type EquipoCentral = { id: string; name: string; ip: string; httpPort?: number | null; username: string | null; password: string | null; authType?: string | null };

export type Resultado = { ok: true; detalle?: string } | { ok: false; error: string };

export interface DriverCentral {
    modelo: ModeloCentral;
    nombre: string;
    /** Falso hasta probarlo con un equipo real: la pantalla lo dice. */
    probado: boolean;
    /** Lo que se le pide al instalador antes de vincular. */
    ayudaAlta: string;
    vincular?(e: EquipoCentral, d: DestinoReceptor, probar?: boolean): Promise<Resultado & { actual?: unknown }>;
    zonas?(e: EquipoCentral): Promise<ZonaLeida[]>;
    estado?(e: EquipoCentral): Promise<EstadoCentral>;
    armar?(e: EquipoCentral, particion: number, modo: "ausente" | "presente"): Promise<Resultado>;
    desarmar?(e: EquipoCentral, particion: number): Promise<Resultado>;
}
