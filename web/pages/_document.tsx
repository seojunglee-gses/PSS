import { Html, Head, Main, NextScript } from "next/document";
import { browserCompatibilityScript } from "../lib/browser-compat";

export default function Document() {
  return <Html>
    <Head><script dangerouslySetInnerHTML={{ __html: browserCompatibilityScript }} /></Head>
    <body><Main /><NextScript /></body>
  </Html>;
}
