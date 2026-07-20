"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  activePlayerProfile,
  loadProgressionStateDiagnostic,
} from "@/lib/progression";

export function JourneyHomeCta() {
  const [label, setLabel] = useState("Start your Journey");

  useEffect(() => {
    const loaded = loadProgressionStateDiagnostic();
    if (
      loaded.status === "corrupt" ||
      loaded.status === "unsupported" ||
      loaded.status === "unavailable"
    ) {
      return;
    }
    const profile = activePlayerProfile(loaded.state);
    if (!profile) return;
    const timer = window.setTimeout(
      () => setLabel(`Continue ${profile.name}'s Journey`),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Link className="button button-primary journey-home-cta" href="/journey/">
      {label}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
