import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pdfkit before importing the module under test
const mockEnd = vi.fn();
const mockOn = vi.fn();
const mockText = vi.fn().mockReturnThis();
const mockFont = vi.fn().mockReturnThis();
const mockFontSize = vi.fn().mockReturnThis();
const mockMoveDown = vi.fn().mockReturnThis();
const mockSave = vi.fn().mockReturnThis();
const mockRestore = vi.fn().mockReturnThis();
const mockMoveTo = vi.fn().mockReturnThis();
const mockLineTo = vi.fn().mockReturnThis();
const mockLineWidth = vi.fn().mockReturnThis();
const mockStrokeColor = vi.fn().mockReturnThis();
const mockStroke = vi.fn().mockReturnThis();
const mockFillColor = vi.fn().mockReturnThis();
const mockRoundedRect = vi.fn().mockReturnThis();
const mockFill = vi.fn().mockReturnThis();
const mockHeightOfString = vi.fn().mockReturnValue(50);

vi.mock("pdfkit", () => {
  return {
    default: vi.fn().mockImplementation(() => {
      const eventHandlers: Record<string, Function> = {};
      return {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler;
          // Simulate data + end on next tick when "end" is registered
          if (event === "end") {
            setTimeout(() => {
              eventHandlers["data"]?.(Buffer.from("%PDF-mock"));
              eventHandlers["end"]?.();
            }, 0);
          }
          return this;
        }),
        end: mockEnd,
        text: mockText,
        font: mockFont,
        fontSize: mockFontSize,
        moveDown: mockMoveDown,
        save: mockSave,
        restore: mockRestore,
        moveTo: mockMoveTo,
        lineTo: mockLineTo,
        lineWidth: mockLineWidth,
        strokeColor: mockStrokeColor,
        stroke: mockStroke,
        fillColor: mockFillColor,
        roundedRect: mockRoundedRect,
        fill: mockFill,
        heightOfString: mockHeightOfString,
        page: { width: 595, height: 842 },
        y: 50,
      };
    }),
  };
});

// Import after mock setup
import { markdownToPdf } from "../../src/utils/markdown-to-pdf.js";

describe("markdownToPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a Buffer containing PDF data", async () => {
    const result = await markdownToPdf("# Hello\n\nWorld");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("calls doc.end() to finalize the document", async () => {
    await markdownToPdf("Some text");
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it("renders a title header when title option is provided", async () => {
    await markdownToPdf("Body text", { title: "My Report" });
    // Title should trigger font(bold) + fontSize(28) + text("My Report")
    expect(mockFont).toHaveBeenCalledWith("Helvetica-Bold");
    expect(mockFontSize).toHaveBeenCalledWith(28);
  });

  it("accepts different page sizes", async () => {
    // Should not throw
    const result = await markdownToPdf("# Test", { pageSize: "LETTER" });
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
