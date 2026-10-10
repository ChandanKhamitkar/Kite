import { render } from "ink";

import { Runtime, type RuntimeOptions } from "../runtime.ts";
import { App, type AskBridge } from "./app.tsx";

/** Full-screen interactive mode (the default when run in a terminal). */
export async function runTui(opts: RuntimeOptions): Promise<void> {
  const bridge: AskBridge = {};
  const rt = new Runtime({
    ...opts,
    ask: (call, tool) => (bridge.ask ? bridge.ask(call, tool) : Promise.resolve("deny")),
  });

  const app = render(<App rt={rt} bridge={bridge} />, { exitOnCtrlC: false });
  await app.waitUntilExit();
  console.log(`session: ${rt.session.id}  (continue with kite --continue)`);
}
