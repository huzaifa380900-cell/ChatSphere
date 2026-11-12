/**
 * Tailwind CSS v4 uses a dedicated PostCSS plugin (the Vite plugin is no longer
 * used once the build is handled by Next.js).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
