import { useMatchRequest } from "@workspace/api-client-react";

interface ConnectActionProps {
  readonly requestId: number;
  readonly onMatched: () => void;
}

export default function ConnectAction({
  requestId,
  onMatched,
}: ConnectActionProps) {
  const matchMutation = useMatchRequest();

  const handleMatch = () => {
    matchMutation.mutate(
      { id: requestId },
      {
        onSuccess: onMatched,
      },
    );
  };

  return (
    <button
      type="button"
      onClick={handleMatch}
      disabled={matchMutation.isPending}
      className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      {matchMutation.isPending ? "Connecting..." : "Connect"}
    </button>
  );
}
