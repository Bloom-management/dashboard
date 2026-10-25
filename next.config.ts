import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, serverExternalPackages: ['geo-tz'], outputFileTracingIncludes: {'/api/locations/addresses': ['./node_modules/geo-tz/data/**/*'], '/api/locations/cities': ['./node_modules/geo-tz/data/**/*']},  turbopack: { root: process.cwd() } };
export default config;
