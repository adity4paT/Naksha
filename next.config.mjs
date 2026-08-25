/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Static export.
   *
   * This dashboard has no server side to speak of: the workbook is parsed in
   * the browser, the boundaries are static assets, and there are no API routes,
   * no server components fetching anything, and no middleware. A server build
   * would be a runtime to maintain for no work it actually does.
   *
   * Exporting produces a plain `out/` directory of HTML, JS, and assets that
   * any static host serves directly. It is also what makes CLAUDE.md's
   * confidentiality rule structural rather than a promise — with no server in
   * the deployment, there is nowhere for land data to round-trip to even by
   * accident.
   */
  output: 'export',

  /**
   * Required by `output: 'export'` if `next/image` is ever used, since there is
   * no server to run the optimizer. Nothing uses it today; this keeps a future
   * `<Image>` from breaking the build with a confusing error.
   */
  images: { unoptimized: true },

  eslint: {
    dirs: ['src'],
  },
};

export default nextConfig;
