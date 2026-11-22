/**
 * Los reportes de rastreo en PDF (A4 apaisado): una cabecera con las cifras del período y después
 * cada reporte, como una tabla.
 *
 * Apaisado porque son tablas anchas —un viaje tiene doce columnas— y en vertical habría que
 * achicar la letra hasta que no se lea o partir cada renglón en dos.
 *
 * Lo mismo que el informe de lecturas, para que no se discuta de nuevo: color sólo donde dice algo;
 * nada de sombras ni degradés, que en papel se ven sucios; y el PDF tiene tope de filas por tabla —
 * más que eso es un listado, no un informe, y está entero en el Excel. Cuando se corta, se dice.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COLOR, rgb, fuentesOutfit, type Marca } from "@/lib/informes/marca";
import { duracionDeReporte, esNumero, textoDeCelda, type TablaReporte } from "@/lib/gps-reportes-catalogo";
import { periodoEnPalabras, vehiculosEnPalabras, type ReporteGps } from "@/lib/gps-reportes-servidor";

const W = 297, H = 210, M = 12;
/** Filas por tabla en el PDF. */
export const PDF_FILAS_MAX = 400;

export async function reporteGpsPdf(r: ReporteGps, marca: Marca, generadoPor: string): Promise<Buffer> {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const f = await fuentesOutfit();
    doc.addFileToVFS("Outfit-Regular.ttf", f.regular); doc.addFont("Outfit-Regular.ttf", "Outfit", "normal");
    doc.addFileToVFS("Outfit-Bold.ttf", f.negrita); doc.addFont("Outfit-Bold.ttf", "Outfit", "bold");
    doc.setFont("Outfit", "normal");
    doc.setProperties({ title: "Reporte de rastreo", subject: periodoEnPalabras(r), author: marca.empresa, creator: "OmniAccess" });

    const color = (hex: string, que: "texto" | "relleno" | "linea" = "texto") => {
        const [a, b, c] = rgb(hex);
        if (que === "texto") doc.setTextColor(a, b, c); else if (que === "relleno") doc.setFillColor(a, b, c); else doc.setDrawColor(a, b, c);
    };
    const texto = (t: string, x: number, y: number, o: { tam?: number; negrita?: boolean; col?: string; alinear?: "left" | "right"; espaciado?: number; ancho?: number } = {}) => {
        doc.setFont("Outfit", o.negrita ? "bold" : "normal"); doc.setFontSize(o.tam || 9); color(o.col || COLOR.texto);
        const lineas: string[] = o.ancho ? doc.splitTextToSize(t, o.ancho) : [t];
        doc.text(lineas, x, y, { align: o.alinear || "left", charSpace: o.espaciado || 0, lineHeightFactor: 1.35 });
        return lineas.length;
    };
    const rotulo = (t: string, x: number, y: number, col: string = COLOR.gris) => texto(t.toUpperCase(), x, y, { tam: 6.6, negrita: true, col, espaciado: 0.4 });

    /* ── La cabecera: de quién, de cuándo, y las cifras ── */
    color(marca.primario, "relleno"); doc.rect(0, 0, W, 30, "F");
    if (marca.logo) {
        const alto = 9, ancho = Math.min(alto * (marca.logo.w / marca.logo.h), 60);
        doc.addImage(marca.logo.png, "PNG", W - M - ancho, 10.5, ancho, alto);
    } else texto("OMNIACCESS", W - M, 17, { tam: 13, negrita: true, col: "#ffffff", alinear: "right", espaciado: 0.5 });
    rotulo("Reporte de rastreo satelital", M, 11, COLOR.accionClaro);
    texto(r.vehiculos.length === 1 ? r.vehiculos[0].nombre + (r.vehiculos[0].matricula ? ` · ${r.vehiculos[0].matricula}` : "") : `Flota · ${r.vehiculos.length} vehículos`, M, 19, { tam: 17, negrita: true, col: "#ffffff" });
    texto(periodoEnPalabras(r), M, 25, { tam: 9.5, col: "#cbd5e1" });

    const t = r.totales;
    const cifras: [string, string, string?][] = [
        [t.km.toFixed(1).replace(".", ",") + " km", "recorridos"], [String(t.viajes), t.viajes === 1 ? "viaje" : "viajes"], [duracionDeReporte(t.andandoMin), "andando"],
        [t.ralentiMin === null ? "—" : duracionDeReporte(t.ralentiMin), "en ralentí"], [t.velMax ? `${t.velMax} km/h` : "—", "velocidad máxima"],
        [String(t.excesos), t.excesos === 1 ? "exceso de velocidad" : "excesos de velocidad", t.excesos ? COLOR.mal : undefined], [String(t.alarmas), t.alarmas === 1 ? "alarma" : "alarmas", t.alarmas ? COLOR.aviso : undefined],
    ];
    const cw = (W - M * 2) / cifras.length;
    cifras.forEach(([v, que, tono], i) => {
        const x = M + i * cw;
        if (i) { color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(x - 3, 36, x - 3, 49); }
        texto(v, x, 42.5, { tam: 15, negrita: true, col: tono || COLOR.tinta });
        texto(que, x, 47.5, { tam: 8, col: COLOR.gris });
    });
    let y = 56;
    const ficha = [
        r.vehiculos.length > 1 ? `Vehículos: ${vehiculosEnPalabras(r)}` : null,
        `Velocidad permitida: ${r.limite} km/h`, r.horarioRotulo ? `Horario laboral: ${r.horarioRotulo}` : null,
        r.recortado ? "El período pedido era más largo que un mes: se recortó desde su comienzo." : null,
    ].filter(Boolean).join("   ·   ");
    y += texto(ficha, M, y, { tam: 8, col: COLOR.gris, ancho: W - M * 2 }) * 3.8 + 3;
    color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(M, y, W - M, y);
    y += 8;

    /* ── Cada reporte ── */
    const enPdf = r.tablas.filter((x) => x.clave !== "posiciones");
    const tabla = (x: TablaReporte) => {
        if (y > H - 46) { doc.addPage(); y = 20; }
        texto(x.titulo, M, y, { tam: 12.5, negrita: true, col: COLOR.tinta });
        const cuantas = x.filasTotales > PDF_FILAS_MAX ? `Las primeras ${PDF_FILAS_MAX} de ${x.filasTotales.toLocaleString("es-UY")} filas: completo en el Excel.` : x.filasTotales ? `${x.filasTotales.toLocaleString("es-UY")} ${x.filasTotales === 1 ? "fila" : "filas"}` : "";
        if (cuantas) texto(cuantas, W - M, y, { tam: 7.5, col: x.filasTotales > PDF_FILAS_MAX ? COLOR.avisoTexto : COLOR.grisClaro, alinear: "right" });
        y += 4.4;
        y += texto(x.nota || x.ayuda, M, y, { tam: 7.8, col: COLOR.gris, ancho: W - M * 2 }) * 3.6;
        if (!x.filas.length) {
            color(COLOR.superficie, "relleno"); doc.roundedRect(M, y, W - M * 2, 10, 1.5, 1.5, "F");
            texto(x.vacio, M + 4, y + 6.2, { tam: 8.5, col: COLOR.gris });
            y += 18;
            return;
        }
        const numeros = x.columnas.map((c) => esNumero(c.formato));
        const peso = x.columnas.reduce((a, c) => a + c.ancho, 0);
        autoTable(doc, {
            startY: y + 1, margin: { left: M, right: M, top: 18, bottom: 16 },
            head: [x.columnas.map((c) => c.rotulo)],
            body: x.filas.slice(0, PDF_FILAS_MAX).map((fila) => x.columnas.map((c, i) => textoDeCelda(c.formato, fila[i]))),
            foot: x.total ? [x.columnas.map((c, i) => textoDeCelda(c.formato, x.total![i], ""))] : undefined,
            showFoot: "lastPage",
            styles: { font: "Outfit", fontSize: 7.6, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: rgb(COLOR.texto), lineWidth: 0, overflow: "linebreak" },
            headStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.tinta), textColor: [255, 255, 255], fontSize: 7.2 },
            footStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.superficie), textColor: rgb(COLOR.tinta), fontSize: 7.6 },
            alternateRowStyles: { fillColor: rgb("#f7f8fa") },
            /* Los anchos salen de los de la planilla, en proporción: una sola idea de qué columna es ancha. */
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos de autotable no admiten un mapa armado así
            columnStyles: Object.fromEntries(x.columnas.map((c, i) => [i, { cellWidth: ((W - M * 2) * c.ancho) / peso, halign: numeros[i] ? "right" : "left" }])) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            didParseCell: (d: any) => {
                if (numeros[d.column.index]) d.cell.styles.halign = "right";
                /* Lo único que lleva color: cuánto se pasó del límite. */
                if (d.section === "body" && x.clave === "excesos" && x.columnas[d.column.index].rotulo === "Sobre el límite") { d.cell.styles.textColor = rgb(COLOR.mal); d.cell.styles.fontStyle = "bold"; }
                if (d.section === "body" && d.cell.raw === "Fuera de horario") { d.cell.styles.textColor = rgb(COLOR.avisoTexto); d.cell.styles.fontStyle = "bold"; }
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 11;
    };
    enPdf.forEach(tabla);
    if (r.tablas.some((x) => x.clave === "posiciones")) {
        if (y > H - 26) { doc.addPage(); y = 20; }
        texto("El detalle de posiciones no va en el PDF: es un listado de miles de renglones. Está en el Excel.", M, y, { tam: 8.5, col: COLOR.gris });
    }

    /* ── El pie de cada página ── */
    const paginas = doc.getNumberOfPages();
    const emitido = new Intl.DateTimeFormat("es-UY", { timeZone: r.zona, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(r.generado)).replace(",", "");
    for (let i = 1; i <= paginas; i++) {
        doc.setPage(i);
        color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(M, H - 11, W - M, H - 11);
        texto(`${marca.pie}${marca.contacto ? `  ·  ${marca.contacto}` : ""}`, M, H - 6.5, { tam: 7, col: COLOR.grisClaro });
        texto(`Emitido el ${emitido} por ${marca.preparadoPor || generadoPor}  ·  Página ${i} de ${paginas}`, W - M, H - 6.5, { tam: 7, col: COLOR.grisClaro, alinear: "right" });
    }
    return Buffer.from(doc.output("arraybuffer"));
}
