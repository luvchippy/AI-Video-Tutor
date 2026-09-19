/**
 * Capability probing — one cheap request per capability to find out what a
 * model can actually do, instead of trusting the registry or asking the user
 * to tick boxes.
 */

import type { AiProvider, ImageInput } from '../../types/provider';
import type { ModelCapabilities } from '../../types/model';
import { isAbortError } from './sse';

/**
 * A valid 1x1 opaque white PNG (70 bytes). Verified: the IHDR declares
 * 1x1 / 8-bit / RGBA and the IDAT inflates to `00 ffffffff` (one white pixel).
 * It must be a *decodable* image — providers reject malformed data, and the
 * rejection would be indistinguishable from "this model has no vision".
 */
export const PROBE_IMAGE: ImageInput = {
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
};

export const PROBE_TEXT_PROMPT = 'Reply exactly with: OK';
export const PROBE_IMAGE_PROMPT = 'Reply with a single word: OK';

const PROBE_MAX_TOKENS = 8;

/** What was actually probed. `null` means the value was left untouched. */
export interface ProbedCapabilities {
  textInput: boolean | null;
  imageInput: boolean | null;
}

export interface ProbeResult {
  capabilities: ModelCapabilities;
  probed: ProbedCapabilities;
}

/**
 * Probe text and image input with two minimal requests.
 *
 * Audio, video and native web search are not probed on purpose: nothing in the
 * pipeline can send them yet (see UNWIRED_CAPABILITIES in
 * registry/capability-resolver.ts), and a real web-search probe is a full
 * billable model call.
 *
 * If the text probe fails, the endpoint is unusable and the image probe is
 * skipped — a failing request says nothing about whether the model *could*
 * accept an image, and reporting `imageInput: false` from it would mislabel
 * the model.
 */
export async function probeCapabilities(
  provider: AiProvider,
  capabilities: ModelCapabilities,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const probed: ProbedCapabilities = { textInput: null, imageInput: null };

  try {
    await provider.chat(
      {
        model: provider.modelId,
        messages: [{ role: 'user', content: PROBE_TEXT_PROMPT }],
        maxTokens: PROBE_MAX_TOKENS,
      },
      signal,
    );
    probed.textInput = true;
  } catch (e) {
    if (isAbortError(e)) return { capabilities, probed };
    probed.textInput = false;
  }

  if (probed.textInput) {
    try {
      await provider.analyzeImage(PROBE_IMAGE, PROBE_IMAGE_PROMPT, signal);
      probed.imageInput = true;
    } catch (e) {
      if (isAbortError(e)) return { capabilities, probed };
      probed.imageInput = false;
    }
  }

  return {
    capabilities: {
      ...capabilities,
      textInput: probed.textInput ?? capabilities.textInput,
      imageInput: probed.imageInput ?? capabilities.imageInput,
    },
    probed,
  };
}