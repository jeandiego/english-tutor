export function TalkControl() {
  return (
    <section className="talk-control-region" aria-label="Voice controls">
      <button className="talk-control" type="button" disabled>
        <span className="talk-control__label">Hold to talk</span>
        <span className="talk-control__hint">
          Voice input is not connected yet
        </span>
      </button>
    </section>
  );
}
