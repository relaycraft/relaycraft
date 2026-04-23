import type { RuleGroup } from "../../types/rules";

export function getUniqueGroupName(
  baseName: string,
  groups: RuleGroup[],
  excludeGroupId?: string,
): string {
  let uniqueName = baseName;
  let counter = 1;
  while (groups.some((group) => group.id !== excludeGroupId && group.name === uniqueName)) {
    uniqueName = `${baseName} (${counter++})`;
  }
  return uniqueName;
}
