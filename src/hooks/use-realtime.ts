import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Watch = { table: string; keys: string[][] };

/**
 * Subscribe to Postgres changes and invalidate the matching react-query keys
 * so every surface stays live without manual refreshes.
 */
export function useRealtime(watches: Watch[], channelName: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel(`rt-${channelName}`);
    for (const w of watches) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "*", schema: "public", table: w.table },
        () => {
          for (const key of w.keys) qc.invalidateQueries({ queryKey: key });
        },
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, qc]);
}
