/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-side proxy: browser calls /api/* → Next.js → gateway internally
  async rewrites() {
    const gateway = process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:3010";
    return [
      {
        source: "/api/:path*",
        destination: `${gateway}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
