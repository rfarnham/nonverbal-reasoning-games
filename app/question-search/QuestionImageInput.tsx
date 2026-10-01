"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { FULL_IMAGE_CROP, imageCropFromPoints, imageCropPixels, imageOutputSize, normalizeImageCrop, type ImageCrop } from "@/lib/question-search/image-crop";
import styles from "./question-image-input.module.css";

type QuestionImageInputProps = {
  disabled?: boolean;
  onImage: (file: File) => void;
  onError?: (message: string) => void;
  /** Pasted images use the same crop step as photos and uploads. */
  pendingFile?: File | null;
  onPendingFileConsumed?: () => void;
};
type PreparedImage = { url: string; name: string; width: number; height: number };
type Mode = "closed" | "loading" | "camera" | "crop";
const cropEdges = [["left", "Left edge"], ["top", "Top edge"], ["right", "Right edge"], ["bottom", "Bottom edge"]] as const;

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The picture could not be saved. Please try another image.")), "image/jpeg", 0.96));
}

export default function QuestionImageInput({ disabled = false, onImage, onError, pendingFile, onPendingFileConsumed }: QuestionImageInputProps) {
  const [mode, setMode] = useState<Mode>("closed");
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [crop, setCrop] = useState<ImageCrop>(FULL_IMAGE_CROP);
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageUrl = useRef<string | null>(null);
  const serial = useRef(0);
  const mounted = useRef(true);
  const consumedFile = useRef<File | null>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const titleId = useId();
  const helpId = useId();
  const open = mode !== "closed";

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  const clearImage = useCallback(() => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = null;
  }, []);
  const close = useCallback(() => {
    serial.current++;
    stopCamera(); clearImage(); drag.current = null;
    setStream(null); setPrepared(null); setSaving(false); setMode("closed");
    dialog.current?.close();
    returnFocus.current?.focus();
  }, [clearImage, stopCamera]);
  const report = useCallback((message: string) => { setError(message); onError?.(message); }, [onError]);
  const rememberFocus = useCallback(() => {
    if (!dialog.current?.open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    // This is an async request generation counter, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; serial.current++; stopCamera(); clearImage(); };
  }, [clearImage, stopCamera]);
  useEffect(() => {
    if (open && !dialog.current?.open) { dialog.current?.showModal(); cancelButton.current?.focus(); }
  }, [open]);

  const chooseFile = useCallback(async (file: File) => {
    if (!mounted.current) return;
    rememberFocus();
    const request = ++serial.current;
    stopCamera(); clearImage(); setStream(null); setPrepared(null); setCameraReady(false); setImageReady(false);
    setError(""); setSaving(false); setMode("loading");
    try {
      if (!file.type.startsWith("image/") || file.size > 20_000_000) throw new Error("Choose a picture smaller than 20 MB.");
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(file); }
      catch { throw new Error("This picture format could not be opened. Try a JPEG, PNG, or WebP image."); }
      let width: number; let height: number;
      try {
        width = bitmap.width; height = bitmap.height;
        if (!width || !height || width * height > 60_000_000) throw new Error("Choose a picture with fewer than 60 million pixels.");
      } finally { bitmap.close(); }
      if (!mounted.current || serial.current !== request) return;
      const url = URL.createObjectURL(file); imageUrl.current = url;
      setPrepared({ url, name: file.name, width, height }); setCrop(FULL_IMAGE_CROP); setMode("crop");
    } catch (cause) {
      if (mounted.current && serial.current === request) report(cause instanceof Error ? cause.message : "The picture could not be opened.");
    }
  }, [clearImage, rememberFocus, report, stopCamera]);

  useEffect(() => {
    if (!pendingFile) { consumedFile.current = null; return; }
    if (disabled || pendingFile === consumedFile.current) return;
    consumedFile.current = pendingFile;
    void Promise.resolve().then(() => { onPendingFileConsumed?.(); return chooseFile(pendingFile); });
  }, [chooseFile, disabled, onPendingFileConsumed, pendingFile]);

  async function startCamera() {
    rememberFocus();
    // A device's capture picker also works where a live browser camera is unavailable.
    if (!navigator.mediaDevices?.getUserMedia) { nativeCamera.current?.click(); return; }
    const request = ++serial.current;
    stopCamera(); clearImage(); setPrepared(null); setStream(null); setCameraReady(false); setError(""); setSaving(false); setMode("camera");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
      if (!mounted.current || serial.current !== request) { media.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = media; setStream(media);
    } catch {
      if (mounted.current && serial.current === request) report("The browser camera could not open. Allow camera access, or use your device camera or upload a picture below.");
    }
  }
  useEffect(() => {
    const preview = video.current;
    if (!stream || !preview) return;
    preview.srcObject = stream;
    void preview.play().catch(() => {
      if (streamRef.current === stream && mounted.current) report("The camera preview could not play. Use your device camera or upload a picture below.");
    });
  }, [report, stream]);

  async function takePhoto() {
    const preview = video.current;
    if (!preview?.videoWidth || !preview.videoHeight || saving) return;
    const request = serial.current;
    setSaving(true); setError("");
    try {
      const size = imageOutputSize(preview.videoWidth, preview.videoHeight);
      const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The camera image could not be captured.");
      context.drawImage(preview, 0, 0, size.width, size.height);
      const blob = await canvasBlob(canvas);
      if (mounted.current && serial.current === request) await chooseFile(new File([blob], "question-photo.jpg", { type: "image/jpeg" }));
    } catch (cause) {
      if (mounted.current && serial.current === request) { setSaving(false); report(cause instanceof Error ? cause.message : "The photo could not be captured."); }
    }
  }
  async function applyCrop() {
    if (!prepared || !image.current || !imageReady || saving) return;
    const request = serial.current;
    setSaving(true); setError("");
    try {
      const pixels = imageCropPixels(crop, image.current.naturalWidth, image.current.naturalHeight);
      if (pixels.width < 16 || pixels.height < 16) throw new Error("Keep a larger area so the question remains readable.");
      const size = imageOutputSize(pixels.width, pixels.height);
      const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cropping is unavailable in this browser.");
      context.fillStyle = "white"; context.fillRect(0, 0, size.width, size.height);
      context.drawImage(image.current, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, size.width, size.height);
      const blob = await canvasBlob(canvas);
      if (!mounted.current || serial.current !== request) return;
      const file = new File([blob], `${prepared.name.replace(/\.[^.]+$/, "") || "question"}-cropped.jpg`, { type: "image/jpeg" });
      close(); onImage(file);
    } catch (cause) {
      if (mounted.current && serial.current === request) { setSaving(false); report(cause instanceof Error ? cause.message : "The crop could not be saved."); }
    }
  }
  function pointerPosition(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  function startCrop(event: PointerEvent<HTMLDivElement>) {
    if (saving || !imageReady || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { ...pointerPosition(event), pointerId: event.pointerId };
  }
  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const end = pointerPosition(event);
    if (Math.abs(drag.current.x - end.x) > .01 || Math.abs(drag.current.y - end.y) > .01) setCrop(imageCropFromPoints(drag.current, end));
  }
  function finishCrop(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    // A simple tap keeps the existing crop; only a deliberate drag replaces it.
    const end = pointerPosition(event);
    if (Math.abs(drag.current.x - end.x) > .01 || Math.abs(drag.current.y - end.y) > .01) setCrop(imageCropFromPoints(drag.current, end));
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className={styles.input}>
    <div className={styles.buttons}>
      <button type="button" className={styles.secondary} disabled={disabled} onClick={() => upload.current?.click()}>Upload picture</button>
      <button type="button" className={styles.secondary} disabled={disabled} onClick={() => void startCamera()}>Take picture</button>
    </div>
    <input ref={upload} className={styles.hidden} type="file" accept="image/*" aria-label="Upload a question picture" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseFile(file); }} />
    <input ref={nativeCamera} className={styles.hidden} type="file" accept="image/*" capture="environment" aria-label="Take a question picture with your device" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseFile(file); }} />
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
      <div className={styles.header}><h2 id={titleId}>{mode === "camera" ? "Take a question picture" : "Crop to the question"}</h2><button ref={cancelButton} type="button" className={styles.secondary} onClick={close}>Cancel</button></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {mode === "loading" && !error && <p role="status">Opening picture…</p>}
      {mode === "camera" && <>
        <video ref={video} className={styles.video} autoPlay muted playsInline aria-label="Live camera preview" onLoadedMetadata={() => setCameraReady(true)} />
        {!stream && !error && <p role="status">Waiting for camera access…</p>}
        <p className={styles.help}>Include the question, diagrams, and answer choices. You can crop it next.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!cameraReady || saving} onClick={() => void takePhoto()}>{saving ? "Taking picture…" : "Capture picture"}</button>
          <button type="button" className={styles.secondary} onClick={() => { close(); nativeCamera.current?.click(); }}>Use device camera</button>
          <button type="button" className={styles.secondary} onClick={() => { close(); upload.current?.click(); }}>Upload instead</button>
        </div>
      </>}
      {mode === "loading" && error && <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => upload.current?.click()}>Choose another picture</button></div>}
      {mode === "crop" && prepared && <>
        <p id={helpId} className={styles.help}>Drag a box around the question, or adjust the four edges below. Keep its diagrams and answer choices.</p>
        <div className={styles.cropFrame}>
          <div className={styles.cropImage} onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={finishCrop} onPointerCancel={() => { drag.current = null; }}>
            {/* User-provided object URLs are never remote assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={image} src={prepared.url} width={prepared.width} height={prepared.height} alt="Your question picture before cropping" draggable={false} onLoad={() => setImageReady(true)} onError={() => report("This picture could not be displayed. Try another image.")} />
            <div aria-hidden="true" className={styles.cropSelection} style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${(crop.right - crop.left) * 100}%`, height: `${(crop.bottom - crop.top) * 100}%` }} />
          </div>
        </div>
        <fieldset className={styles.edges} disabled={saving} aria-describedby={helpId}><legend>Crop edges</legend>{cropEdges.map(([edge, label]) => {
          const low = edge === "right" ? crop.left * 100 + 1 : edge === "bottom" ? crop.top * 100 + 1 : 0;
          const high = edge === "left" ? crop.right * 100 - 1 : edge === "top" ? crop.bottom * 100 - 1 : 100;
          return <label key={edge}>{label} <span>{Math.round(crop[edge] * 100)}%</span><input type="range" min={low} max={high} step={0.1} value={crop[edge] * 100} onChange={event => setCrop(previous => normalizeImageCrop({ ...previous, [edge]: Number(event.target.value) / 100 }))} /></label>;
        })}</fieldset>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={!imageReady || saving} onClick={() => void applyCrop()}>{saving ? "Preparing picture…" : "Use cropped picture"}</button><button type="button" className={styles.secondary} disabled={saving} onClick={() => setCrop(FULL_IMAGE_CROP)}>Reset to full picture</button></div>
        <p className={styles.help}>Cropping happens on this device. Text extraction starts after you use the picture.</p>
      </>}
    </dialog>
  </div>;
}
