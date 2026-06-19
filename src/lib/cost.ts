/**
 * Rough USD cost estimation (spec §15 usage_events, §18.2 cost display).
 * Prices are approximate and centralised here so they are easy to tune.
 */
const TEXT_INPUT_PER_1K = 0.0025; // gpt-4o input
const TEXT_OUTPUT_PER_1K = 0.01; // gpt-4o output
const IMAGE_FLAT = 0.04; // per generated image (1024x1024)

export function estimateTextCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1000) * TEXT_INPUT_PER_1K + (outputTokens / 1000) * TEXT_OUTPUT_PER_1K
  );
}

export function estimateImageCost(count = 1): number {
  return IMAGE_FLAT * count;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
