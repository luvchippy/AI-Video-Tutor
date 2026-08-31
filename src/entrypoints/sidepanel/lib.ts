import type {
  BackgroundRequest,
  BackgroundResponse,
  ChatPortMessage,
  ChatStartPayload,
} from '@/types/messaging';

export async function sendBackground(
  req: BackgroundRequest,
): Promise<BackgroundResponse> {
  return (await browser.runtime.sendMessage(req)) as BackgroundResponse;
}

export interface ChatConnection {
  start(payload: ChatStartPayload): void;
  abort(): void;
  disconnect(): void;
}

export function connectChat(
  onMessage: (msg: ChatPortMessage) => void,
): ChatConnection {
  const port = browser.runtime.connect({ name: 'chat' });
  port.onMessage.addListener((m) => onMessage(m as ChatPortMessage));
  return {
    start: (payload) =>
      port.postMessage({ type: 'CHAT_START', payload } satisfies ChatPortMessage),
    abort: () => port.postMessage({ type: 'CHAT_ABORT' } satisfies ChatPortMessage),
    disconnect: () => port.disconnect(),
  };
}
