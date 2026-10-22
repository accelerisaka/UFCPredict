import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "UFCPredict",
  description: "已确定的 UFC 赛程、官网选手资料，以及按 Polymarket 实时赔率结算的模拟预测。",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Oswald:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="shell">
          <SiteHeader user={user} />
          <main>{children}</main>
          <footer className="site-footer">
            模拟账本，不会向 Polymarket 提交真实订单。赛程和选手资料来自 UFC.com，价格来自 Polymarket 公开行情。
          </footer>
        </div>
      </body>
    </html>
  );
}
