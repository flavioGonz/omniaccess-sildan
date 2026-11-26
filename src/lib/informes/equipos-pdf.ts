/**
 * El inventario de equipos en PDF (A4 apaisado), con la tapa común de los informes (26/11).
 *
 * Tapa → los grabadores (cada NVR con su hardware y sus discos) → los equipos, agrupados por área.
 * Mismas reglas que los otros informes: color sólo donde dice algo (en línea, fuera de línea, un
 * disco con error, una cámara que no graba), sin sombras ni degradés, y cada hoja de adentro dice
 * de qué es y de cuándo.
 *
 * Si trae las claves de los equipos, la tapa y cada hoja lo dicen («Confidencial: incluye claves»):
 * una hoja suelta de este informe es una llave, y tiene que verse como tal.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { COLOR, rgb, suave, fuentesOutfit, isotipoPng, type Marca } from "@/lib/informes/marca";
import { EN_TAPA } from "@/lib/informes/paleta";
import { dibujarTapa } from "@/lib/informes/tapa";
import { discoBien, estadoDiscoTxt, retencionTxt, tiempoPrendido, type Inventario, type EquipoInv } from "@/lib/informes/equipos-datos";

const W = 297, H = 210, M = 12;
const ZONA = "America/Montevideo";

export async function inventarioPdf(inv: Inventario, marca: Marca, generadoPor: string): Promise<Buffer> {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const f = await fuentesOutfit();
    doc.addFileToVFS("Outfit-Regular.ttf", f.regular); doc.addFont("Outfit-Regular.ttf", "Outfit", "normal");
    doc.addFileToVFS("Outfit-Bold.ttf", f.negrita); doc.addFont("Outfit-Bold.ttf", "Outfit", "bold");
    doc.setFont("Outfit", "normal");
    doc.setProperties({ title: "Inventario de equipos", subject: marca.empresa, author: marca.empresa, creator: "OmniAccess" });

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
    const fecha = (iso: string, conHora = true) => new Intl.DateTimeFormat("es-UY", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", ...(conHora ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) }).format(new Date(iso)).replace(",", "");
    const emitido = fecha(inv.generado);
    const t = inv.totales;
    const isoTinta = await isotipoPng(COLOR.tinta, 256);

    /* ══ LA TAPA ══ */
    await dibujarTapa(doc, {
        producto: "OMNIACCESS", linea: "Dispositivos", rotulo: inv.conClaves ? "Inventario de equipos · confidencial" : "Inventario de equipos",
        titulo: marca.empresa,
        debajo: `${t.equipos} equipos en ${inv.areas.length} ${inv.areas.length === 1 ? "área" : "áreas"}`,
        periodo: `Al ${fecha(inv.generado, false)}`,
        contenido: t.porTipo.slice(0, 7).map((x) => ({ titulo: x.rotulo, valor: String(x.n) })),
        cifras: [
            { v: String(t.equipos), que: "equipos" },
            { v: String(t.enLinea), que: "en línea" },
            { v: String(t.fueraDeLinea), que: "fuera de línea", tono: t.fueraDeLinea ? EN_TAPA.mal : undefined },
            { v: String(t.conAlertas), que: t.conAlertas === 1 ? "con alerta abierta" : "con alertas abiertas", tono: t.conAlertas ? EN_TAPA.aviso : undefined },
            { v: String(t.nvrs), que: t.nvrs === 1 ? "grabador" : "grabadores" },
            { v: inv.conSalud ? `${t.discos - t.discosMal}/${t.discos}` : "—", que: "discos bien", tono: t.discosMal ? EN_TAPA.mal : undefined },
            { v: t.retProm != null ? `${t.retProm} d` : "—", que: t.retMin != null ? `retención promedio (mínima ${t.retMin} d)` : "retención promedio" },
        ],
        pie: inv.conClaves ? "CONFIDENCIAL: incluye usuarios y claves de los equipos. No lo reenvíes ni lo imprimas sin necesidad." : "Sin claves: los usuarios figuran, las claves no.",
        emitido, por: generadoPor, marca,
    });

    /* ══ LOS GRABADORES ══ */
    doc.addPage();
    let y = 24;
    const titulo = (s: string, bajada?: string) => {
        if (y > H - 50) { doc.addPage(); y = 24; }
        texto(s, M, y, { tam: 13, negrita: true, col: COLOR.tinta });
        y += 5;
        if (bajada) y += texto(bajada, M, y, { tam: 8, col: COLOR.gris, ancho: W - M * 2 }) * 3.7;
        y += 4;
    };
    titulo("Grabadores", inv.conSalud ? "El hardware y los discos de cada NVR, preguntados al grabador al armar este informe." : "Sin la salud en vivo: se pidió el informe sin preguntar a los grabadores.");
    if (!inv.nvrs.length) { texto("No hay grabadores dados de alta.", M, y + 3, { tam: 9, col: COLOR.gris }); y += 12; }
    for (const n of inv.nvrs) {
        const s = n.salud;
        const alto = 25;
        if (y + alto + 20 > H - 16) { doc.addPage(); y = 24; }
        // La ficha del NVR: una banda suave con sus datos y su estado.
        color(COLOR.superficie, "relleno"); doc.roundedRect(M, y, W - M * 2, alto, 2, 2, "F");
        const estadoCol = !inv.conSalud ? COLOR.gris : s?.alcanzable ? COLOR.bien : COLOR.mal;
        color(estadoCol, "relleno"); doc.circle(M + 6, y + 7.4, 1.6, "F");
        texto(n.nombre, M + 10, y + 8.6, { tam: 11.5, negrita: true, col: COLOR.tinta });
        texto([n.marca, n.modelo, n.firmware].filter(Boolean).join(" · "), M + 10, y + 13.6, { tam: 8, col: COLOR.gris });
        texto(`${n.ip}${n.mac ? `  ·  ${n.mac}` : ""}  ·  ${n.area}`, M + 10, y + 18.4, { tam: 8, col: COLOR.gris });
        const datos: [string, string][] = [
            ["Estado", !inv.conSalud ? "sin consultar" : s?.alcanzable ? `${s.latenciaMs} ms` : "no contesta"],
            ["Prendido", tiempoPrendido(s?.uptimeSec)],
            ["Memoria", s?.memoriaPct != null ? `${s.memoriaPct} %` : "—"],
            ["Cámaras", String(n.camaras)],
            ["Usuario", n.usuario || "—"],
            ...(inv.conClaves ? [["Clave", n.clave || "—"] as [string, string]] : []),
        ];
        const x0 = 128, cw = (W - M - 4 - x0) / datos.length;
        datos.forEach(([k, v], i) => {
            texto(k.toUpperCase(), x0 + i * cw, y + 9, { tam: 6.4, negrita: true, col: COLOR.grisClaro, espaciado: 0.3 });
            texto(v, x0 + i * cw, y + 14.5, { tam: 9, negrita: true, col: k === "Estado" ? estadoCol : COLOR.texto, ancho: cw - 2 });
        });
        y += alto + 2;
        const discos = s?.discos || [];
        if (inv.conSalud && discos.length) {
            autoTable(doc, {
                startY: y, margin: { left: M + 4, right: M, top: 20, bottom: 16 },
                head: [["Disco", "Estado", "Capacidad", "Ocupado", "Modelo"]],
                body: discos.map((d) => [d.nombre, estadoDiscoTxt(d.estado), d.capacidadGB ? `${(d.capacidadGB / 1024).toFixed(d.capacidadGB >= 10240 ? 0 : 1).replace(".", ",")} TB` : "—", `${d.usadoPct} %`, d.modelo || "—"]),
                styles: { font: "Outfit", fontSize: 7.8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: rgb(COLOR.texto), lineWidth: 0 },
                headStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.tinta), textColor: [255, 255, 255], fontSize: 7.2 },
                alternateRowStyles: { fillColor: rgb("#f7f8fa") },
                columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 32 }, 2: { cellWidth: 28, halign: "right" }, 3: { cellWidth: 24, halign: "right" } },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                didParseCell: (d: any) => {
                    if (d.section !== "body" || d.column.index !== 1) return;
                    const crudo = discos[d.row.index]?.estado || "";
                    if (!discoBien(crudo)) { d.cell.styles.textColor = rgb(COLOR.mal); d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = rgb(suave(COLOR.mal, 0.9)); }
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            y = (doc as any).lastAutoTable.finalY + 7;
        } else {
            texto(inv.conSalud ? (s?.alcanzable ? (s.discos === null ? "No informó sus discos." : "Sin discos instalados.") : "No contestó: sin datos de discos.") : "", M + 4, y + 3, { tam: 8, col: COLOR.gris });
            y += 9;
        }
    }

    /* ══ LOS EQUIPOS, POR ÁREA ══ */
    doc.addPage(); y = 24;
    titulo("Equipos por área", "Cada equipo con su grabación, su retención y su estado. La retención es la que se calculó en el NVR (más vieja grabación del canal).");
    const grupos = [...inv.areas.map((a) => ({ titulo: a.camino, equipos: inv.equipos.filter((e) => e.areaId === a.id) })), { titulo: "Sin área", equipos: inv.equipos.filter((e) => !e.areaId) }].filter((g) => g.equipos.length);
    const columnas: { r: string; w: number; v: (e: EquipoInv) => string; der?: boolean }[] = [
        { r: "Nombre", w: 40, v: (e) => e.nombre },
        { r: "Tipo", w: 28, v: (e) => e.rotuloTipo + (e.sentido ? ` · ${e.sentido}` : "") },
        { r: "Marca / modelo", w: 34, v: (e) => [e.marca, e.modelo].filter(Boolean).join(" ") },
        { r: "IP", w: 22, v: (e) => e.ip + (e.puertoHttp && e.puertoHttp !== 80 ? `:${e.puertoHttp}` : "") },
        { r: "Grabación", w: 38, v: (e) => (e.tipo === "NVR" ? "—" : e.nvr ? `${e.nvr} · CH ${e.canal}` : "Sin grabación") },
        { r: "Retención", w: 20, v: (e) => (e.tipo === "NVR" ? "—" : retencionTxt(e.retencion)), der: true },
        { r: "Usuario", w: 15, v: (e) => e.usuario || "—" },
        ...(inv.conClaves ? [{ r: "Clave", w: 20, v: (e: EquipoInv) => e.clave || "—" }] : []),
        { r: "Estado", w: 28, v: (e) => (e.enLinea === null ? "sin dato" : e.enLinea ? `en línea${e.latenciaMs != null ? ` · ${e.latenciaMs} ms` : ""}` : "fuera de línea") + (e.alertas.length ? ` · ${e.alertas.length} alerta${e.alertas.length > 1 ? "s" : ""}` : "") },
    ];
    const peso = columnas.reduce((a, c) => a + c.w, 0);
    for (const g of grupos) {
        if (y > H - 40) { doc.addPage(); y = 24; }
        texto(g.titulo, M, y, { tam: 10.5, negrita: true, col: COLOR.tinta });
        texto(`${g.equipos.length} ${g.equipos.length === 1 ? "equipo" : "equipos"}`, W - M, y, { tam: 7.6, col: COLOR.grisClaro, alinear: "right" });
        y += 2.5;
        autoTable(doc, {
            startY: y, margin: { left: M, right: M, top: 20, bottom: 16 },
            head: [columnas.map((c) => c.r)],
            body: g.equipos.map((e) => columnas.map((c) => c.v(e))),
            styles: { font: "Outfit", fontSize: 7.4, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: rgb(COLOR.texto), lineWidth: 0, overflow: "linebreak" },
            headStyles: { font: "Outfit", fontStyle: "bold", fillColor: rgb(COLOR.tinta), textColor: [255, 255, 255], fontSize: 7 },
            alternateRowStyles: { fillColor: rgb("#f7f8fa") },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            columnStyles: Object.fromEntries(columnas.map((c, i) => [i, { cellWidth: ((W - M * 2) * c.w) / peso, halign: c.der ? "right" : "left" }])) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            didParseCell: (d: any) => {
                if (d.section !== "body") return;
                const e = g.equipos[d.row.index]; const col = columnas[d.column.index].r;
                if (col === "Nombre") d.cell.styles.fontStyle = "bold";
                if (col === "Estado") { d.cell.styles.textColor = rgb(e.enLinea === false ? COLOR.mal : e.alertas.length ? COLOR.avisoTexto : e.enLinea ? COLOR.bien : COLOR.gris); d.cell.styles.fontStyle = "bold"; }
                if (col === "Retención" && e.retencion?.grabando === false) { d.cell.styles.textColor = rgb(COLOR.mal); d.cell.styles.fontStyle = "bold"; }
                if (col === "Grabación" && e.tipo !== "NVR" && !e.nvr && ["CAMERA", "LPR_CAMERA", "LPR_INTERIOR"].includes(e.tipo)) d.cell.styles.textColor = rgb(COLOR.avisoTexto);
            },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        y = (doc as any).lastAutoTable.finalY + 8;
    }

    /* ── La cabecera y el pie de cada hoja de adentro ── */
    const paginas = doc.getNumberOfPages();
    for (let i = 2; i <= paginas; i++) {
        doc.setPage(i);
        if (isoTinta) doc.addImage(isoTinta, "PNG", M, 7.4, 5.6, 5.6);
        texto("OMNIACCESS", M + (isoTinta ? 7.4 : 0), 11.5, { tam: 7.6, negrita: true, col: COLOR.tinta, espaciado: 0.5 });
        texto(`Inventario de equipos  ·  ${marca.empresa}  ·  al ${fecha(inv.generado, false)}`, W - M, 11.5, { tam: 7.4, col: COLOR.gris, alinear: "right" });
        if (inv.conClaves) texto("CONFIDENCIAL · INCLUYE CLAVES", W / 2, 11.5, { tam: 7, negrita: true, col: COLOR.mal, alinear: "left", espaciado: 0.3 });
        color(COLOR.linea, "linea"); doc.setLineWidth(0.25); doc.line(M, 15, W - M, 15);
        doc.line(M, H - 11, W - M, H - 11);
        texto(`${marca.pie}${marca.contacto ? `  ·  ${marca.contacto}` : ""}`, M, H - 6.5, { tam: 7, col: COLOR.grisClaro });
        texto(`Emitido el ${emitido} por ${marca.preparadoPor || generadoPor}  ·  Página ${i} de ${paginas}`, W - M, H - 6.5, { tam: 7, col: COLOR.grisClaro, alinear: "right" });
    }
    return Buffer.from(doc.output("arraybuffer"));
}
