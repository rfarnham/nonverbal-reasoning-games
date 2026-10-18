"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LocalDigitRecognizer,
  localDigitRecognitionSupported,
  type LocalDigitResult,
} from "./local-digit-recognition";

export type SpeechSetup = "idle" | "loading" | "ready" | "error";
export type SpeechState = "idle" | "starting" | "recording" | "recognizing" | "review";

export interface LocalSpeechInput {
  supported: boolean;
  ready: boolean;
  setup: SpeechSetup;
  state: SpeechState;
  result: LocalDigitResult | null;
  message: string;
  prepare(): Promise<void>;
  prime(): void;
  record(): Promise<void>;
  stop(): Promise<LocalDigitResult | null>;
  cancel(): void;
}

const UNCLEAR = "Could not recognize a clear digit sequence. Record again; this attempt was not scored.";
const FAILED = "Speech input could not finish. Record again or use the keypad; this attempt was not scored.";

function recordingFailure(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access was not allowed. Allow access to record, or use the keypad; this attempt was not scored.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone is available. Connect one or use the keypad; this attempt was not scored.";
  }
  return FAILED;
}

/** Recognition is independent of the expected answer and never records a score. */
export function useLocalSpeech(): LocalSpeechInput {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState<SpeechSetup>("idle");
  const [state, setState] = useState<SpeechState>("idle");
  const [result, setResult] = useState<LocalDigitResult | null>(null);
  const [message, setMessage] = useState("");
  const recognizerRef = useRef<LocalDigitRecognizer | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  // Setup belongs to the loaded model, so cancelling a round does not discard it.
  const setupGenerationRef = useRef(0);
  const preparingRef = useRef(false);
  const stateRef = useRef<SpeechState>("idle");

  useEffect(() => {
    mountedRef.current = true;
    const recognizer = new LocalDigitRecognizer({
      onError: () => {
        if (!mountedRef.current || recognizerRef.current !== recognizer) return;
        const generation = ++generationRef.current;
        stateRef.current = "idle";
        recognizer.cancel();
        // Read availability after backend cleanup and ignore a newer job.
        queueMicrotask(() => {
          if (!mountedRef.current || recognizerRef.current !== recognizer) return;
          setReady(recognizer.ready);
          if (!recognizer.ready) setSetup("error");
          if (generationRef.current !== generation) return;
          setState("idle");
          setResult(null);
          setMessage(FAILED);
        });
      },
    });
    recognizerRef.current = recognizer;
    const frame = requestAnimationFrame(() => {
      if (mountedRef.current && recognizerRef.current === recognizer) setSupported(localDigitRecognitionSupported());
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      setupGenerationRef.current += 1;
      preparingRef.current = false;
      stateRef.current = "idle";
      cancelAnimationFrame(frame);
      recognizerRef.current = null;
      recognizer.dispose();
    };
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    stateRef.current = "idle";
    recognizerRef.current?.cancel();
    if (!mountedRef.current) return;
    setState("idle");
    setResult(null);
    setMessage("");
  }, []);

  const prepare = useCallback(async (): Promise<void> => {
    const recognizer = recognizerRef.current;
    if (!mountedRef.current || !recognizer || preparingRef.current) return;
    if (!localDigitRecognitionSupported()) {
      setSupported(false);
      setReady(false);
      setSetup("error");
      setMessage("Local speech input is unavailable in this browser. Use the keypad.");
      return;
    }
    preparingRef.current = true;
    const generation = ++setupGenerationRef.current;
    setSetup("loading");
    setMessage("");
    try {
      await recognizer.prepare();
      if (!mountedRef.current || recognizerRef.current !== recognizer || setupGenerationRef.current !== generation) return;
      setReady(recognizer.ready);
      setSetup(recognizer.ready ? "ready" : "error");
      if (!recognizer.ready) setMessage("Could not load local speech. Try downloading the model again or use the keypad.");
    } catch {
      if (!mountedRef.current || recognizerRef.current !== recognizer || setupGenerationRef.current !== generation) return;
      setReady(false);
      setSetup("error");
      setMessage("Could not load local speech. Try downloading the model again or use the keypad.");
    } finally {
      if (recognizerRef.current === recognizer && setupGenerationRef.current === generation) preparingRef.current = false;
    }
  }, []);

  const prime = useCallback((): void => {
    if (!mountedRef.current) return;
    recognizerRef.current?.prime();
  }, []);

  const record = useCallback(async (): Promise<void> => {
    const recognizer = recognizerRef.current;
    if (!mountedRef.current || !recognizer || (stateRef.current !== "idle" && stateRef.current !== "review")) return;
    if (!recognizer.ready) {
      setReady(false);
      setMessage("Download the local speech model before recording.");
      return;
    }
    const generation = ++generationRef.current;
    stateRef.current = "starting";
    setState("starting");
    setResult(null);
    setMessage("");
    try {
      await recognizer.start();
      if (!mountedRef.current || recognizerRef.current !== recognizer || generationRef.current !== generation) return;
      stateRef.current = "recording";
      setState("recording");
    } catch (error) {
      if (!mountedRef.current || recognizerRef.current !== recognizer || generationRef.current !== generation) return;
      stateRef.current = "idle";
      setState("idle");
      setResult(null);
      setReady(recognizer.ready);
      if (!recognizer.ready) setSetup("error");
      setMessage(recordingFailure(error));
    }
  }, []);

  const stop = useCallback(async (): Promise<LocalDigitResult | null> => {
    const recognizer = recognizerRef.current;
    if (!mountedRef.current || !recognizer || stateRef.current !== "recording") return null;
    const generation = ++generationRef.current;
    stateRef.current = "recognizing";
    setState("recognizing");
    setResult(null);
    setMessage("");
    try {
      const recognized = await recognizer.stop();
      if (!mountedRef.current || recognizerRef.current !== recognizer || generationRef.current !== generation) return null;
      if (recognized.status !== "recognized" || recognized.digits.length === 0) {
        stateRef.current = "idle";
        setState("idle");
        setMessage(UNCLEAR);
        return null;
      }
      const digits = [...recognized.digits];
      Object.freeze(digits);
      const snapshot = Object.freeze({ ...recognized, digits });
      stateRef.current = "review";
      setResult(snapshot);
      setState("review");
      return snapshot;
    } catch (error) {
      if (!mountedRef.current || recognizerRef.current !== recognizer || generationRef.current !== generation) return null;
      stateRef.current = "idle";
      setState("idle");
      setResult(null);
      setReady(recognizer.ready);
      if (!recognizer.ready) setSetup("error");
      setMessage(recordingFailure(error));
      return null;
    }
  }, []);

  return { supported, ready, setup, state, result, message, prepare, prime, record, stop, cancel };
}
