"use client";

import { useEffect, useRef, useState } from "react";
import { checkCompanion, type FrontierConnection } from "@/lib/question-search/frontier";
import { FRONTIER_LIMITS } from "@/lib/question-search/frontier-protocol";
import styles from "./question-search.module.css";

const maxRequests = 1 + Math.ceil(FRONTIER_LIMITS.shortlist / FRONTIER_LIMITS.batch);
const models = { openai: "gpt-6-astra", gemini: "gemini-3.1-pro-preview" };

export default function FrontierControls({ connection, onChange, disabled }: {
  connection: FrontierConnection;
  onChange: (connection: FrontierConnection) => void;
  disabled: boolean;
}) {
  const [test, setTest] = useState<{ message: string; failed: boolean; busy: boolean }>({ message: "", failed: false, busy: false });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  function change(next: FrontierConnection) {
    request.current?.abort(); request.current = null;
    setTest({ message: "", failed: false, busy: false });
    onChange(next);
  }
  async function testConnection() {
    if (connection.kind !== "companion") return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setTest({ message: "Checking companion…", failed: false, busy: true });
    try {
      const status = await checkCompanion(connection, controller.signal);
      if (request.current === controller && !controller.signal.aborted) setTest({ message: `Connected to ${status.backend} · ${status.model}. Subscription mode.`, failed: false, busy: false });
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) setTest({ message: error instanceof Error ? error.message : "Could not connect to the companion.", failed: true, busy: false });
    }
  }
  return <div className={styles.frontierControls}>
    <label className={styles.field}>Search with<select aria-label="Search with" value={connection.kind} disabled={disabled} onChange={(event) => {
      const kind = event.target.value;
      change(kind === "api" ? { kind, provider: "openai", apiKey: "", model: models.openai } : kind === "companion" ? { kind, url: "http://127.0.0.1:4318", token: "" } : { kind: "local" });
    }}><option value="local">Search locally</option><option value="api">My API key</option><option value="companion">My companion</option></select></label>
    {connection.kind === "local" && <p className={styles.finePrint}>Search the precomputed index on this device. No AI account needed.</p>}
    {connection.kind === "api" && <>
      <label className={styles.field}>AI provider<select aria-label="AI provider" disabled={disabled} value={connection.provider} onChange={(event) => {
        const provider = event.target.value as "openai" | "gemini";
        change({ kind: "api", provider, apiKey: "", model: models[provider] });
      }}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option></select></label>
      <label className={styles.field}>API key<input type="password" autoComplete="off" spellCheck={false} value={connection.apiKey} disabled={disabled} onChange={(event) => change({ ...connection, apiKey: event.target.value })} placeholder="Your provider API key" required /></label>
      <label className={styles.field}>Model<input autoComplete="off" spellCheck={false} value={connection.model} disabled={disabled} maxLength={100} onChange={(event) => change({ ...connection, model: event.target.value })} required /><span className={styles.finePrint}>Choose a vision-capable model available to your API account.</span></label>
      <p className={styles.frontierDisclosure}>Searching sends your question, picture, and selected candidates directly to {connection.provider === "openai" ? "OpenAI" : "Google"}. Each search makes at most {maxRequests} AI requests. API usage is charged to your account separately from a chat subscription.</p>
      <button type="button" className={styles.textButton} disabled={disabled || !connection.apiKey} onClick={() => change({ ...connection, apiKey: "" })}>Clear API key</button>
    </>}
    {connection.kind === "companion" && <>
      <label className={styles.field}>Companion address<input type="url" autoComplete="off" spellCheck={false} value={connection.url} disabled={disabled} onChange={(event) => change({ ...connection, url: event.target.value })} placeholder="https://your-computer.example" required /><span className={styles.finePrint}>Use HTTPS for another device, or localhost on this computer. Allow local network access if your browser asks.</span></label>
      <label className={styles.field}>Companion access token<input type="password" autoComplete="off" spellCheck={false} value={connection.token} disabled={disabled} onChange={(event) => change({ ...connection, token: event.target.value })} placeholder="Token from your companion" required /><span className={styles.finePrint}>This is separate from the bank password.</span></label>
      <div className={styles.connectionActions}><button type="button" className={styles.secondary} disabled={disabled || test.busy || !connection.url.trim() || !connection.token.trim()} onClick={() => void testConnection()}>{test.busy ? "Checking…" : "Test connection"}</button><button type="button" className={styles.textButton} disabled={disabled || !connection.token} onClick={() => change({ ...connection, token: "" })}>Clear token</button></div>
      <div aria-live="polite" aria-atomic="true">{test.message && <p className={test.failed ? styles.error : styles.finePrint}>{test.message}</p>}</div>
      <details className={styles.companionQuickstart}><summary>Use Codex on this laptop</summary><ol><li>Sign into the Codex CLI with your ChatGPT account.</li><li>In this project, run <code>npm run search:companion</code> and leave it running.</li><li>Use <code>http://127.0.0.1:4318</code> above. Copy the token from <code>work/question-search-companion/token</code>.</li><li>Test the connection, add your picture, then select <strong>Search with AI</strong>.</li></ol><p>If the hosted page cannot reach localhost, open the search page from your local project on port 3000. No home server is needed.</p></details>
      <a className={styles.textButton} href="https://github.com/rfarnham/nonverbal-reasoning-games/blob/main/docs/question-search.md#set-up-the-personal-companion" target="_blank" rel="noopener noreferrer">Companion setup instructions ↗</a>
      <p className={styles.frontierDisclosure}>Searching sends your question and selected candidates to your companion and its AI provider. Your computer must be online and reachable. Only its subscription allowance is used.</p>
    </>}
    {connection.kind !== "local" && <p className={styles.finePrint}>Credentials stay in memory for this visit and clear when you lock the bank or leave. The bank password is never sent to AI.</p>}
  </div>;
}
