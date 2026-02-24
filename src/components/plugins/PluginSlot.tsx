import { usePluginSlotStore } from "../../stores/pluginSlotStore";

interface PluginSlotProps {
  id: string;
  className?: string;
}

const EMPTY_ARRAY: any[] = [];

export function PluginSlot({ id, className }: PluginSlotProps) {
  const registrations = usePluginSlotStore((state) => state.slots[id] || EMPTY_ARRAY);

  if (registrations.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {registrations.map((reg) => (
        <reg.component key={reg.id} />
      ))}
    </div>
  );
}
