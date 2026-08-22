import type { Metadata } from 'next';
import './globals.css';

const siteUrl = 'https://oneul-malsseum.glorious260627.chatgpt.site';
const title = '오늘의 말씀 | 쉬운 성경 동행';
const description = '성경을 오늘의 한국 생활에 연결해 쉽고 따뜻하게 풀어주는 말씀 동행 서비스';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: siteUrl,
    siteName: '오늘의 말씀',
    title,
    description,
    images: [{ url: `${siteUrl}/og.png`, alt: '오늘의 말씀 — 말씀이 오늘의 삶이 되도록' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [`${siteUrl}/og.png`],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
