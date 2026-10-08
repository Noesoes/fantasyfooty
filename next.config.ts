import type { NextConfig } from "next";

// Set BASE_PATH (e.g. "/tee-time-tracker") when building for a GitHub
// Pages project site, which serves from a subpath rather than the domain root.
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
