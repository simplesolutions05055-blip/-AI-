/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // puppeteer-core / @sparticuz/chromium must stay external to the bundle
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  },
};

export default nextConfig;
