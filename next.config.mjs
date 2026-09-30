/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["10.109.25.112"],
  outputFileTracingRoot: process.cwd()
};

export default nextConfig;