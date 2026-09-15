import { Fragment, type ReactNode } from "react";
import { marked, type Token, type Tokens } from "marked";

/**
 * Markdown rendered as React elements rather than as a string of HTML.
 *
 * The alternative - handing marked's HTML to dangerouslySetInnerHTML - would
 * be shorter and is safe enough for files we write ourselves. It is not used
 * because of the numbers. This project's design language puts every figure in
 * the mono face with tabular figures, and an article's table is nothing but
 * figures: close rates, deal sizes, expected revenue. Rendering the cells
 * ourselves is what lets a table in prose line up the way a table in the
 * product does.
 *
 * Running on the server at build time, so none of marked reaches the browser.
 */

function inline(tokens: Token[] | undefined, keyPrefix = ""): ReactNode {
  if (!tokens) return null;
  return tokens.map((token, i) => {
    const key = `${keyPrefix}${i}`;
    switch (token.type) {
      case "text":
        return <Fragment key={key}>{(token as Tokens.Text).text}</Fragment>;
      case "strong":
        return <strong key={key}>{inline((token as Tokens.Strong).tokens, `${key}-`)}</strong>;
      case "em":
        return <em key={key}>{inline((token as Tokens.Em).tokens, `${key}-`)}</em>;
      case "codespan":
        return (
          <code key={key} className="mono rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[0.9em]">
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "link": {
        const t = token as Tokens.Link;
        // Anything off this site opens away from the article and does not
        // hand the destination our referrer chain.
        const external = /^https?:\/\//.test(t.href) && !t.href.includes("valuebasedbidding.com");
        return (
          <a
            key={key}
            href={t.href}
            className="font-medium text-[var(--primary)] underline underline-offset-[3px] hover:text-[var(--primary-hover)]"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {inline(t.tokens, `${key}-`)}
          </a>
        );
      }
      case "br":
        return <br key={key} />;
      case "escape":
        return <Fragment key={key}>{(token as Tokens.Escape).text}</Fragment>;
      default:
        return <Fragment key={key}>{"text" in token ? (token as { text: string }).text : null}</Fragment>;
    }
  });
}

/** Right-aligned columns are the numeric ones, so they get the mono face. */
function cellClass(align: "center" | "left" | "right" | null): string {
  if (align === "right") return "mono text-right tabular-nums";
  if (align === "center") return "text-center";
  return "text-left";
}

function block(token: Token, key: string): ReactNode {
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      // The article's own h1 is rendered by the page, from the header, so a
      // stray one in the body steps down rather than competing with it.
      /*
       * Sized here rather than with .h2, which is 17px against this page's
       * 16px body. That is right in the product, where a section is a card
       * with three lines in it, and far too quiet in an article with nine
       * sections of prose between them. Same weight and tracking as the rest
       * of the system, just given the room long-form reading needs.
       */
      if (t.depth <= 2) {
        return (
          <h2 key={key} className="mt-12 scroll-mt-24 text-[21px] font-bold leading-snug tracking-[-.02em] text-balance first:mt-0">
            {inline(t.tokens, `${key}-`)}
          </h2>
        );
      }
      return (
        <h3 key={key} className="mt-8 text-[17px] font-bold tracking-[-.012em]">
          {inline(t.tokens, `${key}-`)}
        </h3>
      );
    }

    case "paragraph": {
      const t = token as Tokens.Paragraph;
      /*
       * A paragraph that is entirely italic is an aside rather than prose:
       * the standfirst under the title, the note above a table, the byline
       * at the end. Set quieter and smaller so it reads as one.
       */
      const aside = t.tokens?.length === 1 && t.tokens[0].type === "em";
      return (
        <p
          key={key}
          className={
            aside
              ? "mt-5 text-[14px] leading-relaxed text-[var(--muted)]"
              : "mt-5 text-[16px] leading-[1.75]"
          }
        >
          {inline(t.tokens, `${key}-`)}
        </p>
      );
    }

    case "list": {
      const t = token as Tokens.List;
      const Tag = t.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={`mt-5 grid gap-3 pl-5 text-[16px] leading-[1.7] ${t.ordered ? "list-decimal" : "list-disc"}`}
        >
          {t.items.map((item, i) => (
            <li key={`${key}-${i}`} className="pl-1.5 marker:text-[var(--muted)]">
              {item.tokens?.map((child, j) =>
                // A one-paragraph item should not open a new block inside the
                // bullet, which would put a gap between the marker and text.
                child.type === "text" || child.type === "paragraph" ? (
                  <Fragment key={j}>{inline((child as Tokens.Text).tokens, `${key}-${i}-${j}-`)}</Fragment>
                ) : (
                  block(child, `${key}-${i}-${j}`)
                )
              )}
            </li>
          ))}
        </Tag>
      );
    }

    case "table": {
      const t = token as Tokens.Table;
      return (
        // Its own scroller, so a wide table never makes the page scroll.
        <div key={key} className="mt-7 overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[var(--border-strong)]">
                {t.header.map((cell, i) => (
                  <th
                    key={i}
                    className={`label pb-2.5 align-bottom ${cellClass(t.align[i])}`}
                    style={{ color: "var(--muted)" }}
                  >
                    {inline(cell.tokens, `${key}-h${i}-`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, r) => (
                <tr key={r} className="border-b border-[var(--border)]">
                  {row.map((cell, c) => (
                    <td key={c} className={`py-3 ${cellClass(t.align[c])}`}>
                      {inline(cell.tokens, `${key}-${r}-${c}-`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "blockquote":
      return (
        <blockquote
          key={key}
          className="mt-7 border-l-[3px] border-[var(--primary)] bg-[var(--primary-softer)] py-1 pl-5 pr-4 text-[16px] leading-[1.7]"
        >
          {(token as Tokens.Blockquote).tokens.map((child, i) => block(child, `${key}-${i}`))}
        </blockquote>
      );

    case "code":
      return (
        <pre key={key} className="mt-6 overflow-x-auto rounded-[var(--radius)] bg-[var(--surface-sunken)] p-4">
          <code className="mono text-[13px]">{(token as Tokens.Code).text}</code>
        </pre>
      );

    case "hr":
      return <hr key={key} className="mt-10 border-0 border-t border-[var(--border)]" />;

    case "space":
      return null;

    default:
      return null;
  }
}

export function Markdown({ source }: { source: string }) {
  const tokens = marked.lexer(source);
  return <>{tokens.map((token, i) => block(token, `b${i}`))}</>;
}
