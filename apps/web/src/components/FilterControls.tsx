import type React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function FilterToolbar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={["filter-toolbar", className].filter(Boolean).join(" ")}>{children}</div>;
}

export function FilterSearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const fallbackName = typeof props.placeholder === "string"
    ? props.placeholder.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "filter-search"
    : "filter-search";
  return (
    <label className="filter-search-field">
      <Search size={15} />
      <Input name={props.name ?? props.id ?? fallbackName} {...props} />
    </label>
  );
}
