"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ModalDialogProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
};

type WizardDialogProps = Omit<ModalDialogProps, "eyebrow" | "footer"> & {
  step: number;
  steps: readonly string[];
  onBack: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  formId: string;
  submitLabel: string;
};

/** Fixed-progress wizard controls shared by all create and edit flows. */
export function WizardDialog({
  step, steps, onBack, onNext, nextDisabled = false, formId, submitLabel, ...props
}: WizardDialogProps) {
  const lastStep = step === steps.length - 1;
  return (
    <ModalDialog
      {...props}
      eyebrow={`Step ${step + 1} of ${steps.length}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" disabled={step === 0} onClick={onBack} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 disabled:opacity-30">Back</button>
          {lastStep ? (
            <button type="submit" form={formId} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black">{submitLabel}</button>
          ) : (
            <button type="button" disabled={nextDisabled} onClick={onNext} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">Next</button>
          )}
        </div>
      }
    >
      <div className="mb-5 flex gap-1" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((label, index) => <span key={label} className="h-1 flex-1 rounded-full" style={{ background: index <= step ? "#c6f135" : "rgba(255,255,255,0.12)" }} />)}
      </div>
      {props.children}
    </ModalDialog>
  );
}

/** Shared viewport-safe dialog frame for creation and settings forms. */
export default function ModalDialog({
  title,
  eyebrow,
  description,
  children,
  footer,
  onClose,
}: ModalDialogProps) {
  useEffect(() => {
    const documentElement = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const previousDocumentOverflow = documentElement.style.overflow;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    // Keep the application shell fixed while a dialog is open. The dialog's
    // own content region is the only scroll container, so its actions remain
    // in the viewport on short desktop and mobile screens.
    documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/80 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Dialog"}
        className="relative flex w-full max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0d0d0d] shadow-2xl"
      >
        <header className="flex-shrink-0 border-b border-white/[0.08] px-4 py-4 sm:px-6 sm:py-5">
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
          {children}
        </div>
        {footer && <footer className="flex-shrink-0 border-t border-white/[0.08] px-4 py-3 sm:px-6">{footer}</footer>}
      </section>
    </div>
  );

  // This must live directly below <body>. The create/edit triggers are often
  // rendered in PageHeader, whose entrance animation has a CSS transform.
  // A transformed ancestor becomes the containing block for position: fixed,
  // placing an inline dialog relative to the header instead of the viewport.
  return typeof document === "undefined" ? null : createPortal(dialog, document.body);
}
