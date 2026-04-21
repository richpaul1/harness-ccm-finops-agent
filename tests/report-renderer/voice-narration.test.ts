import { describe, it, expect } from "vitest";
import { preprocessVoiceComments } from "../../src/report-renderer/plugins/voice-narration.js";

describe("preprocessVoiceComments", () => {
  it("rewrites a plain voice comment into a hidden div", () => {
    const out = preprocessVoiceComments("<!-- voice: Hello world. -->");
    expect(out).toContain('class="voice-narration"');
    expect(out).toContain('data-text="Hello world."');
    expect(out).not.toMatch(/<!--\s*voice/);
  });

  it("forwards voice/rate metadata onto data-* attributes", () => {
    const out = preprocessVoiceComments('<!-- voice voice="nova" rate=1.05: hi -->');
    expect(out).toContain('data-voice="nova"');
    expect(out).toContain('data-rate="1.05"');
    expect(out).toContain('data-text="hi"');
  });

  it("collapses multi-line narration into a single space-separated string", () => {
    const out = preprocessVoiceComments(
      "<!-- voice:\n  Line one.\n  Line two.\n-->",
    );
    expect(out).toContain('data-text="Line one. Line two."');
  });

  it("drops empty voice markers silently", () => {
    const out = preprocessVoiceComments("before<!-- voice: -->after");
    expect(out).toBe("beforeafter");
  });

  it("does NOT rewrite voice comments inside fenced code blocks (```)", () => {
    const input = [
      "## Intro",
      "",
      "```markdown",
      "<!-- voice: example -->",
      "```",
      "",
      "Body.",
    ].join("\n");
    const out = preprocessVoiceComments(input);
    // Fence body must survive intact — authors demonstrating the pattern
    // should see raw text, not a hidden div that swallowed their example.
    expect(out).toContain("<!-- voice: example -->");
    expect(out).not.toContain("voice-narration");
  });

  it("does NOT rewrite voice comments inside ~~~ fenced blocks", () => {
    const input = "~~~\n<!-- voice: example -->\n~~~";
    const out = preprocessVoiceComments(input);
    expect(out).toContain("<!-- voice: example -->");
    expect(out).not.toContain("voice-narration");
  });

  it("does NOT rewrite voice comments inside inline code spans", () => {
    const out = preprocessVoiceComments("Like `<!-- voice: keep-me -->` in prose.");
    expect(out).toContain("`<!-- voice: keep-me -->`");
    expect(out).not.toContain("voice-narration");
  });

  it("rewrites real comments but preserves fenced examples in the same source", () => {
    const input = [
      "<!-- voice: real-one -->",
      "",
      "```",
      "<!-- voice: fake -->",
      "```",
      "",
      "<!-- voice: real-two -->",
    ].join("\n");
    const out = preprocessVoiceComments(input);
    const rewritten = out.match(/voice-narration/g) ?? [];
    expect(rewritten.length).toBe(2);
    expect(out).toContain('data-text="real-one"');
    expect(out).toContain('data-text="real-two"');
    expect(out).toContain("<!-- voice: fake -->");
  });

  it("escapes attribute-unsafe characters in data-text", () => {
    const out = preprocessVoiceComments('<!-- voice: say "hi" & <bye> -->');
    expect(out).toContain('data-text="say &quot;hi&quot; &amp; &lt;bye&gt;"');
  });
});
