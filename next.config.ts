import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js "N" dev indicator. Compile and runtime errors still show.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
