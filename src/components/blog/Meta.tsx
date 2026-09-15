import { formatPostDate, initials, type PostMeta } from "@/lib/blog/posts";

/** The small facts that sit above a title: what kind of piece, how long. */
export function MetaRow({ post }: { post: Pick<PostMeta, "kind" | "minutes"> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {post.kind && (
        <span
          className="badge"
          style={{ background: "var(--primary-soft)", color: "var(--primary)", borderColor: "transparent" }}
        >
          {post.kind}
        </span>
      )}
      <span className="mono text-[12px] text-[var(--muted)]">{post.minutes} min read</span>
    </div>
  );
}

/**
 * Who wrote it and when, with a mark where a photo would go.
 *
 * The date is dropped on a card, where it is a timestamp nobody asked for,
 * and kept on the article itself, where a reader deciding whether the advice
 * is current has a reason to want it.
 */
export function Byline({
  post,
  showDate = true,
}: {
  post: Pick<PostMeta, "author" | "date">;
  showDate?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
      >
        {initials(post.author)}
      </span>
      <div className="leading-tight">
        <p className="text-[13.5px] font-semibold">{post.author}</p>
        {showDate && (
          <p className="mono mt-0.5 text-[12px] text-[var(--muted)]">{formatPostDate(post.date)}</p>
        )}
      </div>
    </div>
  );
}
