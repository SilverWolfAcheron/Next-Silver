import { useEffect, useRef } from "react";
import type { JSX, KeyboardEvent, MouseEvent, RefObject, SyntheticEvent } from "react";
import type { ModalDialogProps } from "../../types/common";

export function ModalDialog({
  labelledBy,
  className,
  onClose,
  onEscape,
  restoreFocus,
  children,
}: ModalDialogProps): JSX.Element {
  const dialogRef: RefObject<HTMLDialogElement | null> = useRef<HTMLDialogElement>(null);

  useEffect((): (() => void) => {
    const previous: Element | null = document.activeElement;
    const dialog: HTMLDialogElement | null = dialogRef.current;
    dialog?.showModal();
    return (): void => {
      dialog?.close();
      const shouldRestore: boolean = restoreFocus ? restoreFocus() : true;
      if (shouldRestore && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      className={className}
      onCancel={(event: SyntheticEvent<HTMLDialogElement>): void => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDialogElement>): void => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (onEscape) onEscape();
          else onClose();
        }
      }}
      onClick={(event: MouseEvent<HTMLDialogElement>): void => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
