/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The authenticated spatial endpoint resolves the same public project files as the map.
    outputFileTracingIncludes: {
      "/api/spatial/query": ["./public/data/projects/**/*"],
      "/api/projects/analysis-review": ["./public/data/projects/**/*"],
      "/api/research/answer": ["./public/data/projects/**/*"],
      "/api/chat": ["./public/data/projects/**/*"],
      // PDF.js loads its worker and native canvas dynamically; Next 14's tracer
      // does not discover them from pdf-parse's ESM entry point on Vercel.
      "/api/projects/case-sources": [
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        "./node_modules/@napi-rs/canvas*/**/*",
      ],
    },
  },
};

module.exports = nextConfig;
