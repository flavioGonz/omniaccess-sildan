/** @type {import("next").NextConfig} */
const nextConfig = {
  // El rewrite de /io recibe pedidos con barra final y Next respondía 308.
  // Los navegadores lo siguen, pero un cliente estricto no conecta y en polling
  // cada pedido de la tablet costaba dos viajes.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ["bullmq", "ioredis", "web-push"],
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
        destination: "http://localhost:10000/:path*",
      },
      {
        source: "/go2rtc/:path*",
        destination: "http://localhost:1984/:path*",
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
