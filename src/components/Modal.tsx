import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

interface Props {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "normal" | "wide" | "full";
}

export function Modal({ title, sub, onClose, children, footer, size = "normal" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useLatest(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog so keyboard users are not left behind it.
    ref.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${size === "normal" ? "" : size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Ya, lanjutkan",
  tone = "danger",
  onConfirm,
  onClose,
  busy,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Batal
          </button>
          <button className={`btn ${tone}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Memproses…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="rich">{typeof message === "string" ? <p>{message}</p> : message}</div>
    </Modal>
  );
}
