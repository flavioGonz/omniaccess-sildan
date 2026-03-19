/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Reduce logging in development
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  async rewrites() {
    return [
      {
        source: '/socket.io',
        destination: 'http://localhost:10000/socket.io/',
      },
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:10000/socket.io/:path*',
      },
      {
        source: '/api/live/:path*',
        destination: 'http://localhost:10000/api/live/:path*',
      },
      {
        source: '/api/proxy/:path*',
        destination: 'http://localhost:10000/api/proxy/:path*',
      },
      {
        source: '/api/webhooks/:path*',
        destination: 'http://localhost:10000/api/webhooks/:path*',
      },
    ];
  },
};

export default nextConfig;
