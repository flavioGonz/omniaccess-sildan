#!/usr/bin/env python3
"""
Genera los íconos y las imágenes de marca de OmniAccess a partir del isotipo
(src/components/brand/OmniLogo.tsx — el mismo dibujo, en SVG).

Por qué existe: public/ venía con la marca del cliente anterior en el
favicon, los íconos de las PWA, la vista previa al compartir el link y los logos de la
consola del guardia. Un barrio nuevo heredaba la marca de otro cliente. Esto deja la
marca del PRODUCTO en todo lo fijo; la marca del cliente (nombre, logo, fondo del login)
sigue viviendo en Ajustes (APP_BRAND_*), que es donde corresponde.

    pip install cairosvg pillow fonttools brotli
    python3 scripts/iconos-marca.py

Escribe en public/ (sobre los archivos que ya referencian layout.tsx, los manifests y
las consolas). Se corre a mano cuando cambie el isotipo; no corre en el build.
"""
import io, os, sys
from pathlib import Path

try:
    import cairosvg
    from PIL import Image, ImageDraw, ImageFont
    from fontTools.ttLib import TTFont
except ImportError as e:
    sys.exit(f"falta una dependencia ({e}); ver el encabezado del script")

RAIZ = Path(__file__).resolve().parent.parent
PUBLIC = RAIZ / "public"
FUENTE_WOFF2 = RAIZ / "src/app/fuentes/outfit-latin.woff2"

# Colores del producto (ver DESIGN.md): fondo oscuro de la app y el degradado del isotipo.
FONDO = (11, 18, 32, 255)          # #0b1220
FONDO_HEX = "#0b1220"
BLANCO = (255, 255, 255, 255)
GRIS = (148, 163, 184, 255)        # slate-400

