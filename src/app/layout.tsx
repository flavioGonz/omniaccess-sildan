import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

/*
 * La fuente se sirve desde el repo, no desde Google.
 *
 * `next/font/google` la DESCARGA durante el build. El 24 de setiembre un hipo de red en
 * ese minuto dejó el CSS generado roto, el build terminó en error y `omniaccess-web`
 * quedó en `errored`: el sitio abajo. Un despliegue no puede depender de que internet
 * conteste — y menos en un barrio, donde se despliega justamente cuando la red anda mal.
 *
 * Es la variable (100–900 en un archivo), así que cubre todos los pesos. Ver
 * `src/app/fuentes/LEEME.md` para la licencia y cómo actualizarla.
 */
const outfit = localFont({
  variable: "--font-outfit",
  display: "swap",
  src: [
    { path: "./fuentes/outfit-latin.woff2", style: "normal", weight: "100 900" },
    { path: "./fuentes/outfit-latin-ext.woff2", style: "normal", weight: "100 900" },
  ],
});

// Force dynamic rendering for the entire application to avoid build-time DB access
export const dynamic = 'force-dynamic';

// Una sola etiqueta viewport: la manual chocaba con la que inyecta Next
// y ganaba la de Next, perdiendo viewport-fit=cover y el bloqueo de zoom.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover" as const,
  themeColor: "#ffffff",
};

// La marca del PRODUCTO, no la del cliente: el favicon, el ícono de la PWA y la tarjeta
// que WhatsApp arma al compartir el link salían con el logo del cliente de Olivos en todos los
// barrios. Lo del cliente (nombre, logo, fondo del login) vive en
// Ajustes → Marca (APP_BRAND_*); esto es lo fijo. Los PNG se regeneran con
// scripts/iconos-marca.py a partir del isotipo de brand/OmniLogo.tsx.
//
// openGraph necesita URL absoluta (WhatsApp no resuelve relativas): se arma con el host
// con el que entró el pedido, así sirve para cualquier dominio sin hornear ninguno.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost";
  const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(host) ? "http" : "https");
  const base = `${proto}://${host}`;
  const descripcion = "Control de acceso y vigilancia: LPR, reconocimiento facial, intrusión y visitas.";
  return {
    metadataBase: new URL(base),
    title: "OmniAccess",
    description: descripcion,
    applicationName: "OmniAccess",
    icons: {
      icon: [{ url: "/favicon.png", sizes: "32x32", type: "image/png" }, { url: "/iconos/omni-192.png", sizes: "192x192", type: "image/png" }],
      apple: "/apple-touch-icon.png",
    },
    manifest: "/manifest.json",
    openGraph: {
      type: "website",
      siteName: "OmniAccess",
      title: "OmniAccess",
      description: descripcion,
      url: base,
      images: [{ url: "/og-omniaccess.png", width: 1200, height: 630, alt: "OmniAccess" }],
    },
    twitter: { card: "summary_large_image", title: "OmniAccess", description: descripcion, images: ["/og-omniaccess.png"] },
  };
}

import { ThemeProvider } from "@/components/theme-provider";
import ThemedToaster from "@/components/ThemedToaster";
import "sileo/styles.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />

      </head>
      <body
        className={`${outfit.variable} antialiased font-sans`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
