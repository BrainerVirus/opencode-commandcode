import { resolveApiKey } from "./src/auth.js";
import { CommandCodeLanguageModel } from "./src/model.js";
import { withZdrHeaders, zdrFromEnvValue } from "./src/zdr.js";

// Re-export the plugin definition so a directory plugin entry (<dir>/index.ts)
// loads the dual V1+V2 plugin. No cycle: plugin.ts only imports from src/.
export { default, server } from "./plugin.js";

export interface CommandCodeProviderOptions {
  name?: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  authPaths?: string[];
}

/** Caller headers win; `CMD_ZDR=1` only fills the ZDR header when it is absent. */
function resolveHeaders(options: CommandCodeProviderOptions): Record<string, string> | undefined {
  const provided =
    typeof options.headers === "object" && options.headers !== null
      ? (options.headers as Record<string, string>)
      : undefined;
  return withZdrHeaders(provided, zdrFromEnvValue(process.env.CMD_ZDR));
}

export function createCommandCode(options: CommandCodeProviderOptions = {}) {
  const apiKey = resolveApiKey({ apiKey: options.apiKey, authPaths: options.authPaths });
  if (!apiKey) {
    throw new Error(
      "Command Code API key not found. Set COMMANDCODE_API_KEY env var, create ~/.commandcode/auth.json, or pass apiKey option.",
    );
  }

  const headers = resolveHeaders(options);

  return {
    languageModel(modelId: string): CommandCodeLanguageModel {
      return new CommandCodeLanguageModel(modelId, {
        apiKey,
        baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
        headers,
      });
    },
  };
}
