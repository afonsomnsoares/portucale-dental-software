import './globals.css';
import { JetBrains_Mono, Newsreader, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { AuthProvider } from './providers';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  // Os quatro pesos da escala de app/globals.css, e mais nenhum. Carregar o 300
  // e o 800 descarregava dois ficheiros que nada usava — e tê-los disponíveis é
  // parte de como se chegou a nove pesos diferentes no código.
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
});

// A entrada da equipa e o portal do doente pedem-na desde sempre (o `serif` de
// app/page.tsx), mas ninguém a carregava: o browser caía em Georgia sem falhar
// nada, e as duas únicas páginas com tipografia própria mostravam a errada.
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-newsreader',
});

export const metadata = {
  title: 'Portucale Software',
  description: 'Sistema de Gestão de Clínica Dentária',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt" className={`${plusJakarta.variable} ${jetbrainsMono.variable} ${newsreader.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
