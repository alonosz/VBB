import { MODEL_FORMAT_VERSION, type ModelConfig, type RuleBlock } from "./types";

export class ModelParseError extends Error {}

function isRuleBlock(b: unknown): b is RuleBlock {
  if (typeof b !== "object" || b === null) return false;
  const block = b as Record<string, unknown>;
  if (typeof block.id !== "string") return false;
  if (typeof block.weight !== "number") return false;
  if (typeof block.enabled !== "boolean") return false;
  const rule = block.rule as Record<string, unknown> | undefined;
  if (!rule || typeof rule.type !== "string") return false;
  return ["value_tier", "numeric_bucket", "boolean_flag", "time_decay"].includes(
    rule.type
  );
}

export function parseModelJson(text: string): ModelConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ModelParseError(
      "This file isn't valid JSON. Make sure you selected a model file exported from this tool."
    );
  }

  if (typeof data !== "object" || data === null) {
    throw new ModelParseError("This model file is malformed.");
  }

  const obj = data as Record<string, unknown>;

  if (obj.formatVersion !== MODEL_FORMAT_VERSION) {
    throw new ModelParseError(
      `This model file's format (v${String(
        obj.formatVersion ?? "unknown"
      )}) isn't supported by this version of the app.`
    );
  }

  if (typeof obj.name !== "string") {
    throw new ModelParseError("This model file is missing a name field.");
  }

  if (!Array.isArray(obj.blocks) || !obj.blocks.every(isRuleBlock)) {
    throw new ModelParseError(
      "This model file's scoring rules are missing or malformed."
    );
  }

  return {
    formatVersion: MODEL_FORMAT_VERSION,
    name: obj.name,
    createdAt:
      typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    blocks: obj.blocks as RuleBlock[],
  };
}

export function parseModelFile(file: File): Promise<ModelConfig> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseModelJson(String(reader.result ?? "")));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () =>
      reject(new ModelParseError("Could not read this file."));
    reader.readAsText(file);
  });
}

export function serializeModel(model: ModelConfig): string {
  return JSON.stringify(model, null, 2);
}

export function modelFileName(model: ModelConfig): string {
  const slug = model.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "lead-scoring-model"}.json`;
}
