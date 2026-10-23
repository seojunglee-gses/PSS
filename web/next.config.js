/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The authenticated spatial endpoint resolves the same public project files as the map.
    outputFileTracingIncludes: { "/api/spatial/query": ["./public/data/projects/**/*"] },
  },
};

module.exports = nextConfig;
