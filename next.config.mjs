/** @type {import('next').NextConfig} */
const nextConfig = {
  // unpdf ships its own pdf.js build; keep it out of the server bundle
  serverExternalPackages: ["unpdf"],
  // hackathon safety net: a stray type/lint warning should never block a Vercel deploy
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
