import { z } from "zod";

/** Canonical catalog model entry. Single source of truth — src/catalog.ts derives its ModelEntry type from here via z.infer; never redeclare the shape there. */
export const ModelEntrySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: z.enum(["premium", "open-source"]),
  reasoning: z.boolean(),
  reasoningEfforts: z.array(z.string()).optional(),
  tool_call: z.boolean(),
  cost: z.strictObject({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  }),
  limit: z.strictObject({
    context: z.number().int(),
    output: z.number().int(),
  }),
  attachment: z.boolean().optional(),
  modalities: z
    .strictObject({
      input: z.array(z.string()),
      output: z.array(z.string()),
    })
    .optional(),
});

/** Canonical catalog manifest. Single source of truth — src/manifest.ts derives its CatalogManifest type from here via z.infer; never redeclare the shape there. */
export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  pluginVersion: z.string(),
  commandCodeVersion: z.string(),
  commandCodeTarball: z.string(),
  modelCount: z.number().int(),
  reasoningModelCount: z.number().int(),
  extraction: z.strictObject({
    modelCatalog: z.enum(["ok", "failed"]),
    costCatalog: z.enum(["cli", "docs", "thirdParty", "free", "fallback", "missing"]),
    costCatalogError: z.string().nullable(),
  }),
  costSources: z.strictObject({
    cli: z.number().int(),
    officialDocs: z.number().int(),
    thirdParty: z.number().int(),
    free: z.number().int(),
    fallback: z.number().int(),
    unmatched: z.number().int(),
  }),
  review: z
    .strictObject({
      thirdParty: z.array(z.string()),
      free: z.array(z.string()),
      unmatched: z.array(z.string()),
      unavailable: z
        .array(
          z.strictObject({
            id: z.string(),
            reason: z.literal("not-listed-by-provider-api"),
          }),
        )
        .optional(),
    })
    .optional(),
  status: z.enum(["healthy", "degraded", "broken"]),
});

/**
 * OpenAI-style `{ object: "list", data: [{ id }] }` availability payload.
 * Items stay lenient (the provider API returns extra per-model fields);
 * duplicate ids are rejected.
 */
export const AvailabilityPayloadSchema = z
  .object({
    object: z.literal("list"),
    data: z.array(z.object({ id: z.string().min(1) })).min(1),
  })
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    for (const item of payload.data) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate availability id: ${item.id}`,
        });
        return;
      }
      seen.add(item.id);
    }
  });

/**
 * Plugin file config (`~/.config/opencode/opencode-commandcode.json`).
 * Deliberately lenient: user config files may carry extra keys, so unknown
 * keys are stripped and every field falls back to its default.
 */
export const PluginFileConfigSchema = z.object({
  disableModelSync: z.boolean().optional().default(false),
  commandCodePackagePath: z.string().optional().default(""),
  debugStartupLogs: z.boolean().optional().default(false),
});
