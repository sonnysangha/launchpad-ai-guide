import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Clerk forwards the request URL internally. Preserve our explicit loopback
  // origin instead of normalizing 127.0.0.1 to a different localhost origin.
  skipProxyUrlNormalize: true,
};

export default nextConfig;
