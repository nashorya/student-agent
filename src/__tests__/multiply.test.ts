import { describe, it, expect } from "vitest";
import { multiply } from "../multiply.js";

describe("multiply", () => {
  it("multiplies two positive numbers", () => {
    expect(multiply(2, 3)).toBe(6);
  });

  it("multiplies with zero", () => {
    expect(multiply(0, 5)).toBe(0);
    expect(multiply(5, 0)).toBe(0);
  });

  it("multiplies negative numbers", () => {
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(-2, -3)).toBe(6);
  });

  it("multiplies decimal numbers", () => {
    expect(multiply(1.5, 2)).toBe(3);
    expect(multiply(0.1, 0.1)).toBeCloseTo(0.01);
  });
});
