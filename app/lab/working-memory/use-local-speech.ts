"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LocalDigitRecognizer,
  LocalSpeechInputError,
  localDigitRecognitionSupported,
  type LocalDigitResult,
} from "./local-digit-recognition";

export type SpeechSetup = "idle" | "loading" | "ready" | "error";
export type SpeechState = "idle" | "starting" | "recording" | "recognizing" | "complete";
export interface SpeechFailure {
  kind: "no-speech" | "timeout" | "uncertain" | "capture";
  message: string;
}

export interface LocalSpeechInput {
  supported: boolean;
  ready: boolean;
  setup: SpeechSetup;
  state: SpeechState;
  failure: SpeechFailure | null;
  message: string;
  prepare(): Promise<void>;
  prime(): void;
  record(onRecognized: (result: LocalDigitResult) => void): Promise<void>;
  cancel(): void;
}

const UNCLEAR = "I couldn’t recognize a clear digit sequence. Please try again.";
const FAILED = "Speech input could not finish. Please try again.";

function recordingFailure(error: unknown): SpeechFailure {
  if (error instanceof LocalSpeechInputError) {
    if (error.code === "no-speech") return { kind: "no-speech", message: "I didn’t hear an answer. Please try again." };
    if (error.code === "timeout") return { kind: "timeout", message: "The recording did not finish. Please try again." };
  }
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return { kind: "capture", message: "Microphone access was not allowed. Allow access, then retry." };
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return { kind: "capture", message: "No microphone is available. Connect one to retry." };
  }
  return { kind: "capture", message: FAILED };
}

/** Recognition is independent of the expected answer and never records a score. */
export function useLocalSpeech(): LocalSpeechInput {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState<SpeechSetup>("idle");
  const [state, setState] = useState<SpeechState>("idle");
  const [failure, setFailure] = useState<SpeechFailure | null>(null);
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
          setFailure({ kind: "capture", message: FAILED });
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
    setFailure(null);
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

  const record = useCallback(async (onRecognized: (result: LocalDigitResult) => void): Promise<void> => {
    const recognizer = recognizerRef.current;
    if (!mountedRef.current || !recognizer || (stateRef.current !== "idle" && stateRef.current !== "complete")) return;
    if (!recognizer.ready) {
      setReady(false);
      const message = "Download the local speech model, then retry.";
      setFailure({ kind: "capture", message });
      setMessage(message);
      return;
    }
    const generation = ++generationRef.current;
    stateRef.current = "starting";
    setState("starting");
    setFailure(null);
    setMessage("");
    const isCurrent = () => mountedRef.current && recognizerRef.current === recognizer && generationRef.current === generation;
    const fail = (error: unknown) => {
      if (!isCurrent()) return;
      stateRef.current = "idle";
      setState("idle");
      setReady(recognizer.ready);
      if (!recognizer.ready) setSetup("error");
      const problem = recordingFailure(error);
      setFailure(problem);
      setMessage(problem.message);
    };
    try {
      await recognizer.start({ autoEndpoint: {
        onStopping: () => {
          if (!isCurrent()) return;
          stateRef.current = "recognizing";
          setState("recognizing");
        },
        onResult: (recognized) => {
          if (!isCurrent()) return;
          if (recognized.status !== "recognized" || recognized.digits.length === 0) {
            stateRef.current = "idle";
            setState("idle");
            setFailure({ kind: "uncertain", message: UNCLEAR });
            setMessage(UNCLEAR);
            return;
          }
          const digits = [...recognized.digits];
          Object.freeze(digits);
          const snapshot = Object.freeze({ ...recognized, digits });
          stateRef.current = "complete";
          setState("complete");
          onRecognized(snapshot);
        },
        onFailure: fail,
      } });
      if (!isCurrent()) return;
      if (stateRef.current === "starting") {
        stateRef.current = "recording";
        setState("recording");
      }
    } catch (error) {
      fail(error);
    }
  }, []);

  return { supported, ready, setup, state, failure, message, prepare, prime, record, cancel };
}
