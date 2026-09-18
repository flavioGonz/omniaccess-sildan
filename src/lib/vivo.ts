/**
 * El vivo de una cámara, montado sobre un <video> ya existente.
 *
 * Vive aparte del componente de React porque hace falta desde los dos lados: la vista
 * plana lo usa dentro de un componente, y la 3D crea sus marcadores a mano — MapLibre no
 * sabe de React. Sin esto habría dos copias de la misma lógica de reintento, que es
 * justamente donde se esconden las diferencias de comportamiento entre dos vistas que
 * deberían ser la misma.
 */

export const srcVivo = (deviceId: string) =>
    `/go2rtc/api/stream.mp4?src=lpr_${deviceId}_hd&video=h264`;

/**
 * Arranca el flujo y devuelve la función que lo corta.
 *
 * Reintenta unas pocas veces: go2rtc tarda un momento en levantar un stream que estaba
 * dormido, y sin reintento la primera carga queda en negro para siempre. El tope existe
 * para que una cámara caída no reintente sin fin en segundo plano.
 */
export function montarVivo(video: HTMLVideoElement, deviceId: string, intentos = 4) {
    const src = srcVivo(deviceId);
    let restantes = intentos;
    let temporizador: any = null;

    const arrancar = () => {
        video.src = src;
        video.play().catch(() => { });
    };
    const alFallar = () => {
        if (restantes-- <= 0) return;
        temporizador = setTimeout(() => { if (video.isConnected) arrancar(); }, 1400);
    };

    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.addEventListener("error", alFallar);
    arrancar();

    return () => {
        clearTimeout(temporizador);
        video.removeEventListener("error", alFallar);
        try { video.pause(); video.removeAttribute("src"); video.load(); } catch { }
    };
}

/** La burbuja completa: video arriba, nombre y punto rojo abajo. Igual en las dos vistas. */
export function burbujaVivo(nombre: string) {
    const el = document.createElement("div");
    el.style.cssText = "pointer-events:auto";
    el.innerHTML = `
<div style="border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.15);
     box-shadow:0 14px 34px -10px rgba(0,0,0,.85);background:#0a0d12">
  <div style="position:relative;width:224px;height:126px;background:#000">
    <video style="display:block;width:100%;height:100%;object-fit:cover"></video>
  </div>
  <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:rgba(0,0,0,.85)">
    <span style="width:6px;height:6px;border-radius:50%;background:#f87171;flex:none;
          animation:omniPulsoAuto 1.8s ease-in-out infinite"></span>
    <span style="font:700 11px/1.4 ui-sans-serif,system-ui;color:#fff;white-space:nowrap;
          overflow:hidden;text-overflow:ellipsis">${nombre}</span>
  </div>
</div>
<span style="display:block;margin:-1px auto 0;width:8px;height:8px;transform:rotate(45deg);
      background:rgba(0,0,0,.85);border-right:1px solid rgba(255,255,255,.15);
      border-bottom:1px solid rgba(255,255,255,.15)"></span>`;
    return el;
}
