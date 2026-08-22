import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '오늘의 말씀 | 쉬운 성경 동행',
  description: '성경을 오늘의 한국 생활에 연결해 쉽고 따뜻하게 풀어주는 말씀 동행 서비스',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
