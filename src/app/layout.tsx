import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

// Force dynamic rendering for the entire application to avoid build-time DB access
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Omniacces",
  description: "Sistema de control de acceso LPR y Facial",
  icons: {
    icon: "/iconos/sildan-pwa.png",
    apple: "/iconos/sildan-pwa.png",
  },
  manifest: "/manifest.json",
};

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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />

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
