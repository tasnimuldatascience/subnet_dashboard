/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Production alternates between two build directories so PM2 can keep the
  // previous server alive while the replacement worker starts. Local builds
  // continue to use Next.js's default `.next` directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Enable compression
  compress: true,

};

export default nextConfig;
