/**
 * @jest-environment node
 */
import { gradeEmail, PASS_THRESHOLD } from "@/lib/email-grader";

// A tight, research-aligned email (specialist-proof style): short, about them, problem-first,
// reply-first single ask, human, no links. Should grade well.
const GOOD = {
  subject: "belk + faster customer answers",
  body: `Hi Dana, seems like Belk is leaning hard into private-label this year. That usually lifts margin, but the hard part is knowing what shoppers actually want before you spend on the line, not after. We run AI consumer research for brands like Staples and Bagel Brands, real answers in days. Worth it? Reply "yes" and I'll send a quick example built on your category.`,
};

// A bad email: long, salesy Title-Case subject, filler opener, AI buzzwords, em dash, a link, no contractions.
const BAD = {
  subject: "Boost Your Revenue With Our Innovative Solution!",
  body: `I hope this email finds you well. I am reaching out because I wanted to introduce our world-class, best-in-class platform that will leverage cutting-edge AI to seamlessly streamline and supercharge your marketing operations — empowering your team to unlock transformative growth. We help companies like yours drive growth and elevate their results through our robust, scalable, holistic solution. I am confident that we can deliver incredible value to your organization and revolutionize the way you operate. Please book a meeting here: https://calendly.com/me/demo so we can discuss how we can help you achieve your goals. Are you available Tuesday? Are you available Wednesday? Looking forward to hearing from you.`,
};

describe("gradeEmail", () => {
  it("scores a tight, human, problem-first email as a pass", () => {
    const g = gradeEmail(GOOD);
    expect(g.score).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    expect(g.pass).toBe(true);
    expect(g.hardFail).toBe(false);
  });

  it("scores a long, salesy, AI-sounding email with a link as a hard fail", () => {
    const g = gradeEmail(BAD);
    expect(g.score).toBeLessThan(PASS_THRESHOLD);
    expect(g.pass).toBe(false);
    expect(g.hardFail).toBe(true); // filler opener + link in step 1
    expect(g.fixes.length).toBeGreaterThan(0);
  });

  it("ranks the good email well above the bad one", () => {
    expect(gradeEmail(GOOD).score).toBeGreaterThan(gradeEmail(BAD).score + 25);
  });

  it("flags a link in step 1 as a hard fail", () => {
    const g = gradeEmail({ subject: "quick one", body: "Hey, saw your launch. Worth a look? https://cal.com/x" });
    expect(g.hardFail).toBe(true);
  });

  it("penalizes over-long bodies on the length dimension", () => {
    const long = { subject: "hi there", body: Array.from({ length: 200 }, () => "word").join(" ") };
    const len = gradeEmail(long).dimensions.find((d) => d.key === "length");
    expect(len!.score).toBe(0);
  });

  it("rewards an opener that names the company when context is given", () => {
    const g = gradeEmail(GOOD, { company: "Belk" });
    const pers = g.dimensions.find((d) => d.key === "personalization");
    expect(pers).toBeDefined();
    expect(pers!.score).toBe(100);
  });

  it("penalizes a generic opener that never names the company", () => {
    const generic = { subject: "quick one", body: "Hi there, we help marketing teams understand customers faster. Worth a reply?" };
    const g = gradeEmail(generic, { company: "Caraway" });
    const pers = g.dimensions.find((d) => d.key === "personalization");
    expect(pers!.score).toBeLessThan(50);
    expect(g.fixes.some((f) => f.includes("Caraway"))).toBe(true);
  });
});
