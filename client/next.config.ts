import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const API_BACKEND_ORIGIN = (process.env.API_BACKEND_ORIGIN || process.env.BACKEND_API_URL || 'http://127.0.0.1:4000').replace(
  /\/+$/,
  ''
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: clientRoot,
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_BACKEND_ORIGIN}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${API_BACKEND_ORIGIN}/socket.io/:path*`,
      },
      {
        source: '/auth/callback',
        destination: `${API_BACKEND_ORIGIN}/auth/callback`,
      },
    ];
  },
};

export default nextConfig;