MARCA_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{w}" height="{w}">
  <defs>
    <linearGradient id="g" x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0ea5e9"/><stop offset=".55" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <path d="M51.7 16.6 A25 25 0 1 0 51.7 47.4" fill="none" stroke="url(#g)" stroke-width="5.4" stroke-linecap="round"/>
  <path d="M41 21.3 A14 14 0 1 0 41 42.7" fill="none" stroke="url(#g)" stroke-width="4.4" stroke-linecap="round" opacity=".78"/>
  <path d="M41.5 24 L49.8 32 L41.5 40" fill="none" stroke="url(#g)" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M53.4 27.2 L58.2 32 L53.4 36.8" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
</svg>"""


def marca(px: int) -> Image.Image:
    """El isotipo solo, sobre transparente, de px×px."""
    png = cairosvg.svg2png(bytestring=MARCA_SVG.format(w=px).encode(), output_width=px, output_height=px)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def fuente(peso: int, tam: int) -> ImageFont.FreeTypeFont:
    """Outfit (la única familia del producto), en el peso pedido, desde el woff2 del repo."""
    ttf = Path("/tmp/outfit-iconos.ttf")
    if not ttf.exists():
        f = TTFont(str(FUENTE_WOFF2)); f.flavor = None; f.save(str(ttf))
    fnt = ImageFont.truetype(str(ttf), tam)
    try: fnt.set_variation_by_axes([peso])
    except Exception: pass
    return fnt


def icono(px: int, margen: float = 0.14, radio: float = 0.22, fondo=FONDO) -> Image.Image:
    """Ícono cuadrado: fondo oscuro con esquinas redondeadas y el isotipo centrado.
    `margen` es la fracción de aire alrededor (los maskable piden más)."""
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * radio), fill=fondo)
    m = marca(int(px * (1 - 2 * margen)))
    im.alpha_composite(m, (int(px * margen), int(px * margen)))
    return im


def wordmark(ancho: int, alto: int, claro: bool = True, fondo=(0, 0, 0, 0)) -> Image.Image:
    """Isotipo + «OmniAccess» + «CONTROL Y ACCESO», centrado, para cabeceras."""
    im = Image.new("RGBA", (ancho, alto), fondo)
    d = ImageDraw.Draw(im)
    mk = int(alto * 0.46)
    t1, t2 = "OmniAccess", "CONTROL Y ACCESO"
    # El tamaño del nombre sale del ancho disponible, no de un número fijo: así el mismo
    # dibujo sirve para 1024×512 y para una cabecera angosta sin recortarse.
    tam = int(alto * 0.24)
    while tam > 10:
        f1 = fuente(700, tam)
        if mk + alto * 0.1 + d.textlength(t1, font=f1) <= ancho * 0.92: break
        tam -= 2
    f2 = fuente(600, int(tam * 0.3))
    esp = tam * 0.045
    w1 = d.textlength(t1, font=f1); w2 = sum(d.textlength(ch, font=f2) + esp for ch in t2)
    bloque = mk + alto * 0.1 + max(w1, w2)
    x = (ancho - bloque) / 2
    im.alpha_composite(marca(mk), (int(x), (alto - mk) // 2))
    tx = x + mk + alto * 0.1
    col = BLANCO if claro else (15, 23, 42, 255)
    ty = alto / 2 - tam * 0.72
    d.text((tx, ty), t1, font=f1, fill=col)
    # el rótulo en versalitas espaciadas, como {typography.rotulo} del sistema
    cx = tx
    for ch in t2:
        d.text((cx, ty + tam * 1.1), ch, font=f2, fill=GRIS if claro else (71, 85, 105, 255))
        cx += d.textlength(ch, font=f2) + esp
    return im


def og(ancho=1200, alto=630) -> Image.Image:
    """La tarjeta que WhatsApp/Telegram/Slack muestran al compartir el link."""
    im = Image.new("RGBA", (ancho, alto), FONDO)
    d = ImageDraw.Draw(im)
    mk = 260
    im.alpha_composite(marca(mk), (110, (alto - mk) // 2))
    f1 = fuente(700, 108); f2 = fuente(400, 38); f3 = fuente(600, 26)
    x = 110 + mk + 70
    d.text((x, 170), "OmniAccess", font=f1, fill=BLANCO)
    d.text((x, 305), "Control de acceso y vigilancia", font=f2, fill=(203, 213, 225, 255))
    d.text((x, 358), "LPR · facial · intrusión · visitas", font=f2, fill=GRIS)
    cx = x
    for ch in "INGENIERÍA EN SEGURIDAD":
        d.text((cx, 445), ch, font=f3, fill=(100, 116, 139, 255)); cx += d.textlength(ch, font=f3) + 4
    return im


def guardar(im: Image.Image, rel: str):
    p = PUBLIC / rel; p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p, "PNG", optimize=True); print(f"  {rel}  {im.size[0]}×{im.size[1]}")


def main():
    print("íconos:")
    for px in (192, 512, 1024):
        guardar(icono(px), f"iconos/omni-{px}.png")
    guardar(icono(512, margen=0.24, radio=0.0), "iconos/omni-512-maskable.png")   # maskable: sin esquinas, más aire
    guardar(icono(32, margen=0.08, radio=0.22), "favicon.png")
    guardar(icono(180, margen=0.14, radio=0.0), "apple-touch-icon.png")          # iOS recorta las esquinas solo
    # Los nombres que ya usan los manifests de cada consola (guard/lpr/face/filas) y el
    # servicio worker: se pisan con la marca del producto para no tocar cuatro manifests
    # y la caché de la PWA instalada en las tablets.
    for mod in ("guard", "lpr", "face", "filas"):
        guardar(icono(192), f"iconos/{mod}-192.png")
        guardar(icono(512), f"iconos/{mod}-512.png")
        guardar(icono(512, margen=0.24, radio=0.0), f"iconos/{mod}-512-maskable.png")
    for rel in ("icon-192.png", "icons/icon-192.png"):
        guardar(icono(192), rel)
    for rel in ("icon-512.png", "icons/icon-512.png"):
        guardar(icono(512), rel)
    guardar(icono(1024), "icon-1024.png")
    guardar(icono(1024, margen=0.16), "iconos/appstore.png")
    guardar(icono(512), "iconos/playstore.png")
    print("logos:")
    guardar(wordmark(1024, 512, claro=True), "logo-transparent.png")             # consolas (fondo oscuro)
    guardar(wordmark(1024, 512, claro=True), "logo-omniaccess-white.png")
    guardar(wordmark(1024, 512, claro=False), "logo-omniaccess.png")
    print("vista previa al compartir:")
    guardar(og(), "og-omniaccess.png")


if __name__ == "__main__":
    main()
