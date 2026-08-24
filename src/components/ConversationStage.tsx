export function ConversationStage() {
  return (
    <section className="conversation-stage" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="visually-hidden">
        Conversation
      </h2>
      <span className="frame-mark frame-mark--top-left" aria-hidden="true" />
      <span className="frame-mark frame-mark--top-center" aria-hidden="true" />
      <span className="frame-mark frame-mark--top-right" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-left" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-center" aria-hidden="true" />
      <span className="frame-mark frame-mark--bottom-right" aria-hidden="true" />
      <p className="conversation-stage__empty">
        Your conversation will appear here
      </p>
    </section>
  );
}
