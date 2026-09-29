"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./playtest-gate.module.css";

const COOKIE_NAME = "spatial-gym-worlds-access";
const COOKIE_VALUE = "playtest-v1";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const COOKIE_PATH = `${basePath}/math-world/`;

// Keep an accepted password usable for this tab even when cookies are blocked.
let sessionAccessGranted = false;

function hasRememberedAccess(): boolean {
  if (sessionAccessGranted) return true;
  try {
    return document.cookie.split(";").some(cookie => cookie.trim() === `${COOKIE_NAME}=${COOKIE_VALUE}`);
  } catch {
    return false;
  }
}

function rememberAccess(): void {
  sessionAccessGranted = true;
  try {
    const expires = new Date(Date.now() + COOKIE_MAX_AGE * 1000).toUTCString();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NAME}=${COOKIE_VALUE}; Max-Age=${COOKIE_MAX_AGE}; Expires=${expires}; Path=${COOKIE_PATH}; SameSite=Lax${secure}`;
  } catch {
    // The current tab remains unlocked when persistent storage is unavailable.
  }
}

export default function PlaytestGate({ children }: Readonly<{ children: ReactNode }>) {
  const [access, setAccess] = useState<"checking" | "locked" | "open">("checking");
  const [password, setPassword] = useState("");
  const [incorrect, setIncorrect] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAccess(hasRememberedAccess() ? "open" : "locked");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (access === "locked") inputRef.current?.focus();
  }, [access]);

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== "hedgehog") {
      setIncorrect(true);
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    rememberAccess();
    setPassword("");
    setAccess("open");
  }

  if (access === "open") return children;

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="playtest-heading">
        <span className={styles.emblem} aria-hidden="true">✦</span>
        <p className={styles.kicker}>Playtest</p>
        <h1 id="playtest-heading">Math Kangaroo<br />Worlds</h1>
        {access === "checking" ? (
          <p className={styles.description} role="status">Opening your adventure…</p>
        ) : (
          <>
            <p className={styles.description}>Enter the playtest password to explore the worlds.</p>
            <form className={styles.form} onSubmit={submitPassword}>
              <label htmlFor="playtest-password">Playtest password</label>
              <input
                ref={inputRef}
                id="playtest-password"
                name="password"
                type="password"
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={password}
                aria-invalid={incorrect}
                aria-describedby={incorrect ? "playtest-password-error" : undefined}
                onChange={event => {
                  setPassword(event.target.value);
                  setIncorrect(false);
                }}
              />
              <p id="playtest-password-error" className={styles.error} role="alert">
                {incorrect && <><span aria-hidden="true">× </span>That password did not match. Try again.</>}
              </p>
              <button type="submit">Enter worlds <span aria-hidden="true">→</span></button>
            </form>
            <Link className={styles.homeLink} href="/">Back to all games</Link>
          </>
        )}
      </section>
    </main>
  );
}
