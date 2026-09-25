import { useEffect, useState, useSyncExternalStore } from 'react';
import { ReplayController } from '@/tripwire/replay/controller';
import type { Incident } from '@/tripwire/replay/incidents';

/** One controller per mounted dashboard; unmounting stops playback. */
export function useReplay(initial: Incident['id']) {
  const [controller] = useState(() => new ReplayController(initial));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    void controller.select(initial);
    return () => controller.dispose();
    // The initial incident only seeds the controller; later changes go through select().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  return [state, controller] as const;
}
