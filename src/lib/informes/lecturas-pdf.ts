/**
 * El informe de lecturas en PDF (A4 vertical): portada, resumen con lo que se concluye, cada cámara,
 * OmniVision frente a la cámara, cómo se repartió en el tiempo, los casos para revisar (con los
 * recortes de la chapa si se piden) y el detalle.
 *
 * Se arma en el servidor y no en el navegador: un período largo son decenas de miles de capturas,
 * que no tiene sentido mandarle a la pantalla para que las vuelva a armar, y las fotos de los casos
 * están en el almacenamiento, donde el servidor llega directo.
 *
 * Decisiones de forma, para que no se discutan de nuevo:
 *  · color sólo donde dice algo (los tonos de estado de la interfaz); el resto, tinta y grises;
 *  · los números grandes van con su frase al lado: un 97 % suelto no dice de qué;
 *  · nada de sombras ni degradés: en papel se ven sucios;
 *  · el detalle del PDF tiene un tope; completo está en el Excel, y se dice.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { FilaLectura } from "@/lib/lecturas-camara";
import { COLOR, rgb, fotoChica, leerImagen, fuentesOutfit, type Marca } from "@/lib/informes/marca";
import { PASO_ROTULO, VISION_ROTULO, compararVision, pct, segundos, ZONA_INFORME, type InformeLecturas, type Metricas } from "@/lib/informes/lecturas-resumen";

const W = 210, H = 297, M = 16;
/** Filas del detalle en el PDF. Más que esto es un listado, no un informe: está entero en el Excel. */
const DETALLE_MAX = 250;

export type ParamsPdf = {
    informe: InformeLecturas; filas: FilaLectura[]; marca: Marca;
    desde: Date; hasta: Date; camaras: string[]; generadoPor: string; fotos: boolean;
};

