import { describe, expect, it } from "vitest";
import { extractHtmlText } from "./website-ingestion.js";

describe("website ingestion text extraction", () => {
  it("extracts visible page text and removes non-content elements", () => {
    const result = extractHtmlText(`
      <html>
        <head>
          <title>Support Policy</title>
          <meta name="description" content="How support calls are handled." />
          <style>.hidden { display: none; }</style>
          <script>window.bad = true;</script>
        </head>
        <body>
          <nav>Navigation should not be included</nav>
          <h1>Support Policy</h1>
          <main>
            <p>We answer billing calls from 9am to 5pm.</p>
            <p>Escalate urgent outages immediately.</p>
          </main>
        </body>
      </html>
    `);

    expect(result.title).toBe("Support Policy");
    expect(result.content).toContain("How support calls are handled.");
    expect(result.content).toContain("We answer billing calls from 9am to 5pm.");
    expect(result.content).toContain("Escalate urgent outages immediately.");
    expect(result.content).not.toContain("window.bad");
    expect(result.content).not.toContain("Navigation should not be included");
  });
});
