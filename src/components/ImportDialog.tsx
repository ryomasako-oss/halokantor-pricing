/* Drag-and-drop importer. The file is parsed in the browser; only the
   resulting rows are sent to the server. */

import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import type { ImportReport } from "../import/parsers";

interface Props {
  title: string;
  description: React.ReactNode;
  accept?: string;
  onClose: () => void;
  onFile: (file: File) => Promise<{ report: ImportReport; summary: string }>;
}

export function ImportDialog({ title, description, accept = ".xlsx,.xls,.csv", onClose, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ report: ImportReport; summary: string } | null>(null);

  const handle = async (file?: File | null) => {
    if (!file) return;
    setError("");
    setResult(null);
    setBusy(true);
    try {
      setResult(await onFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "File tidak bisa dibaca.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>Selesai</button>
        ) : (
          <button className="btn ghost" onClick={onClose}>Tutup</button>
        )
      }
    >
      <div
        className={`drop ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handle(e.dataTransfer.files?.[0]);
        }}
      >
        <Icon name="upload" size={24} />
        <div>
          <strong>Tarik file ke sini atau pilih dari komputer</strong>
          <div className="muted small">{description}</div>
        </div>
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Membaca file…" : "Pilih file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </div>

      {error && <p className="notice error" style={{ marginTop: 12 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 14 }}>
          <p className="notice ok">{result.summary}</p>
          {result.report.notes.length > 0 && (
            <ul className="breach-list" style={{ marginTop: 10 }}>
              {result.report.notes.map((n, i) => (
                <li key={i} className="breach warn">
                  <Icon name="clock" size={14} />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
