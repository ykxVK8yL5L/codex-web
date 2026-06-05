import { useState } from "react";
import { Check, Copy, MessageSquare } from "lucide-react";
import type { SessionMessage } from "@codex-web/protocol";
import { copyText } from "@/lib/clipboard";
import type { TFunction } from "@/features/sessions/utils";

export function Bubble({
  who,
  text,
  user = false,
  t,
  replyTo,
  onReply,
}: {
  who: string;
  text: string;
  user?: boolean;
  t?: TFunction;
  replyTo?: SessionMessage["replyTo"];
  onReply?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className={`bubble ${user ? "user" : "assistant"}`}>
      <div className="avatar" title={who}>{who}</div>
      <div className="bubble-body">
        <div className="bubble-sender" title={who}>{who}</div>
        <div className="bubble-toolbar">
          <button className="copy-message" type="button" onClick={() => void handleCopy()} title={copied ? t?.("action.copied") ?? "Copied" : t?.("session.copyMessageContent") ?? "Copy message content"} aria-label={copied ? t?.("action.copied") ?? "Copied" : t?.("session.copyMessageContent") ?? "Copy message content"}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          {onReply && (
            <button className="copy-message" type="button" onClick={onReply} title={t?.("session.reply") ?? "Reply"} aria-label={t?.("session.reply") ?? "Reply"}>
              <MessageSquare size={13} />
            </button>
          )}
        </div>
        {replyTo && <div className="bubble-reply">{replyTo.role}: {replyTo.content}</div>}
        <div className="bubble-text">{text}</div>
      </div>
    </article>
  );
}
