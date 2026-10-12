import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;

const ConfirmationContext = createContext<ConfirmAction | null>(null);

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error("useConfirmation must be used inside ConfirmationProvider.");
  return confirm;
}

export default function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmationOptions | null>(null);
  const resolveRequest = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  function confirm(options: ConfirmationOptions) {
    if (resolveRequest.current) return Promise.resolve(false);
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolveRequest.current = resolve;
    });
  }

  function finish(confirmed: boolean) {
    const resolve = resolveRequest.current;
    resolveRequest.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }

  useEffect(() => {
    if (!request) return;
    cancelButton.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [request]);

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {request && createPortal(
        <div className="confirmation-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) finish(false);
        }}>
          <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
            <h2 id="confirmation-title">{request.title}</h2>
            <p id="confirmation-message">{request.message}</p>
            <div className="confirmation-actions">
              <button ref={cancelButton} type="button" className="button secondary" onClick={() => finish(false)}>Hủy</button>
              <button
                type="button"
                className={`button ${request.destructive ? "danger" : "primary"}`}
                onClick={() => finish(true)}
              >
                {request.confirmLabel ?? "Xác nhận"}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </ConfirmationContext.Provider>
  );
}
