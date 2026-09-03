#!/usr/bin/env node
/**
 * OmniAccess · figuras ilustradas de los manuales.
 *
 * Algunas pantallas no son del sistema sino de Android (permisos, batería), así que
 * no se pueden capturar del servidor. Se dibujan acá como ilustraciones fieles a lo
 * que ve el guardia, y el manual las presenta como tales.
 *
 *   node scripts/make-figuras.js
 *
 * Salida: docs/manual/img/<archivo>.png
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const IMGDIR = path.join(ROOT, "docs", "manual", "img");

const BASE = `
  *{box-sizing:border-box;margin:0}
  body{font:15px/1.5 "Segoe UI",Roboto,system-ui,sans-serif;background:#e8eaed;padding:0}
  .tel{width:420px;background:#fff;min-height:760px;display:flex;flex-direction:column}
  .barra{height:30px;background:#f1f3f4;display:flex;align-items:center;justify-content:space-between;
    padding:0 14px;font-size:11px;color:#5f6368;font-weight:600}
  .titulo{padding:18px 20px 10px;font-size:19px;font-weight:600;color:#202124}
  .sub{padding:0 20px 14px;font-size:13px;color:#5f6368;line-height:1.45}
  .item{display:flex;align-items:center;gap:14px;padding:14px 20px;border-top:1px solid #eceff1}
  .item .ico{width:34px;height:34px;border-radius:50%;background:#e8f0fe;color:#1a73e8;
    display:flex;align-items:center;justify-content:center;flex:0 0 auto}
  .item .t{font-size:14.5px;color:#202124;font-weight:500}
  .item .d{font-size:12px;color:#5f6368;margin-top:1px}
  .item .est{margin-left:auto;font-size:12px;font-weight:700}
  .ok{color:#1e8e3e}.no{color:#d93025}
  .op{display:flex;align-items:center;gap:13px;padding:13px 20px;font-size:14.5px;color:#202124}
  .radio{width:19px;height:19px;border-radius:50%;border:2px solid #5f6368;flex:0 0 auto;position:relative}
  .radio.on{border-color:#1a73e8}
  .radio.on::after{content:"";position:absolute;inset:3px;border-radius:50%;background:#1a73e8}
  .op.destacada{background:#e8f0fe;border-radius:0 22px 22px 0;margin-right:16px;font-weight:600}
  .pie{margin-top:auto;padding:16px 20px;display:flex;gap:10px;justify-content:flex-end;border-top:1px solid #eceff1}
  .btn{padding:9px 18px;border-radius:20px;font-size:13.5px;font-weight:600;color:#1a73e8}
  .btn.pri{background:#1a73e8;color:#fff}
  .ruta{display:flex;align-items:center;gap:7px;padding:11px 20px;background:#f8f9fa;font-size:12px;
    color:#3c4043;font-weight:600;border-bottom:1px solid #eceff1}
  .ruta b{color:#1a73e8}
  .nota{margin:14px 20px 20px;padding:12px 14px;background:#fef7e0;border-left:4px solid #f9ab00;
    border-radius:0 8px 8px 0;font-size:12.5px;color:#3c4043;line-height:1.5}
  .app{display:flex;align-items:center;gap:13px;padding:16px 20px;background:#f8f9fa}
  .app .logo{width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,#0ea5e9,#3b82f6);
    display:flex;align-items:center;justify-content:center}
  .app .n{font-size:15px;font-weight:600;color:#202124}
  .app .v{font-size:11.5px;color:#5f6368}
  .sw{margin-left:auto;width:38px;height:21px;border-radius:11px;background:#1a73e8;position:relative;flex:0 0 auto}
  .sw::after{content:"";position:absolute;right:2px;top:2px;width:17px;height:17px;border-radius:50%;background:#fff}
  .sw.off{background:#bdc1c6}.sw.off::after{left:2px;right:auto}
`;

const PIN = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ICO = (d) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CAM = ICO(`<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`);
const NFC = ICO(`<path d="M6 8.3a7 7 0 0 1 0 7.4M10 5.5a11 11 0 0 1 0 13M14 8.3a7 7 0 0 0 0 7.4M18 5.5a11 11 0 0 0 0 13"/>`);
const CAMPANA = ICO(`<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>`);
const RELOJ = ICO(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);
const MANO = ICO(`<path d="M9 11V6a2 2 0 1 1 4 0v5"/><path d="M13 11V4a2 2 0 1 1 4 0v7"/><path d="M17 11V7a2 2 0 1 1 4 0v9a6 6 0 0 1-6 6h-3a7 7 0 0 1-7-7v-4a2 2 0 1 1 4 0"/>`);
const BAT = ICO(`<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4"/>`);
const OMNI = `<svg width="26" height="26" viewBox="0 0 64 64"><path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round"/><path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke="#fff" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const FIGURAS = [
    {
        file: "tab-12-permiso-ubicacion.png",
        html: `<div class="tel">
      <div class="barra"><span>9:41</span><span>▮▮▮ 84%</span></div>
      <div class="app"><div class="logo">${OMNI}</div><div><div class="n">OmniAccess Guardia</div><div class="v">Permiso de ubicación</div></div></div>
      <div class="titulo">¿Permitir que OmniAccess Guardia acceda a la ubicación de este dispositivo?</div>
      <div class="sub">La aplicación necesita la ubicación para mostrarte en el mapa del predio y para enviar tu posición cuando activás el pánico.</div>
      <div class="op destacada"><span class="radio on"></span>Permitir todo el tiempo</div>
      <div class="op"><span class="radio"></span>Permitir solo mientras se usa la app</div>
      <div class="op"><span class="radio"></span>Preguntar siempre</div>
      <div class="op"><span class="radio"></span>No permitir</div>
      <div class="nota">Elegí <b>Permitir todo el tiempo</b>. Con &laquo;solo mientras se usa&raquo; la posición se corta cuando apagás la pantalla, y el pánico sale sin ubicación.</div>
      <div class="pie"><span class="btn">Cancelar</span><span class="btn pri">Aceptar</span></div>
    </div>`,
    },
    {
        file: "tab-13-permisos-app.png",
        html: `<div class="tel">
      <div class="barra"><span>9:41</span><span>▮▮▮ 84%</span></div>
      <div class="ruta">Ajustes <b>›</b> Aplicaciones <b>›</b> OmniAccess Guardia <b>›</b> Permisos</div>
      <div class="titulo">Permisos de la aplicación</div>
      <div class="sub">Así tiene que quedar la lista antes de salir a recorrer.</div>
      <div class="item"><span class="ico">${PIN}</span><div><div class="t">Ubicación</div><div class="d">Permitir todo el tiempo</div></div><span class="est ok">Activado</span></div>
      <div class="item"><span class="ico">${CAM}</span><div><div class="t">Cámara</div><div class="d">Fotos de patentes y visitantes</div></div><span class="est ok">Activado</span></div>
      <div class="item"><span class="ico">${NFC}</span><div><div class="t">NFC</div><div class="d">Marcar puntos de ronda</div></div><span class="est ok">Activado</span></div>
      <div class="item"><span class="ico">${CAMPANA}</span><div><div class="t">Notificaciones</div><div class="d">Alertas y avisos de ronda</div></div><span class="est ok">Activado</span></div>
      <div class="item"><span class="ico">${MANO}</span><div><div class="t">Accesibilidad</div><div class="d">Pánico con el botón de volumen</div></div><span class="est ok">Activado</span></div>
      <div class="item"><span class="ico">${RELOJ}</span><div><div class="t">Actividad en segundo plano</div><div class="d">Que el servicio siga vivo</div></div><span class="est ok">Sin restricción</span></div>
      <div class="item"><span class="ico">${ICO(`<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>`)}</span><div><div class="t">Micrófono</div><div class="d">Notas de voz en la bitácora</div></div><span class="est ok">Activado</span></div>
      <div class="nota">Si alguno figura en <b style="color:#d93025">Denegado</b>, tocalo y cambialo. La aplicación no vuelve a pedirlo sola.</div>
    </div>`,
    },
    {
        file: "tab-14-bateria.png",
        html: `<div class="tel">
      <div class="barra"><span>9:41</span><span>▮▮▮ 84%</span></div>
      <div class="ruta">Ajustes <b>›</b> Batería <b>›</b> Optimización de batería</div>
      <div class="titulo">Optimización de batería</div>
      <div class="sub">Buscá OmniAccess Guardia en la lista y ponela en <b>No optimizar</b>.</div>
      <div class="app"><div class="logo">${OMNI}</div><div><div class="n">OmniAccess Guardia</div><div class="v">Sin restricción</div></div><span class="sw"></span></div>
      <div class="op destacada"><span class="radio on"></span>No optimizar</div>
      <div class="op"><span class="radio"></span>Optimizar</div>
      <div class="op"><span class="radio"></span>Restringida</div>
      <div class="item"><span class="ico">${BAT}</span><div><div class="t">Uso de la batería</div><div class="d">Últimas 24 horas · 31 %</div></div></div>
      <div class="nota">Esta es la causa número uno de <b>&laquo;la tablet dejó de reportar posición&raquo;</b>: Android duerme la aplicación con la pantalla apagada y se pierden posición y rondas hasta que alguien la vuelve a abrir.</div>
      <div class="pie"><span class="btn">Cancelar</span><span class="btn pri">Listo</span></div>
    </div>`,
    },
];

(async () => {
    fs.mkdirSync(IMGDIR, { recursive: true });
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 420, height: 780 }, deviceScaleFactor: 2.4 });
    const p = await ctx.newPage();
    for (const f of FIGURAS) {
        await p.setContent(`<style>${BASE}</style>${f.html}`, { waitUntil: "load" });
        const el = p.locator(".tel");
        let buf = await el.screenshot({ scale: "device" });
        const dest = path.join(IMGDIR, f.file);
        try {
            const sharp = require("sharp");
            buf = await sharp(buf).png({ compressionLevel: 9 }).toBuffer();
        } catch { }
        fs.writeFileSync(dest, buf);
        console.log(`  ✓ ${f.file.padEnd(34)} ${Math.round(fs.statSync(dest).size / 1024)} KB`);
    }
    await b.close();
    console.log(`\n${FIGURAS.length} ilustración(es) en docs/manual/img/.`);
})();
