import { createHash } from 'crypto';
import { devLog } from "./observability";

export function sha256Hex(input: string): string {
  if (!input || typeof input !== 'string') {
    devLog("warn", "hash: invalid input provided", { inputType: typeof input, inputLength: input?.length });
    return '';
  }

  const result = createHash('sha256').update(input, 'utf8').digest('hex');

  devLog("debug", "hash: sha256 computed", {
    inputLength: input.length,
    hashLength: result.length,
    hashPrefix: result.substring(0, 8)
  });

  return result;
}
