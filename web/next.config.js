/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The authenticated spatial endpoint resolves the same public project files as the map.
    outputFileTracingIncludes: { "/api/spatial/query": ["./public/data/projects/**/*"], "/api/projects/analysis-review": ["./public/data/projects/**/*"], "/api/research/answer": ["./public/data/projects/**/*"], "/api/chat": ["./public/data/projects/**/*"] },
  },
};

module.exports = nextConfig;
