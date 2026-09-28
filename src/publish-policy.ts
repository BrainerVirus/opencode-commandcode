export type CatalogSyncDecision = {
  extract: boolean;
  publishRetry: boolean;
};

export type PublishDecision = "publish" | "skip-no-token" | "skip-already-published";

export function decideCatalogSync(input: {
  force: boolean;
  latestCommandCodeVersion: string;
  bundledCommandCodeVersion: string | null;
  pluginVersion: string;
  publishedPluginVersions: string[];
}): CatalogSyncDecision {
  const published = input.publishedPluginVersions.includes(input.pluginVersion);
  if (input.force || input.latestCommandCodeVersion !== input.bundledCommandCodeVersion) {
    return { extract: true, publishRetry: false };
  }
  if (!published) return { extract: false, publishRetry: true };
  return { extract: true, publishRetry: false };
}

export function decidePublish(input: {
  pluginVersion: string;
  publishedPluginVersions: string[];
  npmTokenSet: boolean;
}): PublishDecision {
  if (input.publishedPluginVersions.includes(input.pluginVersion)) return "skip-already-published";
  if (!input.npmTokenSet) return "skip-no-token";
  return "publish";
}
