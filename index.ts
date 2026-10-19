import { resolveApiKey } from "./src/auth.js";
import { CommandCodeLanguageModel } from "./src/model.js";
import { findZdrHeader, zdrFromEnvValue } from "./src/zdr.js";

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

/**
 * ZDR is documented for the Provider API (`/provider/v1/*`) only, and this SDK
 * calls `/alpha/generate`. A caller ZDR header (any casing) decides, so an
 * explicit `x-cmd-zdr: 0` opts out of `CMD_ZDR`; otherwise `CMD_ZDR` decides.
 */
function zdrRequested(headers: Record<string, string> | undefined): boolean {
  return zdrFromEnvValue(findZdrHeader(headers) ?? process.env.CMD_ZDR);
}

export function createCommandCode(options: CommandCodeProviderOptions = {}) {
  const apiKey = resolveApiKey({ apiKey: options.apiKey, authPaths: options.authPaths });
  if (!apiKey) {
    throw new Error(
      "Command Code API key not found. Set COMMANDCODE_API_KEY env var, create ~/.commandcode/auth.json, or pass apiKey option.",
    );
  }

  const headers =
    typeof options.headers === "object" && options.headers !== null
      ? (options.headers as Record<string, string>)
      : undefined;

  return {
    languageModel(modelId: string): CommandCodeLanguageModel {
      // Fail closed before any request: sending without enforced ZDR would leak the
      // prompt the caller asked to keep out of retention. Every caller (direct import,
      // or OpenCode's `create*` lookup on a provider `npm` set to this package)
      // resolves a model here before it can send one.
      if (zdrRequested(headers)) {
        throw new Error(
          "Zero data retention is only supported on the Command Code Provider API (/provider/v1/*); createCommandCode uses /alpha/generate. Unset CMD_ZDR, or use the OpenCode provider plugin.",
        );
      }
      return new CommandCodeLanguageModel(modelId, {
        apiKey,
        baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
        headers,
      });
    },
  };
}
