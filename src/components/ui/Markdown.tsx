import { useContext } from "preact/hooks";
import { OptionsContext, SiteContext } from "../../renderer/context.js";
import { renderMarkdown, renderMarkdownInline, siteMarkdownOptions } from "../../utils/markdown.js";
import { smartypants } from "../../utils/typography.js";
import { withHeadingAliases } from "./AnchorAliases.js";

interface MarkdownProps {
  content?: string;
  inline?: boolean;
  class?: string;
  /** Its headings are a page's sections: the fragments imported for each stay before it. */
  sections?: boolean;
}

/** Authored Markdown in generated reference pages; its alerts are the site's callouts. */
export function Markdown({ content, inline, class: className, sections = false }: MarkdownProps) {
  const site = useContext(SiteContext);
  const { messages, anchorAliases } = useContext(OptionsContext);
  if (!content) return null;

  const rendered = inline ? renderMarkdownInline(content) : renderMarkdown(content, siteMarkdownOptions(site.theme.icons, messages));
  const typeset = site.smartypants ? smartypants(rendered) : rendered;
  const html = sections ? withHeadingAliases(typeset, anchorAliases) : typeset;

  if (inline) {
    return <span class={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const cls = className ? `prose prose-gray dark:prose-invert ${className}` : "prose prose-gray dark:prose-invert";
  return (
    <div class={cls} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
