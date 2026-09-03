"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalDialogProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  maxWidth?: "2xl" | "3xl";
};

/** Shared viewport-safe dialog frame for creation and settings forms. */
export default function ModalDialog({
  title,
  eyebrow,
  description,
  children,
  footer,
  onClose,
  maxWidth = "2xl",
}: ModalDialogProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto p-3 sm:p-6">
      <button
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 z-0 bg-black/70 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Dialog"}
        className={`panel relative z-10 flex w-full ${maxWidth === "3xl" ? "max-w-3xl" : "max-w-2xl"} max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl bg-[#0a0c12] shadow-2xl animate-fade-up sm:max-h-[90vh]`}
      >
        <header className="shrink-0 border-b border-white/[0.06] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
              <h3 className="font-display text-lg font-bold text-white">{title}</h3>
              {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
        {footer && <footer className="shrink-0 border-t border-white/[0.06] bg-[#0a0c12] px-4 py-3 sm:px-6">{footer}</footer>}
      </section>
    </div>
  );
}
