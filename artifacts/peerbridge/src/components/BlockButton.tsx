import { useState } from "react";
import { useBlockUser, useListBlocks, getListBlocksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  userId: number;
  userName: string;
}

export default function BlockButton({ userId, userName }: Props) {
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const blockMutation = useBlockUser();
  const { data: blocks } = useListBlocks();

  const isAlreadyBlocked = blocks?.some(b => b.blockedUserId === userId) ?? blocked;

  const handleBlock = () => {
    if (!confirm(`Block ${userName}? They won't be able to see your profile.`)) return;

    blockMutation.mutate({ data: { blockedUserId: userId } }, {
      onSuccess: () => {
        setBlocked(true);
        queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() });
      },
    });
  };

  if (isAlreadyBlocked) {
    return (
      <span className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg">
        Blocked
      </span>
    );
  }

  return (
    <button
      onClick={handleBlock}
      disabled={blockMutation.isPending}
      className="px-3 py-1.5 text-sm border border-border text-muted-foreground rounded-lg hover:bg-accent transition-colors"
    >
      Block
    </button>
  );
}
