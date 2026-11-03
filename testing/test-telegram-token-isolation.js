import assert from "node:assert/strict";
import { assertTelegramTokenIsolation } from "../src/config/telegram.config.js";

assert.throws(
  () => assertTelegramTokenIsolation({
    agentToken: "same-token",
    csToken: "same-token",
  }),
  /berbeda/,
);

assert.doesNotThrow(() => assertTelegramTokenIsolation({
  agentToken: "agent-token",
  csToken: "cs-token",
}));

console.log("PASS: Telegram token isolation");
