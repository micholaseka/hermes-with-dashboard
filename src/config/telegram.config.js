export function assertTelegramTokenIsolation({ agentToken, csToken } = {}) {
  if (agentToken && csToken && agentToken === csToken) {
    throw new Error("Token Telegram Hermes Agent dan CS harus berbeda.");
  }
  return true;
}
