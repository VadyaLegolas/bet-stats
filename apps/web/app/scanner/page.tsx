import type { Metadata } from "next";

import { readScanner } from "./scanner-data";
import { ScannerView } from "./scanner-view";

// Request-time data: the page must never be rendered at build time and frozen.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Сканер value" };

export default async function ScannerPage() {
  return <ScannerView data={await readScanner()} />;
}
