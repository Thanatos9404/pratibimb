import Link from "next/link";

import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="light-scope sky-fade-soft grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Logo size={48} className="mx-auto" />
        <h1 className="h-display mt-6 text-[44px]">Nothing reflects here.</h1>
        <p className="mt-3 text-[16px] text-body">That page or patient does not exist in this synthetic cohort.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/console" className="pill-dark">
            Open the console
          </Link>
          <Link href="/" className="pill-light">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
