import type React from "react";

export function IconText({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <>
      <Icon size={14} />
      <span>{children}</span>
    </>
  );
}
