/** Lets a widget hand a request to the Assistant panel, which opens and sends it. */
const EVENT = "mypa:ask-assistant";

export function askAssistant(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}

export function onAskAssistant(cb: (text: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
