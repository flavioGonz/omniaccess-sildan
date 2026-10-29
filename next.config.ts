/** @type {import("next").NextConfig} */
const nextConfig = {
  // Dónde escribe el build. scripts/compilar-sin-corte.sh compila en .next-nuevo con el sitio
  // andando y recién al final lo pone en .next: antes el script corría .next a un costado ANTES
  // de compilar, y el sitio daba «Internal Server Error» los ~4 minutos del build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // El rewrite de /io recibe pedidos con barra final y Next respondía 308.
  // Los navegadores lo siguen, pero un cliente estricto no conecta y en polling
  // cada pedido de la tablet costaba dos viajes.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ["bullmq", "ioredis", "web-push", "jspdf", "jspdf-autotable", "exceljs"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "**",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async rewrites() {
    return [
      {
        source: "/io/:path*",
        destination: "http://127.0.0.1:10000/:path*",
      },
      {
        source: "/socket.io/:path*",
        destination: "http://127.0.0.1:10000/socket.io/:path*",
      },
      {
        source: "/go2rtc/:path*",
        destination: "http://127.0.0.1:1984/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
        ],
      },
    ];
  },
};

export default nextConfig;
