"use client";

import Link from "next/link";

export function MathWorldHomeLink() {
  return (
    <Link
      className="button button-primary math-world-home-cta"
      href="/math-world/"
      prefetch={false}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        // A fresh document can read the existing Worlds-scoped password cookie.
        // SPA entry from the homepage keeps that cookie outside its cookie URL.
        event.preventDefault();
        window.location.assign(event.currentTarget.href);
      }}
    >
      Explore Counting Coast <span aria-hidden="true">→</span>
    </Link>
  );
}
