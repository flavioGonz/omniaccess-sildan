/**
 * La trama de una central, partida en sus piezas para mostrarla explicada (22/10, Nico: «estilizala,
 * con negritas, colores y tooltips que expliquen qué es cada parte del tren de datos»).
 *
 * Dos familias, las mismas que lee el receptor:
 *  · SIA DC-09 (lib-dc09.js): CRC · largo · "ID" · secuencia · R receptor · L línea · #cuenta · [datos] · _hora.
 *    Cifrada, lo que va desde el corchete es AES: se dice, no se inventa qué hay adentro.
 *  · Salida a CMS de un receptor (lib-cms-salida.js): Sur-Gard «5015 182989E13001010» y la variante
 *    del IPC10 «15 2989 18 E130 01 U020».
 * Lo que no calza con ninguna queda en una sola pieza «sin reconocer»: mejor eso que una explicación falsa.
 * Sin dependencias: lo usa la pantalla.
 */

export type TonoParte = "control" | "protocolo" | "cuenta" | "evento" | "lugar" | "hora" | "cifrado" | "neutro";
export type ParteTrama = { texto: string; rotulo: string; ayuda: string; tono: TonoParte };

const Q: Record<string, string> = {
    E: "E — evento nuevo (en Contact ID, 1: alarma, apertura, falla)", R: "R — restauración o cierre (en Contact ID, 3)", P: "P — evento anterior que se repite (en Contact ID, 6)",
    "1": "1 — evento nuevo, apertura o alarma", "3": "3 — restauración o cierre", "6": "6 — evento anterior que se repite",
};

const p = (texto: string, rotulo: string, ayuda: string, tono: TonoParte): ParteTrama => ({ texto, rotulo, ayuda, tono });

/** Contact ID «Q EEE GG ZZZ» (con o sin espacios, zona con letra o sin). */
function partesCid(q: string, ev: string, gg: string, zz: string): ParteTrama[] {
    return [
        p(q, "Calificador", Q[q.toUpperCase()] || "Qué clase de evento es", "evento"),
        p(ev, "Código de evento", `Contact ID ${ev}: lo que pasó (130 robo, 120 pánico, 401 apertura/cierre por usuario, 301 corte de corriente, 602 prueba periódica…). Arriba está traducido.`, "evento"),
        p(gg, "Partición", "La partición (área) de la central. 00 = toda la central.", "lugar"),
        p(zz, "Zona o usuario", "En una alarma es la zona; en un armado o desarmado es el usuario (su código). 000 = la central misma. El IPC10 le pone una letra adelante.", "lugar"),
    ];
}

