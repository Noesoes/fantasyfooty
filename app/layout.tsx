import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Prime Time Lineup Advisor",
  description: "Weekly start/sit, drop and waiver-wire recommendations for your Sleeper fantasy football team.",
  // Installed on an iPhone home screen: open full screen under the status bar.
  appleWebApp: { capable: true, title: "PrimeTime", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  viewportFit: "cover",
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* Apply the saved (or system) theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t);if(t==="light"){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#f4f5f8")}}catch(e){}})()`,
          }}
        />
        {process.env.NODE_ENV === "production" && (
          // Offline-friendly app shell for the installed (home screen) app.
          <script
            dangerouslySetInnerHTML={{
              __html: `if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("${basePath}/sw.js",{scope:"${basePath}/"}).catch(function(){})})`,
            }}
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
