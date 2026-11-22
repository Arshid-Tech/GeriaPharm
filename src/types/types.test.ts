import { describe, it, expect } from "vitest";
import { surveySubmissionSchema } from "./types";

const baseSubmission = {
  id: "8f1b7c4e-9d38-4a2b-9f5e-1c6d2a7b0e33",
  createdAt: "2026-10-17T08:30:00.000Z",
  demographics: { age: 40, gender: "male" as const, occupation: "pharmacist" as const },
};

describe("surveySubmissionSchema Likert bounds", () => {
  it("allows score 6 for the four six-point information items (q12–q15)", () => {
    const parsed = surveySubmissionSchema.safeParse({
      ...baseSubmission,
      answers: { q1: 5, q12: 6, q13: 6, q14: 6, q15: 6, q25: 5 },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects score 6 for five-point UMARS items", () => {
    for (const q of ["q1", "q11", "q16", "q25"]) {
      const parsed = surveySubmissionSchema.safeParse({
        ...baseSubmission,
        answers: { [q]: 6 },
      });
      expect(parsed.success).toBe(false);
    }
  });
});