export function partesTrama(crudo: string | null | undefined): ParteTrama[] {
    const t = String(crudo || "").trim();
    if (!t) return [];

    // ── SIA DC-09 ──
    const dc = /^([0-9A-F]{4})(0[0-9A-F]{3})"(\*?)([A-Z-]+)"(\d{4})(R[0-9A-F]{1,6})?(L[0-9A-F]{1,6})?(#[0-9A-F]{3,16})(.*)$/i.exec(t);
    if (dc) {
        const [, crc, largo, ast, id, seq, rr, ll, cuenta, resto] = dc;
        const out: ParteTrama[] = [
            p(crc, "CRC", "Suma de control CRC-16 del mensaje. Si no coincide, el receptor contesta NAK: la trama llegó dañada.", "control"),
            p(largo, "Largo", `Largo del mensaje en hexadecimal: ${parseInt(largo, 16)} caracteres.`, "control"),
            p(`"${ast}${id}"`, "Protocolo", `${ast ? "El asterisco dice que viene CIFRADO (AES). " : "Sin asterisco: viene sin cifrar. "}${id === "SIA-DCS" ? "SIA-DCS: eventos en formato SIA." : id === "ADM-CID" ? "ADM-CID: eventos en Contact ID." : id === "NULL" ? "NULL: supervisión, «sigo vivo»." : id}`, "protocolo"),
            p(seq, "Secuencia", "Número de mensaje (0001–9999). Un reintento trae el mismo número: el receptor contesta ACK sin crear otro evento.", "control"),
        ];
        if (rr) out.push(p(rr, "Receptor", "Número de receptor que la central tiene configurado (R + hexa).", "control"));
        if (ll) out.push(p(ll, "Línea", "Número de línea o prefijo de cuenta (L + hexa).", "control"));
        out.push(p(cuenta, "Cuenta", "La cuenta de la central (#). Es la que identifica al abonado en OmniAccess.", "cuenta"));
        if (ast && resto.startsWith("[")) {
            out.push(p(resto, "Datos cifrados", "Desde el corchete el contenido viene cifrado con la clave AES de la cuenta. El receptor lo descifra con esa clave; lo que decía está traducido arriba.", "cifrado"));
            return out;
        }
        const datos = /^(\[[^\]]*\])(.*)$/.exec(resto);
        if (datos) {
            out.push(p(datos[1], "Datos", "El evento en sí, entre corchetes: «#cuenta|Nri1/BA003» en SIA o «#cuenta|1130 01 003» en Contact ID. Arriba está traducido.", "evento"));
            if (datos[2]) out.push(p(datos[2], "Hora de la central", "La hora en que la central dice que mandó el mensaje (_HH:MM:SS,MM-DD-AAAA, UTC). Si se aleja más de 40 s de la del servidor, se rechaza: protege contra mensajes grabados y reenviados.", "hora"));
        } else if (resto) out.push(p(resto, "Resto", "Lo que sigue a la cuenta.", "neutro"));
        return out;
    }

    // ── IPC10 «15 2989 18 E130 01 U020» ──
    const dg = /^([0-9A-F]{1,4})(\s+)([0-9A-F]{3,16})(\s+)(18|58|98)(\s+)([ERP136])(\d{3})(\s+)([0-9A-F]{2})(\s+)([A-Z]?[0-9A-F]{3})(.*)$/i.exec(t);
    if (dg) {
        const [, rg, s1, cuenta, s2, fmt, s3, q, ev, s4, gg, s5, zz, resto] = dg;
        return [
            p(rg, "Receptor y grupo", "Receptor ID y Group ID que tiene configurados el IPC10 (CMS Configuration).", "control"), p(s1, "", "", "neutro"),
            p(cuenta, "Cuenta", "La cuenta de la central en el receptor (Account#).", "cuenta"), p(s2, "", "", "neutro"),
            p(fmt, "Formato", fmt === "18" ? "18 = Contact ID." : `${fmt} = evento propio del receptor (IPC10).`, "protocolo"), p(s3, "", "", "neutro"),
            ...partesCid(q, ev, gg, zz).slice(0, 2), p(s4, "", "", "neutro"),
            partesCid(q, ev, gg, zz)[2], p(s5, "", "", "neutro"), partesCid(q, ev, gg, zz)[3],
            ...(resto ? [p(resto, "Agregado", "Lo que el receptor suma al final (Additional Field: número de serie, MAC…).", "neutro")] : []),
        ].filter((x) => x.texto);
    }

    // ── Sur-Gard «5015 182989E13001010» (y «Q015 58…» del propio IPC10) ──
    const sg = /^([0-9A-Z])([0-9A-F]{2})([0-9A-F]{1,3})(\s+)(18|58|98)([0-9A-F]{3,10}?)([ERP136])(\d{3})([0-9A-F]{2})([0-9A-F]{3})(.*)$/i.exec(t);
    if (sg) {
        const [, proto, rr, ll, s1, fmt, cuenta, q, ev, gg, zz, resto] = sg;
        return [
            p(proto, "Protocolo Sur-Gard", proto === "5" ? "5 = mensaje Contact ID de la salida de automatización Sur-Gard (MLR2)." : `${proto} = tipo de mensaje del receptor.`, "protocolo"),
            p(rr, "Receptor", "Número de receptor (Receiver ID del IPC10).", "control"),
            p(ll, "Línea", "Número de línea o grupo (Group ID del IPC10).", "control"), p(s1, "", "", "neutro"),
            p(fmt, "Formato", fmt === "18" ? "18 = Contact ID." : `${fmt} = evento propio del receptor.`, "protocolo"),
            p(cuenta, "Cuenta", "La cuenta de la central en el receptor (Account#).", "cuenta"),
            ...partesCid(q, ev, gg, zz),
            ...(resto ? [p(resto, "Agregado", "Lo que el receptor suma al final.", "neutro")] : []),
        ].filter((x) => x.texto);
    }

    return [p(t, "Sin reconocer", "Esta trama no tiene una forma conocida: se muestra tal cual llegó.", "neutro")];
}
