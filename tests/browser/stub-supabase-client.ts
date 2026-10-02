// Test seam for tests/browser: a minimal Supabase browser client whose
// Realtime channel can be driven from the test (window.__realtime.emit), so
// the live-comment merge/dedupe/delete paths run without a Supabase project.
type Handler = (payload: { new?: unknown; old?: unknown }) => void;
type W = Window & {
  __channelOptions?: unknown[];
  __realtime?: {
    emit: (event: string, payload: { new?: unknown; old?: unknown }) => void;
    status: (s: string) => void;
  };
};

export function createClient() {
  const handlers: { event: string; fn: Handler }[] = [];
  let statusCb: (s: string) => void = () => undefined;
  const channel = {
    on(_type: string, opts: { event: string }, fn: Handler) {
      handlers.push({ event: opts.event, fn });
      return channel;
    },
    subscribe(cb: (s: string) => void) {
      statusCb = cb;
      setTimeout(() => cb("SUBSCRIBED"), 0);
      return channel;
    },
  };
  (window as W).__realtime = {
    emit: (event, payload) => handlers.filter((h) => h.event === event).forEach((h) => h.fn(payload)),
    status: (s) => statusCb(s),
  };
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    realtime: { setAuth: () => undefined },
    channel: (_name: string, options?: unknown) => {
      const w = window as W;
      (w.__channelOptions ??= []).push(options);
      return channel;
    },
    removeChannel: async () => undefined,
  };
}
