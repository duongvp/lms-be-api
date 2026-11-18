export type ModerationMode = 'off' | 'shadow' | 'enforce';
const rank: Readonly<Record<ModerationMode, number>> = { off: 0, shadow: 1, enforce: 2 };

/** Mọi tầng chỉ được thu hẹp quyền thực thi của trần vận hành, không tự nâng mode. */
export function minimumModerationMode(...modes: readonly ModerationMode[]): ModerationMode {
  return modes.reduce((lowest, mode) => rank[mode] < rank[lowest] ? mode : lowest, 'enforce');
}
