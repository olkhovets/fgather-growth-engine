const pkg = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || pkg.version,
  },
  // Increase body size limit for large CSV uploads (default 4.5MB is too small for 2000-row files)
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  webpack: (config, { dev }) => {
    if (!dev) {
      config.optimization.minimize = false;
    }
    return config;
  },
};

module.exports = nextConfig;
