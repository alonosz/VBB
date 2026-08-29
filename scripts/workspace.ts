/**
 * Workspace administration, for the operator.
 *
 * Creating a customer is the one thing that cannot be self-serve in a pilot -
 * someone decides who is a customer. That does not mean it should require SQL.
 *
 *   npx tsx scripts/workspace.ts list
 *   npx tsx scripts/workspace.ts create "Northridge Fabrication"
 *   npx tsx scripts/workspace.ts suspend <workspace-id>
 *
 * Needs the same Supabase env vars the app uses. The key is printed once and
 * cannot be recovered afterwards - that is the point of storing only a hash.
 */

import { createClient } from "@supabase/supabase-js";
import { SupabaseWorkspaceRepository } from "../src/lib/workspace/repository";
import { generateWorkspaceKey } from "../src/lib/workspace/key";

function requireEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.\n" +
        "Both are in your Supabase project under Settings -> API."
    );
    process.exit(1);
  }
  return { url, key };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { url, key } = requireEnv();
  const repo = new SupabaseWorkspaceRepository(
    createClient(url, key, { auth: { persistSession: false } })
  );

  if (command === "list") {
    const all = await repo.list();
    if (all.length === 0) {
      console.log("No workspaces yet. Create one with:  npx tsx scripts/workspace.ts create \"Customer name\"");
      return;
    }
    console.log(`${"NAME".padEnd(32)} ${"KEY".padEnd(16)} ${"STATUS".padEnd(10)} CREATED`);
    for (const w of all) {
      console.log(
        `${w.name.slice(0, 31).padEnd(32)} ${(w.keyPrefix + "…").padEnd(16)} ` +
          `${w.status.padEnd(10)} ${w.createdAt.toISOString().slice(0, 10)}`
      );
    }
    return;
  }

  if (command === "create") {
    const name = args.join(" ").trim();
    if (!name) {
      console.error('Give the customer a name:  npx tsx scripts/workspace.ts create "Northridge Fabrication"');
      process.exit(1);
    }
    const generated = await generateWorkspaceKey();
    const workspace = await repo.create({
      name,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    });

    console.log(`\nCreated "${workspace.name}".\n`);
    console.log("  Workspace key:");
    console.log(`  ${generated.key}\n`);
    console.log("  Send this to the customer. It is shown once and cannot be");
    console.log("  recovered - only a hash is stored. If it is lost, create a");
    console.log("  new workspace.\n");
    console.log("  It is NOT the feed URL. The feed URL goes to Google Ads;");
    console.log("  this key is how they sign in to their workspace page.\n");
    return;
  }

  if (command === "suspend") {
    const id = args[0];
    if (!id) {
      console.error("Give the workspace id:  npx tsx scripts/workspace.ts suspend <id>");
      process.exit(1);
    }
    await repo.suspend(id);
    console.log(`Suspended ${id}. Their key stops working immediately; their feed keeps serving until it is revoked.`);
    return;
  }

  console.log("Usage:");
  console.log("  npx tsx scripts/workspace.ts list");
  console.log('  npx tsx scripts/workspace.ts create "Customer name"');
  console.log("  npx tsx scripts/workspace.ts suspend <workspace-id>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
