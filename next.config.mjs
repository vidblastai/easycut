/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@remotion/bundler',
    '@remotion/renderer',
    'ffmpeg-static',
    'ffprobe-static',
  ],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pexels.com' },
      { protocol: 'https', hostname: 'cdn.pixabay.com' },
      { protocol: 'https', hostname: 'api.iconify.design' },
    ],
  },
};
export default nextConfig;
