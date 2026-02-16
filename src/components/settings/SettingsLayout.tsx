import { ChevronRight } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import { IconWrapper } from "../common/IconWrapper";
import { Select } from "../common/Select";
import { Switch } from "../common/Switch";

/* -------------------------------------------------------------------------- */
/*                                Layout Tokens                               */
/* -------------------------------------------------------------------------- */

export function SettingsPage({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) {
  return (
    <div className="h-full flex overflow-hidden bg-background/50">
      {sidebar && (
        <div className="w-48 flex-shrink-0 border-r border-border/40 bg-muted/20 backdrop-blur-md overflow-y-auto px-2 py-4 flex flex-col gap-1">
          {sidebar}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-8 px-6 space-y-8">{children}</div>
      </div>
    </div>
  );
}

export function SettingsTabButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: any;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-ui font-semibold transition-all ${
        active
          ? "bg-primary/15 text-primary shadow-[0_0_15px_rgba(59,130,246,0.1)] border border-primary/20"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
      }`}
    >
      <IconWrapper
        icon={Icon}
        active={active}
        size={16}
        strokeWidth={1.4}
        className={active ? "text-primary" : "text-muted-foreground/60"}
      />
      {label}
    </button>
  );
}

export function SettingsSection({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2 px-3">
        <h3 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider cursor-default select-none">
          {title}
        </h3>
        {action}
      </div>
      <div className="bg-card border border-border/40 rounded-xl shadow-md divide-y divide-border/40">
        {children}
      </div>
    </section>
  );
}

interface SettingsRowProps {
  icon?: ReactNode; // Optional icon support if we want to unify later, but default to none
  title: string;
  description?: ReactNode;
  children?: ReactNode; // The control (right side)
  onClick?: () => void;
  className?: string;
  danger?: boolean;
}

export function SettingsRow({
  title,
  description,
  children,
  onClick,
  className = "",
  danger = false,
  icon,
}: SettingsRowProps) {
  return (
    <div
      onClick={onClick}
      className={`group px-4 py-2.5 min-h-[56px] flex items-center justify-between hover:bg-muted/30 transition-all ${
        onClick ? "cursor-pointer active:bg-muted/50" : ""
      } ${className}`}
    >
      <div className="flex-1 pr-4 flex items-center gap-3">
        {icon && (
          <div className="text-muted-foreground group-hover:text-foreground transition-colors">
            {icon}
          </div>
        )}
        <div>
          <div
            className={`text-ui font-semibold ${danger ? "text-destructive" : "text-foreground"}`}
          >
            {title}
          </div>
          {description && (
            <div className="text-small text-muted-foreground/80 mt-0.5 leading-relaxed">
              {description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 pl-2">
        {children}
        {onClick && !children && <ChevronRight className="w-4 h-4 text-muted-foreground/30" />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Standard Controls                           */
/* -------------------------------------------------------------------------- */

export function SettingsToggle(props: React.ComponentProps<typeof Switch>) {
  return <Switch {...props} />;
}

import { Input } from "../common/Input";

export function SettingsInput({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Input
      {...props}
      className={`w-auto bg-muted/30 text-right focus:bg-background font-mono text-xs ${className}`}
    />
  );
}

export function SettingsSelect({
  className = "",
  options,
  value,
  onChange,
  disabled,
}: {
  className?: string;
  options: { label: string; value: string; [key: string]: any }[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      className={`w-32 ${className}`}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={options}
    />
  );
}
