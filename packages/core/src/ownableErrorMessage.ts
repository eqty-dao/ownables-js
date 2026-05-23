type ErrorWithShortMessage = Error & { shortMessage?: unknown };

function hasShortMessage(error: Error): error is ErrorWithShortMessage {
  return 'shortMessage' in error;
}

export default function ownableErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? error : 'Internal error';
  }

  const message = error.message;

  if (message.match(/^Ownable \w+ failed$/) && error.cause instanceof Error) {
    return error.cause.message.replace(/^Custom Error val: "(.+)"$/, '$1');
  }

  const viemShortMessage = hasShortMessage(error) ? error.shortMessage : undefined;
  if (typeof viemShortMessage === 'string' && viemShortMessage.trim()) {
    return viemShortMessage.trim();
  }

  if (/\bviem@/i.test(message) || /\nVersion:\s*viem@/i.test(message)) {
    const firstLine = message.split('\n').find((l) => l.trim());
    if (firstLine) return firstLine.trim();
  }

  return message;
}