const TONO_PASO: Record<string, string> = { coincide: COLOR.bien, variante: COLOR.info, distinta: COLOR.aviso, perdida: COLOR.mal, solo: COLOR.quieto };
const TONO_VISION: Record<string, string> = { coincide: COLOR.bien, variante: COLOR.info, rescate: COLOR.accion, distinta: COLOR.aviso, "no-leyo": COLOR.mal, "sin-camara": COLOR.grisClaro };

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-UY", { timeZone: ZONA_INFORME, ...o }).format(d);
const diaLargo = (d: Date) => fmt(d, { day: "numeric", month: "long", year: "numeric" });
const diaCorto = (d: Date) => fmt(d, { day: "2-digit", month: "2-digit", year: "numeric" });
const horaS = (iso: string) => fmt(new Date(iso), { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const n = (x: number) => x.toLocaleString("es-UY");

export async function informeLecturasPdf(p: ParamsPdf): Promise<Buffer> {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const f = await fuentesOutfit();
    doc.addFileToVFS("Outfit-Regular.ttf", f.regular); doc.addFont("Outfit-Regular.ttf", "Outfit", "normal");
    doc.addFileToVFS("Outfit-Bold.ttf", f.negrita); doc.addFont("Outfit-Bold.ttf", "Outfit", "bold");
    doc.setFont("Outfit", "normal");
    doc.setProperties({ title: "Informe de lecturas LPR", subject: "Cámara · OmniAccess · OmniVision", author: p.marca.empresa, creator: "OmniAccess" });

    const { informe: inf, marca } = p;
    // «22 al 28 de octubre de 2026» si es el mismo mes; si no, cada fecha entera.
    const mismoMes = fmt(p.desde, { month: "long", year: "numeric" }) === fmt(p.hasta, { month: "long", year: "numeric" });
    const periodo = mismoMes ? `${fmt(p.desde, { day: "numeric" })} al ${diaLargo(p.hasta)}` : `${diaLargo(p.desde)} al ${diaLargo(p.hasta)}`;

    // ── pequeñas piezas ──
    const color = (hex: string, que: "texto" | "relleno" | "linea" = "texto") => {
        const [r, g, b] = rgb(hex);
        if (que === "texto") doc.setTextColor(r, g, b); else if (que === "relleno") doc.setFillColor(r, g, b); else doc.setDrawColor(r, g, b);
    };
    const texto = (t: string | string[], x: number, y: number, o: { tam?: number; negrita?: boolean; col?: string; alinear?: "left" | "right" | "center"; espaciado?: number; ancho?: number } = {}) => {
        doc.setFont("Outfit", o.negrita ? "bold" : "normal"); doc.setFontSize(o.tam || 9.5); color(o.col || COLOR.texto);
        const lineas = o.ancho && typeof t === "string" ? doc.splitTextToSize(t, o.ancho) : t;
        doc.text(lineas, x, y, { align: o.alinear || "left", charSpace: o.espaciado || 0, lineHeightFactor: 1.35 });
        return Array.isArray(lineas) ? lineas.length : 1;
    };
    const rotulo = (t: string, x: number, y: number, col: string = COLOR.gris) => texto(t.toUpperCase(), x, y, { tam: 7, negrita: true, col, espaciado: 0.45 });
    const logoEn = (x: number, y: number, alto: number, claro: boolean) => {
        if (marca.logo) {
            const w = Math.min(alto * (marca.logo.w / marca.logo.h), 60);
            doc.addImage(marca.logo.png, "PNG", x, y, w, alto); return w;
        }
        // Sin logo cargado: la marca de OmniAccess dibujada (cuadro redondeado con el lente).
        color(claro ? "#ffffff" : COLOR.tinta, "linea"); doc.setLineWidth(alto * 0.09);
        doc.roundedRect(x, y, alto, alto, alto * 0.26, alto * 0.26, "S");
        doc.circle(x + alto / 2, y + alto / 2, alto * 0.2, "S");
        texto("OMNIACCESS", x + alto + 2.6, y + alto * 0.58, { tam: alto * 2.3, negrita: true, col: claro ? "#ffffff" : COLOR.tinta, espaciado: 0.5 });
        return alto + 2.6 + doc.getTextWidth("OMNIACCESS") + 5;
    };
    const conOpacidad = (o: number, dibujar: () => void) => { const G = (doc as any).GState; doc.setGState(new G({ opacity: o })); dibujar(); doc.setGState(new G({ opacity: 1 })); };

    // ══ PORTADA ══
    {
        const ALTO = 178;
        color(marca.primario, "relleno"); doc.rect(0, 0, W, ALTO, "F");
        if (marca.portada) {
            const foto = await fotoChica(marca.portada, 1600);
            if (foto) {
                const esc = Math.max(W / foto.w, ALTO / foto.h);
                doc.addImage(foto.jpg, "JPEG", (W - foto.w * esc) / 2, (ALTO - foto.h * esc) / 2, foto.w * esc, foto.h * esc);
                conOpacidad(0.72, () => { color(marca.primario, "relleno"); doc.rect(0, 0, W, ALTO, "F"); });
                color("#ffffff", "relleno"); doc.rect(0, ALTO, W, H - ALTO, "F");
            }
        } else {
            // Las líneas de lectura: arcos concéntricos desde la esquina, como el barrido de una cámara.
            conOpacidad(0.16, () => {
                color(COLOR.accionClaro, "linea"); doc.setLineWidth(0.35);
                for (let r = 30; r <= 200; r += 13) doc.circle(W + 20, -30, r, "S");
            });
            // Los arcos siguen de largo: lo de abajo se tapa con el blanco de la ficha.
            color("#ffffff", "relleno"); doc.rect(0, ALTO, W, H - ALTO, "F");
            color(COLOR.accion, "relleno"); doc.rect(0, ALTO - 2.2, W * 0.42, 2.2, "F");
        }
        logoEn(M, 20, 9, true);
        rotulo("Informe de lecturas LPR", M, 98, COLOR.accionClaro);
        texto(["Cámara, OmniAccess", "y OmniVision"], M, 112, { tam: 31, negrita: true, col: "#ffffff" });
        texto("Qué leyó cada cámara, qué le llegó a OmniAccess y qué releyó OmniVision, vehículo por vehículo.", M, 138, { tam: 11, col: "#cbd5e1", ancho: 140 });
        texto(periodo, M, 160, { tam: 13, negrita: true, col: "#ffffff" });

        // Los tres números de tapa, con su frase.
        const t = inf.total;
        const cifras: [string, string, string][] = [
            [n(t.pasos), "vehículos leídos", "por las cámaras en el período"],
            [pct(t.bienPct, 1), "llegaron bien", "a OmniAccess, con la misma chapa"],
            [pct(t.vision.aciertoPct, 1), "acierto de OmniVision", "frente a la lectura de la cámara"],
        ];
        const cw = (W - M * 2) / 3;
        cifras.forEach(([v, a, b], i) => {
            const x = M + i * cw;
            if (i) { color(COLOR.linea, "linea"); doc.setLineWidth(0.3); doc.line(x - 4, ALTO + 14, x - 4, ALTO + 36); }
            texto(v, x, ALTO + 25, { tam: 24, negrita: true, col: i === 1 ? COLOR.bien : i === 2 ? COLOR.accion : COLOR.tinta });
            texto(a, x, ALTO + 31.5, { tam: 9.5, negrita: true, col: COLOR.texto });
            texto(b, x, ALTO + 36, { tam: 8, col: COLOR.gris });
        });

        // La ficha del informe.
        let y = ALTO + 54;
        const ficha: [string, string][] = [
            ["Período", `${diaCorto(p.desde)} — ${diaCorto(p.hasta)}`],
            ["Cámaras", p.camaras.join(", ") || "Todas"],
            ["Generado", `${diaCorto(new Date())} ${fmt(new Date(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`],
            ["Preparado por", marca.preparadoPor || p.generadoPor],
            ...(marca.autorizadoPor ? [["Autorizado por", marca.autorizadoPor] as [string, string]] : []),
        ];
        for (const [k, v] of ficha) {
            rotulo(k, M, y);
            const l = texto(v, M + 38, y, { tam: 9.5, col: COLOR.texto, ancho: W - M * 2 - 38 });
            y += 6.5 + (l - 1) * 4.4;
        }
        texto(marca.empresa + (marca.contacto ? `  ·  ${marca.contacto}` : ""), M, H - 14, { tam: 8, col: COLOR.gris });
    }

    // ── páginas de contenido ──
    let y = 0;
    const nueva = () => { doc.addPage(); y = 34; };
    const espacio = (alto: number) => { if (y + alto > H - 20) nueva(); };
    /** `minimo`: lo que tiene que entrar con el título, para que no quede solo al pie de una página. */
    const seccion = (num: string, titulo: string, bajada?: string, minimo = 30) => {
        if (y > 40) y += 8;
        espacio(minimo);
        rotulo(num, M, y, COLOR.accion);
        texto(titulo, M, y + 7.5, { tam: 16, negrita: true, col: COLOR.tinta });
        y += 12;
        if (bajada) { const l = texto(bajada, M, y + 1, { tam: 9, col: COLOR.gris, ancho: W - M * 2 }); y += 4 + l * 4.2; }
        y += 3;
    };
    const tabla = (cabeza: string[], cuerpo: (string | number)[][], o: { anchos?: number[]; alinearNum?: number[]; tonos?: (fila: number, col: number) => string | null } = {}) => {
        autoTable(doc, {
            startY: y, head: [cabeza], body: cuerpo.map((r) => r.map(String)), margin: { left: M, right: M, top: 30, bottom: 20 },
            styles: { font: "Outfit", fontSize: 8.2, cellPadding: { top: 2.1, bottom: 2.1, left: 2.4, right: 2.4 }, textColor: rgb(COLOR.texto), lineColor: rgb(COLOR.linea), lineWidth: 0 },
            headStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.tinta), textColor: [255, 255, 255], fontSize: 7.8 },
            alternateRowStyles: { fillColor: rgb("#f7f8fa") },
            columnStyles: Object.fromEntries((o.anchos || []).map((w, i) => [i, { cellWidth: w, halign: (o.alinearNum || []).includes(i) ? "right" : "left" }])) as any,
            didParseCell: (d: any) => {
                if (d.section === "head" && (o.alinearNum || []).includes(d.column.index)) d.cell.styles.halign = "right";
                if (d.section === "body" && o.tonos) { const t = o.tonos(d.row.index, d.column.index); if (t) { d.cell.styles.textColor = rgb(t); d.cell.styles.fontStyle = "bold"; } }
            },
        });
        y = (doc as any).lastAutoTable.finalY + 8;
    };
    /** Una barra horizontal apilada: los segmentos en proporción, con el total a la derecha. */
    const barra = (etiqueta: string, segs: { v: number; col: string }[], x: number, ancho: number, total?: string) => {
        const suma = segs.reduce((a, s) => a + s.v, 0);
        texto(etiqueta, x, y + 3.6, { tam: 8.5, negrita: true, col: COLOR.texto });
        const bx = x + 46, bw = ancho - 46 - 20;
        color("#eef1f5", "relleno"); doc.roundedRect(bx, y, bw, 5, 1.2, 1.2, "F");
        let cx = bx;
        for (const s of segs) {
            if (!s.v || !suma) continue;
            const w = (s.v / suma) * bw;
            color(s.col, "relleno"); doc.rect(cx, y, Math.max(w, 0.4), 5, "F");
            cx += w;
        }
        if (total) texto(total, x + ancho, y + 3.8, { tam: 8.5, negrita: true, col: COLOR.texto, alinear: "right" });
        y += 8.5;
    };
    const leyenda = (items: { r: string; col: string }[]) => {
        let x = M;
        for (const it of items) {
            const ancho = 4.5 + (doc.setFont("Outfit", "normal"), doc.setFontSize(7.8), doc.getTextWidth(it.r)) + 6;
            if (x + ancho > W - M) { x = M; y += 4.8; }
            color(it.col, "relleno"); doc.roundedRect(x, y - 2.4, 3, 3, 0.6, 0.6, "F");
            texto(it.r, x + 4.5, y, { tam: 7.8, col: COLOR.gris });
            x += ancho;
        }
        y += 6;
    };
    const segPaso = (m: Metricas) => [
        { v: m.coincide, col: TONO_PASO.coincide }, { v: m.variante, col: TONO_PASO.variante }, { v: m.distinta, col: TONO_PASO.distinta },
        { v: m.perdida, col: TONO_PASO.perdida }, { v: m.solo, col: TONO_PASO.solo },
    ];
    const LEYENDA_PASO = (["coincide", "variante", "distinta", "perdida", "solo"] as const).map((k) => ({ r: PASO_ROTULO[k], col: TONO_PASO[k] }));
    const ORDEN_VISION = ["coincide", "variante", "rescate", "distinta", "no-leyo", "sin-camara"] as const;

    // ══ 1 · RESUMEN ══
    nueva();
    seccion("01 · Resumen", "Lo que dice el período", `Del ${periodo}. Un vehículo es un paso por la cámara: las capturas seguidas del mismo auto (la cámara dispara a cada segundo mientras lo ve).`);
    {
        const t = inf.total;
        const tiles: { v: string; r: string; d: string; col: string }[] = [
            { v: n(t.pasos), r: "Vehículos leídos", d: `${n(t.capturas)} capturas de la cámara`, col: COLOR.tinta },
            { v: pct(t.bienPct, 1), r: "Llegaron bien", d: `${n(t.bien)} con la chapa de la cámara`, col: COLOR.bien },
            { v: n(t.perdida), r: "No llegaron", d: `${pct(t.perdidaPct, 1)} de los vehículos`, col: t.perdida ? COLOR.mal : COLOR.tinta },
            { v: n(t.distinta), r: "Llegó otra chapa", d: "una que la cámara no leyó", col: t.distinta ? COLOR.avisoTexto : COLOR.tinta },
            { v: pct(t.vision.aciertoPct, 1), r: "Acierto OmniVision", d: `${n(t.vision.total)} relecturas`, col: COLOR.accion },
            { v: segundos(t.demoraMs), r: "Demora típica", d: "de la captura al evento", col: COLOR.tinta },
        ];
        const cw = (W - M * 2 - 8) / 3, ch = 22;
        tiles.forEach((k, i) => {
            const x = M + (i % 3) * (cw + 4), yy = y + Math.floor(i / 3) * (ch + 4);
            color(COLOR.superficie, "relleno"); doc.roundedRect(x, yy, cw, ch, 2.4, 2.4, "F");
            texto(k.v, x + 5, yy + 9.5, { tam: 17, negrita: true, col: k.col });
            texto(k.r, x + 5, yy + 15, { tam: 8.6, negrita: true, col: COLOR.texto });
            texto(k.d, x + 5, yy + 19, { tam: 7.6, col: COLOR.gris });
        });
        y += (ch + 4) * 2 + 6;
        rotulo("Lo que se concluye", M, y); y += 5;
        for (const h of inf.hallazgos) {
            espacio(10);
            color(COLOR.accion, "relleno"); doc.circle(M + 1.2, y - 1.1, 0.9, "F");
            const l = texto(h, M + 5, y, { tam: 9.5, col: COLOR.texto, ancho: W - M * 2 - 5 });
            y += 4.4 * l + 2.2;
        }
        y += 4;
        if (t.pasos || t.solo) {
            espacio(24);
            rotulo("Cómo terminó cada vehículo", M, y); y += 4;
            barra("Todas las cámaras", segPaso(t), M, W - M * 2, pct(t.bienPct, 0));
            leyenda(LEYENDA_PASO);
        }
    }

    // ══ 2 · POR CÁMARA ══
    seccion("02 · Por cámara", "Qué le llegó a OmniAccess de cada cámara", "Coincide: llegó la chapa que más leyó la cámara. Otra lectura: llegó una de sus otras lecturas del mismo paso. Sólo OmniAccess: el evento está y la cámara no lo registra.");
    tabla(["Cámara", "Vehículos", "Llegaron bien", "Otra lectura", "Otra chapa", "No llegaron", "Sólo OA", "Demora"],
        inf.camaras.map((c) => [c.nombre, n(c.m.pasos), pct(c.m.bienPct, 1), n(c.m.variante), n(c.m.distinta), n(c.m.perdida), n(c.m.solo), segundos(c.m.demoraMs)]),
        { anchos: [52, 18, 22, 18, 18, 18, 15, 17], alinearNum: [1, 2, 3, 4, 5, 6, 7], tonos: (r, c) => c === 5 && inf.camaras[r]?.m.perdida ? COLOR.mal : c === 4 && inf.camaras[r]?.m.distinta ? COLOR.avisoTexto : null });
    espacio(10 + inf.camaras.length * 8.5);
    for (const c of inf.camaras) barra(c.nombre.length > 24 ? c.nombre.slice(0, 23) + "…" : c.nombre, segPaso(c.m), M, W - M * 2, pct(c.m.bienPct, 0));
    leyenda(LEYENDA_PASO);

    // ══ 3 · OMNIVISION ══
    seccion("03 · OmniVision frente a la cámara", "Qué tan bien relee OmniVision", "OmniVision relee la foto de los eventos sin chapa y los de doble verificación. Acierto: de las veces que leyeron las dos, cuántas dieron la misma chapa (o una de las otras lecturas de la cámara). Rescate: leyó una chapa que la cámara no pudo leer.");
    {
        const filasV = inf.camaras.filter((c) => c.m.vision.total);
        if (!filasV.length) {
            const l = texto("En el período no hubo relecturas de OmniVision sobre estas cámaras.", M, y, { tam: 9.5, col: COLOR.gris, ancho: W - M * 2 }); y += l * 4.4 + 6;
        } else {
            tabla(["Cámara", "Relecturas", "Acierto", "Coincide", "Otra lectura", "Rescate", "Otra chapa", "No leyó", "Confianza"],
                filasV.map((c) => { const v = c.m.vision; return [c.nombre, n(v.total), pct(v.aciertoPct, 1), n(v.coincide), n(v.variante), n(v.rescate), n(v.distinta), n(v["no-leyo"]), v.confianzaMedia == null ? "—" : pct(v.confianzaMedia, 0)]; }),
                { anchos: [40, 21, 16, 16, 18, 16, 17, 15, 19], alinearNum: [1, 2, 3, 4, 5, 6, 7, 8], tonos: (r, c) => c === 6 && filasV[r]?.m.vision.distinta ? COLOR.avisoTexto : c === 5 && filasV[r]?.m.vision.rescate ? COLOR.accion : null });
            espacio(10 + filasV.length * 8.5);
            for (const c of [{ nombre: "Todas las cámaras", m: inf.total }, ...filasV]) {
                const v = c.m.vision;
                barra(c.nombre.length > 24 ? c.nombre.slice(0, 23) + "…" : c.nombre, ORDEN_VISION.map((k) => ({ v: v[k], col: TONO_VISION[k] })), M, W - M * 2, n(v.total));
            }
            leyenda(ORDEN_VISION.map((k) => ({ r: VISION_ROTULO[k], col: TONO_VISION[k] })));
        }
    }

    // ══ 4 · EN EL TIEMPO ══
    seccion("04 · En el tiempo", inf.porDia.length > 1 ? "Día por día y hora por hora" : "Hora por hora", "Las columnas son los vehículos; el color, cómo terminaron. Arriba de cada columna, el porcentaje que llegó bien.", 100);
    const columnas = (titulo: string, datos: { r: string; m: Metricas }[], alto: number) => {
        espacio(alto + 22);
        rotulo(titulo, M, y); y += 5;
        const x0 = M + 8, ancho = W - M * 2 - 8, max = Math.max(1, ...datos.map((d) => d.m.pasos + d.m.solo));
        const paso = ancho / datos.length, bw = Math.min(paso * 0.62, 14);
        // Guía de la escala (sólo el máximo: la columna dice el resto).
        color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(x0, y + alto, x0 + ancho, y + alto);
        texto(n(max), M, y + 2.5, { tam: 6.8, col: COLOR.grisClaro });
        datos.forEach((d, i) => {
            const cx = x0 + i * paso + (paso - bw) / 2;
            let base = y + alto;
            for (const s of segPaso(d.m)) {
                if (!s.v) continue;
                const h = (s.v / max) * alto;
                color(s.col, "relleno"); doc.rect(cx, base - h, bw, h, "F"); base -= h;
            }
            if (d.m.pasos && datos.length <= 31) texto(pct(d.m.bienPct, 0), cx + bw / 2, base - 1.4, { tam: 6.2, col: COLOR.gris, alinear: "center" });
            if (datos.length <= 31 || i % 2 === 0) texto(d.r, cx + bw / 2, y + alto + 4.2, { tam: 6.6, col: COLOR.gris, alinear: "center" });
        });
        y += alto + 10;
    };
    if (inf.porDia.length > 1) {
        columnas("Por día", inf.porDia.map((d) => ({ r: d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7), m: d.m })), 42);
    }
    columnas(inf.porDia.length > 1 ? "Por hora del día (todos los días juntos)" : "Por hora", inf.porHora.map((h) => ({ r: String(h.hora).padStart(2, "0"), m: h.m })), 42);
    leyenda(LEYENDA_PASO);

    // ══ 5 · CASOS PARA REVISAR ══
    seccion("05 · Casos para revisar", "Lo que no cerró",
        `Los vehículos que no llegaron, los que llegaron con otra chapa y los que OmniVision leyó distinto que la cámara. ${inf.casosTotal > inf.casos.length ? `Se muestran los ${inf.casos.length} más recientes de ${n(inf.casosTotal)}; todos están en el Excel.` : `Son ${n(inf.casosTotal)}.`}`, 60);
    if (!inf.casos.length) { texto("Ninguno: en el período todo lo que leyeron las cámaras llegó con la misma chapa.", M, y, { tam: 9.5, col: COLOR.gris }); y += 10; }
    const MOTIVO: Record<string, { r: string; col: string }> = { perdida: { r: "No llegó", col: COLOR.mal }, distinta: { r: "Llegó otra chapa", col: COLOR.aviso }, "vision-distinta": { r: "OmniVision leyó otra", col: COLOR.accion } };
    const chapaDibujo = (p: string | null | undefined, x: number, yy: number, apagada = false) => {
        if (!p) { texto("sin leer", x, yy + 4.6, { tam: 8, col: COLOR.grisClaro }); return; }
        doc.setFont("Outfit", "bold"); doc.setFontSize(9.5);
        const w = doc.getTextWidth(p) + p.length * 0.45 + 5;
        color(apagada ? COLOR.linea : COLOR.tinta, "linea"); doc.setLineWidth(0.45); color("#ffffff", "relleno");
        doc.roundedRect(x, yy, w, 6.4, 1.1, 1.1, "FD");
        texto(p, x + 2.5, yy + 4.5, { tam: 9.5, negrita: true, col: apagada ? COLOR.gris : COLOR.tinta, espaciado: 0.45 });
    };
    for (const caso of inf.casos) {
        const fl = caso.fila, ev = fl.eventos[0], mo = MOTIVO[caso.motivo];
        const fotoCam = p.fotos && ev?.chapaCamara ? await fotoChica(await leerImagen(ev.chapaCamara), 300) : null;
        const evV = fl.eventos.find((e) => e.vision);
        const fotoVis = p.fotos && evV?.vision?.chapa ? await fotoChica(await leerImagen(evV.vision.chapa), 300) : null;
        const alto = fotoCam || fotoVis ? 31 : 21;
        espacio(alto + 4);
        color(COLOR.superficie, "relleno"); doc.roundedRect(M, y, W - M * 2, alto, 2, 2, "F");
        color(mo.col, "relleno"); doc.rect(M, y, 1.4, alto, "F");
        texto(mo.r, M + 5, y + 5.5, { tam: 8, negrita: true, col: mo.col === COLOR.aviso ? COLOR.avisoTexto : mo.col });
        texto(`${diaCorto(new Date(fl.ts))} ${horaS(fl.ts)}`, M + 5, y + 10, { tam: 7.8, col: COLOR.gris });
        texto(fl.camara, M + 5, y + 14.2, { tam: 8.3, negrita: true, col: COLOR.texto, ancho: 38 });
        const cols = [M + 48, M + 48 + 44, M + 48 + 88];
        rotulo("Leyó la cámara", cols[0], y + 5.5);
        if (fl.cam) { chapaDibujo(fl.cam.plate, cols[0], y + 7.5); texto(`×${fl.cam.capturas}${fl.cam.variantes.length > 1 ? ` · ${fl.cam.variantes.slice(1, 3).map((v) => v.plate).join(", ")}` : ""}`, cols[0], y + 18, { tam: 7.2, col: COLOR.gris, ancho: 42 }); }
        else texto("no está en su registro", cols[0], y + 12, { tam: 8, col: COLOR.grisClaro });
        rotulo("Recibió OmniAccess", cols[1], y + 5.5);
        if (ev) { chapaDibujo(ev.plate && !/^(NO_LEIDA|UNKNOWN)$/i.test(ev.plate) ? ev.plate : null, cols[1], y + 7.5); texto(ev.decision === "DENY" ? "denegado" : "permitido", cols[1], y + 18, { tam: 7.2, col: ev.decision === "DENY" ? COLOR.mal : COLOR.bien }); }
        else texto("nada", cols[1], y + 12, { tam: 8.5, negrita: true, col: COLOR.mal });
        rotulo("Releyó OmniVision", cols[2], y + 5.5);
        if (evV?.vision) {
            chapaDibujo(evV.vision.estado === "LEIDA" ? evV.vision.plate : null, cols[2], y + 7.5, evV.vision.estado !== "LEIDA");
            const c = compararVision(fl, evV);
            texto(`${c ? VISION_ROTULO[c] : ""}${evV.vision.confianza != null ? ` · ${pct(evV.vision.confianza, 0)}` : ""}`, cols[2], y + 18, { tam: 7.2, col: COLOR.gris, ancho: 40 });
        } else texto("—", cols[2], y + 12, { tam: 8.5, col: COLOR.grisClaro });
        // Los recortes de la chapa, al pie de cada columna: el de la cámara y el de OmniVision.
        const recorte = (ft: Awaited<ReturnType<typeof fotoChica>>, x: number) => { if (!ft) return; const h = 8, w = Math.min(h * (ft.w / ft.h), 40); doc.addImage(ft.jpg, "JPEG", x, y + 20.5, w, h); };
        recorte(fotoCam, cols[1]); recorte(fotoVis, cols[2]);
        y += alto + 3;
    }

    // ══ 6 · DETALLE ══
    seccion("06 · Detalle", "Vehículo por vehículo", p.filas.length > DETALLE_MAX ? `Los ${DETALLE_MAX} más recientes de ${n(p.filas.length)}. El detalle completo está en el Excel del mismo informe.` : undefined);
    const det = p.filas.slice(0, DETALLE_MAX);
    tabla(["Fecha y hora", "Cámara", "Leyó la cámara", "Recibió OmniAccess", "OmniVision", "Resultado"],
        det.map((fl) => {
            const v = fl.eventos.find((e) => e.vision)?.vision;
            return [`${diaCorto(new Date(fl.ts)).slice(0, 5)} ${horaS(fl.ts)}`, fl.camara, fl.cam ? `${fl.cam.plate || "sin leer"} ×${fl.cam.capturas}` : "—",
                fl.eventos.map((e) => e.plate || "—").join(", ") || "nada", v ? (v.estado === "LEIDA" ? v.plate || "—" : "no leyó") : "—", PASO_ROTULO[fl.estado]];
        }),
        { anchos: [26, 42, 30, 32, 24, 24], tonos: (r, c) => (c === 5 ? (det[r]?.estado === "coincide" ? null : TONO_PASO[det[r]?.estado] === COLOR.aviso ? COLOR.avisoTexto : TONO_PASO[det[r]?.estado]) : null) });

    // ── encabezado y pie en cada página de contenido ──
    const total = doc.getNumberOfPages();
    for (let i = 2; i <= total; i++) {
        doc.setPage(i);
        logoEn(M, 13, 5.2, false);
        texto("Informe de lecturas LPR", W - M, 15.6, { tam: 8, negrita: true, col: COLOR.texto, alinear: "right" });
        texto(`${diaCorto(p.desde)} — ${diaCorto(p.hasta)}`, W - M, 19.4, { tam: 7.4, col: COLOR.gris, alinear: "right" });
        color(COLOR.linea, "linea"); doc.setLineWidth(0.3); doc.line(M, 23.5, W - M, 23.5);
        texto(`${marca.pie} · Generado con OmniAccess el ${diaCorto(new Date())}`, M, H - 9, { tam: 7, col: COLOR.grisClaro });
        texto(`Página ${i - 1} de ${total - 1}`, W - M, H - 9, { tam: 7, col: COLOR.grisClaro, alinear: "right" });
    }
    return Buffer.from(doc.output("arraybuffer"));
}
