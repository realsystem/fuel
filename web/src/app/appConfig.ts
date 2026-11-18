import { safeSupportUrl } from '../utils/supportUrl.ts';
import { DEFAULT_MAX_BYTES } from '../utils/imageValidation.ts';
import type { ProcessingConfig } from '../processor/config.ts';

/** Used when SUPPORT_URL is not set (or is not a valid https link). */
const DEFAULT_SUPPORT_URL = 'https://buymeacoffee.com/realsystem';

/** Application-level settings. Change here rather than in components. */
export const APP_CONFIG = {
  /** Maximum accepted file size per image. */
  maxBytes: DEFAULT_MAX_BYTES,
  /** Maximum number of images in one session (keeps memory bounded on phones). */
  maxImages: 50,
  /** Overrides passed to the processor; empty means use processor defaults. */
  processing: {} as Partial<ProcessingConfig>,
  /**
   * Where the Support button points. Set at build time with the SUPPORT_URL
   * environment variable (in CI: the SUPPORT_URL repository variable); when it
   * is empty or invalid, DEFAULT_SUPPORT_URL is used.
   */
  supportUrl: safeSupportUrl(process.env.SUPPORT_URL) ?? DEFAULT_SUPPORT_URL,
};
