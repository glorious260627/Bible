import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'site.chatgpt.glorious260627.bible',
  appName: '오늘의 말씀',
  webDir: 'out',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT',
      hidden: false,
    },
  },
};

export default config;
