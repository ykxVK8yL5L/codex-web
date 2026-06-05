export type ContactTab = "agents" | "groups" | "roles" | "circles" | "permissions";

export type ContactPageKind = Exclude<ContactTab, "permissions">;

export type ContactPageState = Record<ContactPageKind, { cursor: string | null; hasMore: boolean }>;
