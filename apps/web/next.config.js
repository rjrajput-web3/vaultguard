/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // bip39 / ed25519-hd-key use Buffer internally. Next.js 14 does not
    // polyfill Node core modules for client components, so without this
    // fallback every wallet key operation throws in a real browser.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve("buffer/"),
    };
    return config;
  },
};
module.exports = nextConfig;
