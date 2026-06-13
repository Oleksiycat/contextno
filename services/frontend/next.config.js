/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.next/**",
        "E:/System Volume Information/**",
        "E:/`$RECYCLE.BIN/**",
      ],
    };

    return config;
  },
}
module.exports = nextConfig
