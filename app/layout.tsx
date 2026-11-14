import type {Metadata} from 'next';
import {Plus_Jakarta_Sans, DM_Sans, JetBrains_Mono} from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Brother HL-1201 USB-OTG Direct Print Studio',
  description:
    'Direct USB Type-B to Type-C OTG monochrome laser image printing utility and raster preprocessor for the Brother HL-1201 printer with multi-file batching, physical margin calibration, 1-bit halftoning, and PJL/RLE stream generation.',
  openGraph: {
    title: 'Brother HL-1201 USB-OTG Direct Print Studio',
    description:
      'Direct USB Type-B to Type-C OTG monochrome laser image printing utility and raster preprocessor for the Brother HL-1201 printer with multi-file batching, physical margin calibration, 1-bit halftoning, and PJL/RLE stream generation.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Brother HL-1201 USB-OTG Direct Print Studio',
    description:
      'Direct USB Type-B to Type-C OTG monochrome laser image printing utility and raster preprocessor for the Brother HL-1201 printer with multi-file batching, physical margin calibration, 1-bit halftoning, and PJL/RLE stream generation.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="bg-slate-50 text-slate-900 antialiased selection:bg-slate-900 selection:text-white"
      >
        {children}
      </body>
    </html>
  );
}
