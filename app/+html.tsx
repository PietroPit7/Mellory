import { ScrollViewStyleReset } from "expo-router/html";
import type { ReactNode } from "react";

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        {/* PWA / app shell */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Mellory" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" sizes="192x192" href="/Mellory/assets/images/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/Mellory/assets/images/icon-512.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/Mellory/assets/images/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/Mellory/assets/images/icon-512.png" />

        {/* Theme color — matches dark/light preference */}
        <meta name="theme-color" content="#070604" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#F3F0EA" media="(prefers-color-scheme: light)" />

        {/* SEO */}
        <meta name="description" content="La tua guida gastronomica personale. Salva i posti dove stai bene, aggiungici note, voti e ricordi." />
        <meta name="application-name" content="Mellory" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Mellory" />
        <meta property="og:description" content="La tua guida gastronomica personale." />
        <meta property="og:site_name" content="Mellory" />

        {/* Disable automatic phone number detection on iOS Safari */}
        <meta name="format-detection" content="telephone=no" />

        {/* Resets default scroll styles for RN web ScrollViews */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
