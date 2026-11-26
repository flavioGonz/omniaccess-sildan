/**
 * SNMP v2c, lo mínimo para PREGUNTAR (26/11): armar un GetRequest y leer su respuesta. Nico pidió
 * que el descubridor pueda «incluso SNMP para poder leer»: un switch, un router o un AP no hablan
 * ISAPI, pero casi todos contestan quiénes son por SNMP (sysDescr, sysObjectID, sysName).
 *
 * Por qué a mano y no una biblioteca: son unas decenas de líneas de BER, sólo GET, y así no se suma
 * una dependencia nueva al despliegue (el lab no corre `npm install` al aplicar un parche). Sólo
 * lectura: no hay SetRequest acá a propósito.
 */

export const OID = {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysObjectID: "1.3.6.1.2.1.1.2.0",
    sysName: "1.3.6.1.2.1.1.5.0",
} as const;

const largo = (n: number): number[] => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
const tlv = (tag: number, cuerpo: number[]): number[] => [tag, ...largo(cuerpo.length), ...cuerpo];

function entero(v: number): number[] {
    const b: number[] = [];
    let x = v;
    do { b.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0);
    if (b[0] & 0x80) b.unshift(0); // positivo: el bit alto no puede quedar prendido
    return tlv(0x02, b);
}

function oid(texto: string): number[] {
    const a = texto.replace(/^\./, "").split(".").map(Number);
    if (a.length < 2 || a.some((x) => !Number.isInteger(x) || x < 0)) throw new Error(`OID inválido: ${texto}`);
    const b = [40 * a[0] + a[1]];
    for (const n of a.slice(2)) {
        const p: number[] = [n & 0x7f];
        let x = Math.floor(n / 128);
        while (x > 0) { p.unshift((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
        b.push(...p);
    }
    return tlv(0x06, b);
}

/** El paquete de un GetRequest v2c con esas OID. */
export function armarGet(comunidad: string, oids: string[], requestId: number): Buffer {
    const vars = oids.flatMap((o) => tlv(0x30, [...oid(o), 0x05, 0x00]));
    const pdu = tlv(0xa0, [...entero(requestId), ...entero(0), ...entero(0), ...tlv(0x30, vars)]);
    return Buffer.from(tlv(0x30, [...entero(1), ...tlv(0x04, [...Buffer.from(comunidad, "utf8")]), ...pdu]));
}

type Nodo = { tag: number; ini: number; fin: number };
function leerNodo(b: Buffer, i: number): Nodo {
    const tag = b[i];
    let n = b[i + 1], ini = i + 2;
    if (n & 0x80) { const k = n & 0x7f; n = 0; for (let j = 0; j < k; j++) n = n * 256 + b[ini + j]; ini += k; }
    if (ini + n > b.length) throw new Error("respuesta SNMP cortada");
    return { tag, ini, fin: ini + n };
}
function hijos(b: Buffer, nodo: Nodo): Nodo[] {
    const out: Nodo[] = [];
    for (let i = nodo.ini; i < nodo.fin;) { const h = leerNodo(b, i); out.push(h); i = h.fin; }
    return out;
}
function leerEntero(b: Buffer, n: Nodo): number { let v = 0; for (let i = n.ini; i < n.fin; i++) v = v * 256 + b[i]; return v; }
function leerOid(b: Buffer, n: Nodo): string {
    const a = [Math.floor(b[n.ini] / 40), b[n.ini] % 40];
    let x = 0;
    for (let i = n.ini + 1; i < n.fin; i++) { x = x * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { a.push(x); x = 0; } }
    return a.join(".");
}

/** Lee la respuesta: { requestId, error, valores: { oid: texto } }. Lo que el equipo no tiene no figura. */
export function leerRespuesta(b: Buffer): { requestId: number; error: number; valores: Record<string, string> } {
    const raiz = leerNodo(b, 0);
    if (raiz.tag !== 0x30) throw new Error("no es SNMP");
    const [, , pdu] = hijos(b, raiz);
    if (!pdu || pdu.tag !== 0xa2) throw new Error("no es una respuesta SNMP");
    const [rid, err, , lista] = hijos(b, pdu);
    const valores: Record<string, string> = {};
    for (const vb of hijos(b, lista)) {
        const [o, v] = hijos(b, vb);
        const clave = leerOid(b, o);
        if (v.tag === 0x04) valores[clave] = b.subarray(v.ini, v.fin).toString("utf8").replace(/\0+$/, "").trim();
        else if (v.tag === 0x06) valores[clave] = leerOid(b, v);
        else if (v.tag === 0x02 || v.tag === 0x41 || v.tag === 0x42 || v.tag === 0x43) valores[clave] = String(leerEntero(b, v));
        // 0x05 NULL, 0x80 noSuchObject, 0x81 noSuchInstance, 0x82 endOfMibView: no hay valor.
    }
    return { requestId: leerEntero(b, rid), error: leerEntero(b, err), valores };
}
