import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const API_BACKEND_ORIGIN = (process.env.API_BACKEND_ORIGIN || process.env.BACKEND_API_URL || 'http://127.0.0.1:4000').replace(
  /\/+$/,
  ''
);

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' as const } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_PUSHER_KEY: process.env.VITE_PUSHER_KEY || '',
    NEXT_PUBLIC_PUSHER_CLUSTER: process.env.VITE_PUSHER_CLUSTER || '',
  },
  turbopack: {
    root: clientRoot,
  },

  ...(process.env.NODE_ENV !== 'production'
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${API_BACKEND_ORIGIN}/api/:path*`,
            },
            {
              source: '/auth/callback',
              destination: `${API_BACKEND_ORIGIN}/auth/callback`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
