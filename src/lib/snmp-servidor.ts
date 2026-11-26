import dgram from "dgram";
import { armarGet, leerRespuesta, OID } from "@/lib/snmp-mini";

/**
 * Preguntarle a un equipo quién es por SNMP v2c (puerto UDP 161). Sólo GET y con un tope corto:
 * un equipo sin SNMP no contesta nada (UDP no avisa), así que la espera es todo el costo.
 */
export type FichaSnmp = { descr: string | null; objectId: string | null; nombre: string | null };

export function preguntarSnmp(ip: string, comunidad: string, esperaMs = 1200): Promise<FichaSnmp | null> {
    return new Promise((listo) => {
        const s = dgram.createSocket("udp4");
        const id = Math.floor(Math.random() * 0x7fffffff);
        let fin = false;
        const cerrar = (r: FichaSnmp | null) => { if (fin) return; fin = true; clearTimeout(t); try { s.close(); } catch { } listo(r); };
        const t = setTimeout(() => cerrar(null), esperaMs);
        s.on("error", () => cerrar(null));
        s.on("message", (msg) => {
            try {
                const r = leerRespuesta(msg);
                if (r.requestId !== id) return;
                const v = r.valores;
                cerrar({ descr: v[OID.sysDescr]?.slice(0, 300) || null, objectId: v[OID.sysObjectID] || null, nombre: v[OID.sysName]?.slice(0, 120) || null });
            } catch { cerrar(null); }
        });
        try { s.send(armarGet(comunidad, [OID.sysDescr, OID.sysObjectID, OID.sysName], id), 161, ip); } catch { cerrar(null); }
    });
}
