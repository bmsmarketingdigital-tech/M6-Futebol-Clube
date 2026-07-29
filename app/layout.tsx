import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:5173";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "BaseForte | Gestão para escolinhas de futebol",
    description: "Gestão administrativa e desenvolvimento esportivo em uma única plataforma.",
    openGraph: {
      title: "BaseForte | Gestão que desenvolve",
      description: "Sua escolinha mais profissional, do financeiro à evolução do atleta.",
      images: [{ url: socialImage, width: 1672, height: 941, alt: "BaseForte — gestão que desenvolve" }],
      locale: "pt_BR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "BaseForte | Gestão que desenvolve",
      description: "Sua escolinha mais profissional, do financeiro à evolução do atleta.",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
