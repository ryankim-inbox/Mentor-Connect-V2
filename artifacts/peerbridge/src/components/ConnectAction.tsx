import { useMatchRequest } from "@workspace/api-client-react";
import { apiErrorMessage } from "@/lib/api-error-message";

interface ConnectActionProps {
  readonly requestId: number;
  readonly onMatched: () => void;
  readonly onFailed: () => void;
}

export default function ConnectAction({
  requestId,
  onMatched,
  onFailed,
}: ConnectActionProps) {
  const matchMutation = useMatchRequest();

  const handleMatch = () => {
    matchMutation.mutate(
      { id: requestId },
      {
        onSuccess: onMatched,
        onError: onFailed,
      },
    );
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleMatch}
        disabled={matchMutation.isPending}
        aria-busy={matchMutation.isPending}
        className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {matchMutation.isPending ? "Connecting..." : "Connect"}
      </button>
      {matchMutation.isError && (
        <p className="mt-2 max-w-64 text-xs text-destructive" role="alert">
          {apiErrorMessage(matchMutation.error)}
        </p>
      )}
    </div>
  );
}
