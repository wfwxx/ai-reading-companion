import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 实时陪读",
  description: "通过摄像头识别书页并进行实时语音陪读",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
