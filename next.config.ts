import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js "N" dev indicator. Compile and runtime errors still show.
  devIndicators: false,
  cacheComponents: true,
  // Demo mode reads fixtures/ at run time; serverless bundles only include traced files.
  outputFileTracingIncludes: {
    "/api/**": ["./fixtures/**/*"],
  },
  partialPrefetching: true,
};

export default nextConfig;
