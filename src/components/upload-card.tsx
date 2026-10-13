"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadMenu } from "@/app/actions/upload-menu";
import { saveMenuSession } from "@/lib/session";

export function UploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (candidate: File | undefined) => {
    setError(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please choose an .xlsx spreadsheet.");
      return;
    }
    setFile(candidate);
  };

  const start = () => {
    if (!file) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.append("menu", file);
      const result = await uploadMenu(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      saveMenuSession(result.session);
      router.push("/chat");
    });
  };

  return (
    <div
      id="upload"
      className="relative mx-auto -mt-24 w-full max-w-xl rounded-2xl bg-white p-3 shadow-xl"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files[0]);
        }}
        className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? "border-brand bg-brand-soft" : "border-brand/30 bg-brand-soft/40"
        }`}
      >
        <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M12 17v-6 M9.5 13.5 12 11l2.5 2.5" />
          </svg>
        </span>
        <h2 className="mt-4 font-bold">Demo: Upload Today&apos;s Menu (.xlsx)</h2>
        <p className="mt-1 text-sm text-ink/60">
          Drag and drop your restaurant spreadsheet here to see the AI waiter in action.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 rounded-full border border-ink/10 bg-white px-4 py-1.5 text-sm font-semibold shadow-sm hover:border-brand"
        >
          {file ? file.name : "Select File"}
        </button>

        <button
          type="button"
          onClick={start}
          disabled={!file || pending}
          className="mt-6 w-full max-w-xs rounded-full bg-brand py-2.5 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Teaching the waiter your menu…" : "Start Chatting"}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-ink/40">Your menu is only used for this browser session.</p>
      </div>
    </div>
  );
}
