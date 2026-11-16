import type { NextConfig } from 'next';
// Opt-in LAN hosts for phone testing, set by scripts/local-dev.mjs from BLOOM_DEV_LAN_HOST.
const allowedDevOrigins = process.env.BLOOM_ALLOWED_DEV_ORIGINS?.split(',').map(host => host.trim()).filter(Boolean) ?? [];
const config: NextConfig = { poweredByHeader: false, allowedDevOrigins, serverExternalPackages: ['geo-tz'], outputFileTracingIncludes: {'/api/locations/addresses': ['./node_modules/geo-tz/data/**/*'], '/api/locations/cities': ['./node_modules/geo-tz/data/**/*']},  turbopack: { root: process.cwd() } };
export default config;
