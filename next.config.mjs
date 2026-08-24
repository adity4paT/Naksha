/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The dashboard is a pure client-side app: the workbook is parsed in the
  // browser and never leaves it. Nothing here should introduce a server hop.
  // See CLAUDE.md "Confidentiality".
  eslint: {
    dirs: ['src'],
  },
};

export default nextConfig;
