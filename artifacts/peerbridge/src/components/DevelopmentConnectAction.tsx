import { useMatchRequest } from "@workspace/api-client-react";

interface DevelopmentConnectActionProps {
  readonly requestId: number;
  readonly onMatched: () => void;
}

/**
 * This component is loaded only from a development-only branch in
 * RequestDetail. Keeping the mutation here ensures a production build has no
 * match-action implementation or endpoint string to execute.
 */
export default function DevelopmentConnectAction({
  requestId,
  onMatched,
}: DevelopmentConnectActionProps) {
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
