/**
 * Phase B — Stage 5: smoke-test the deployed Modal summarizer endpoint.
 *
 * Sends ONE sample paper through the SAME prompt the model was trained on
 * (SYSTEM_PROMPT + buildUserPrompt from src/lib/gemini.ts — prompt parity) and
 * prints the raw Thai card the model returns, so we can confirm the GGUF is
 * actually running on the GPU before wiring it into ingest.
 *
 * Setup (never committed — .env.local is gitignored):
 *   MODAL_SUMMARIZER_URL=https://tanapunn--thai-paper-summarizer-summarizer-generate.modal.run
 *   MODAL_SUMMARIZER_TOKEN=<the AUTH_TOKEN you put in the modal secret>
 *
 * Run:
 *   npx tsx --env-file=.env.local phase-b/scripts/test-modal-endpoint.ts
 *
 * Note: the FIRST call is a cold start — Modal boots a T4 container and loads the
 * 7B GGUF (~30–90s). Be patient; later calls are fast while the container stays warm.
 */

import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/gemini";

// A real-ish AI paper to summarize (English title + abstract, like the feed gives us).
const SAMPLE = {
  titleEn: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models",
  abstractEn:
    "We explore how generating a chain of thought—a series of intermediate " +
    "reasoning steps—significantly improves the ability of large language models " +
    "to perform complex reasoning. In particular, we show how such reasoning " +
    "abilities emerge naturally in sufficiently large language models via a simple " +
    "method called chain-of-thought prompting, where a few chain of thought " +
    "demonstrations are provided as exemplars in prompting. Experiments on three " +
    "large language models show that chain-of-thought prompting improves performance " +
    "on a range of arithmetic, commonsense, and symbolic reasoning tasks.",
};

async function main() {
  const url = process.env.MODAL_SUMMARIZER_URL;
  const token = process.env.MODAL_SUMMARIZER_TOKEN;

  if (!url || !token) {
    console.error(
      "❌ Missing env. Put MODAL_SUMMARIZER_URL and MODAL_SUMMARIZER_TOKEN in .env.local, then:\n" +
        "   npx tsx --env-file=.env.local phase-b/scripts/test-modal-endpoint.ts"
    );
    process.exit(1);
  }

  const payload = {
    token,
    items: [
      { system: SYSTEM_PROMPT, user: buildUserPrompt(SAMPLE.titleEn, SAMPLE.abstractEn) },
    ],
  };

  console.log(`→ POST ${url}`);
  console.log("  (cold start: booting T4 + loading 7B GGUF, may take ~30–90s)\n");

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Request failed to send: ${message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`← ${response.status} ${response.statusText}  (${elapsed}s)\n`);

  const text = await response.text();
  if (!response.ok) {
    console.error("❌ Endpoint returned an error body:\n" + text);
    process.exit(1);
  }

  let data: { results?: ({ raw?: string; error?: string } | null)[] };
  try {
    data = JSON.parse(text);
  } catch {
    console.error("❌ Response was not JSON:\n" + text);
    process.exit(1);
  }

  const result = data.results?.[0];
  if (!result) {
    console.error("❌ No result in response:\n" + JSON.stringify(data, null, 2));
    process.exit(1);
  }
  if (result.error) {
    console.error(`❌ Model errored on this item: ${result.error}`);
    process.exit(1);
  }

  console.log("✅ Raw card the model returned:\n");
  console.log(result.raw);

  // Try to parse it as JSON so we can eyeball the fields the way ingest will.
  try {
    const card = JSON.parse(result.raw as string);
    console.log("\n✅ Parsed as JSON. Fields:");
    console.log("  title_th :", card.title_th);
    console.log("  summary_th:", card.summary_th);
    console.log("  wow_point:", card.wow_point);
    console.log("  tags     :", card.tags);
  } catch {
    console.log(
      "\n⚠️  Raw wasn't strict JSON — ingest's tolerant parser (model.ts) may still recover it."
    );
  }
}

main();
