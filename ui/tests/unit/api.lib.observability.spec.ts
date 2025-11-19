/**
 * Tests for frontend observability helpers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { devLog, perfMark, getPerfEntries, clearPerfMarks } from "../../../src/app/api/lib/observability";

// Mock the env module
vi.mock("../../../src/app/api/lib/env", () => ({
  getEnvString: vi.fn(),
  getEnvBool: vi.fn(),
}));

// Mock performance API
const mockPerformance = {
  mark: vi.fn(),
  measure: vi.fn(),
  getEntriesByName: vi.fn(),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn(),
};

vi.stubGlobal("performance", mockPerformance);

// Mock console
const mockConsole = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.stubGlobal("console", mockConsole);

describe("Frontend Observability Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mocks
    mockPerformance.mark.mockClear();
    mockPerformance.measure.mockClear();
    mockPerformance.getEntriesByName.mockClear();
    mockPerformance.clearMarks.mockClear();
    mockPerformance.clearMeasures.mockClear();

    mockConsole.info.mockClear();
    mockConsole.warn.mockClear();
    mockConsole.error.mockClear();
    mockConsole.debug.mockClear();
  });

  describe("devLog", () => {
    it("should log in development mode", async () => {
      // Import dynamically to ensure fresh mocks
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("development");

      devLog("info", "Test message", { key: "value" });

      expect(mockConsole.info).toHaveBeenCalledWith(
        "[DEV] Test message",
        expect.objectContaining({
          level: "info",
          message: "Test message",
          key: "value",
        })
      );
    });

    it("should not log in production mode", async () => {
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("production");

      devLog("info", "Test message", { key: "value" });

      expect(mockConsole.info).not.toHaveBeenCalled();
    });

    it("should use appropriate console methods", async () => {
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("development");

      devLog("error", "Error message");
      devLog("warn", "Warning message");
      devLog("debug", "Debug message");

      expect(mockConsole.error).toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalled();
      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe("perfMark", () => {
    it("should create performance marks in development", async () => {
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("development");

      perfMark("test-mark");

      expect(mockPerformance.mark).toHaveBeenCalledWith("test-mark");
    });

    it("should not create marks in production", async () => {
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("production");

      perfMark("test-mark");

      expect(mockPerformance.mark).not.toHaveBeenCalled();
    });

    it("should create measures when measureFrom is provided", async () => {
      const { getEnvString } = await import("../../../src/app/api/lib/env");
      vi.mocked(getEnvString).mockReturnValue("development");
      mockPerformance.measure.mockImplementation(() => {});

      perfMark("end-mark", "start-mark");

      expect(mockPerformance.measure).toHaveBeenCalledWith(
        "end-mark_duration",
        "start-mark",
        "end-mark"
      );
    });
  });

  describe("getPerfEntries", () => {
    it("should return performance entries", () => {
      mockPerformance.getEntriesByName.mockReturnValue([
        { name: "test-entry", duration: 100, startTime: 0 } as PerformanceEntry,
      ]);

      const entries = getPerfEntries("test-entry");

      expect(entries).toHaveLength(1);
      expect(mockPerformance.getEntriesByName).toHaveBeenCalledWith("test-entry");
    });

    it("should return empty array when performance is unavailable", () => {
      // @ts-ignore
      vi.stubGlobal("performance", undefined);

      const entries = getPerfEntries("test-entry");

      expect(entries).toEqual([]);

      // Restore mock
      vi.stubGlobal("performance", mockPerformance);
    });
  });

  describe("clearPerfMarks", () => {
    it("should clear performance marks and measures", () => {
      clearPerfMarks();

      expect(mockPerformance.clearMarks).toHaveBeenCalled();
      expect(mockPerformance.clearMeasures).toHaveBeenCalled();
    });

    it("should handle missing performance API gracefully", () => {
      // @ts-ignore
      vi.stubGlobal("performance", undefined);

      expect(() => clearPerfMarks()).not.toThrow();

      // Restore mock
      vi.stubGlobal("performance", mockPerformance);
    });
  });
});



