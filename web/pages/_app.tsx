import type { AppProps } from "next/app";
import "../styles/globals.css";
import { AuthProvider } from "../lib/auth";
import { I18nProvider } from "../lib/i18n";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <I18nProvider>
        <Component {...pageProps} />
      </I18nProvider>
    </AuthProvider>
  );
}
