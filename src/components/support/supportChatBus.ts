/**
 * Tiny event bus so any component can open the support chat without the
 * launcher having to be a shared parent.
 *
 * A store (Zustand) would work too, but the chat is opened from a handful of
 * places and never read from, so a browser event keeps the coupling to one
 * function call and avoids adding the launcher to any existing component's
 * props or provider tree.
 */

export type SupportChatContext = {
  /** Product the customer was looking at, so the team has context. */
  productName?: string;
  productCode?: string;
  /** Optional opening question, e.g. from a Help Centre topic card. */
  topic?: string;
};

const EVENT = "linx:open-support-chat";

/** Open the support chat, optionally carrying page context. */
export function openSupportChat(context: SupportChatContext = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: context }));
}

/** Subscribe the launcher to open requests. Returns an unsubscribe function. */
export function onOpenSupportChat(
  handler: (context: SupportChatContext) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) =>
    handler(((e as CustomEvent).detail || {}) as SupportChatContext);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
