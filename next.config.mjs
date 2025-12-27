/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Enable compression
  compress: true,

  // Enable instrumentation for cache warm-up
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
