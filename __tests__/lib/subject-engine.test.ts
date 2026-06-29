/**
 * @jest-environment node
 */
import { scoreSubject } from "@/lib/subject-engine";

const ctx = { company: "Brightland", firstName: "Dana" };

describe("scoreSubject", () => {
  it("rewards a short, lowercase, company-signal subject", () => {
    const r = scoreSubject("brightland + retention", ctx);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.autoFail).toBe(false);
  });

  it("penalizes a generic subject with no signal", () => {
    const r = scoreSubject("a quick idea for you", ctx);
    expect(r.score).toBeLessThan(70);
  });

  it("penalizes first-name-only as a mail-merge tell", () => {
    const firstNameOnly = scoreSubject("dana", ctx);
    const companySignal = scoreSubject("brightland", ctx);
    expect(companySignal.score).toBeGreaterThan(firstNameOnly.score);
  });

  it("auto-fails a spam-trigger cluster", () => {
    const r = scoreSubject("free exclusive offer act now", ctx);
    expect(r.autoFail).toBe(true);
    expect(r.score).toBe(0);
  });

  it("penalizes salesy + Title Case + exclamation", () => {
    const r = scoreSubject("Boost Your Revenue Today!", ctx);
    expect(r.score).toBeLessThan(50);
  });

  it("auto-fails an empty subject", () => {
    expect(scoreSubject("", ctx).autoFail).toBe(true);
  });
});
