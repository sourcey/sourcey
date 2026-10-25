import { useContext } from "preact/hooks";
import { OptionsContext, PageContext, SiteContext } from "../../renderer/context.js";
import { renderMarkdown } from "../../utils/markdown.js";

/**
 * The site's feedback question, hidden until the page's script can take an
 * answer. A rating shows its note and dispatches `sourcey:feedback` for the
 * site's own script to send on.
 */
export function Feedback() {
  const { feedback } = useContext(SiteContext);
  const page = useContext(PageContext);
  const { messages } = useContext(OptionsContext);
  if (!feedback || (page.kind === "markdown" && page.markdown.feedback === false)) return null;
  const ratings = feedback.ratings ?? [
    { label: messages.feedbackYes, value: 1, icon: feedback.thumbs.up, note: messages.feedbackThanks },
    { label: messages.feedbackNo, value: 0, icon: feedback.thumbs.down, note: messages.feedbackThanks },
  ];
  return (
    <section class="sourcey-feedback" data-sourcey-feedback aria-labelledby="sourcey-feedback-title" hidden>
      <div class="sourcey-feedback-question">
        <p id="sourcey-feedback-title" class="sourcey-feedback-title">{feedback.title ?? messages.feedbackTitle}</p>
        <div class="sourcey-feedback-ratings">
          {ratings.map((rating, index) => {
            const answer = { type: "button" as const, class: "sourcey-feedback-rating", "data-rating": index, "data-value": JSON.stringify(rating.value), "aria-pressed": "false" as const };
            // An icon stands for its label, which names the button and shows on hover.
            return rating.icon
              ? <button key={index} {...answer} aria-label={rating.label} title={rating.label} dangerouslySetInnerHTML={{ __html: rating.icon }} />
              : <button key={index} {...answer}>{rating.label}</button>;
          })}
        </div>
      </div>
      {ratings.map((rating, index) => rating.note && <div key={index} class="sourcey-feedback-note" data-rating={index} hidden dangerouslySetInnerHTML={{ __html: renderMarkdown(rating.note) }} />)}
    </section>
  );
}
