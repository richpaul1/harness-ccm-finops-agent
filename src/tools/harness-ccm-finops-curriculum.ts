import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadCurriculum(): string {
  const curriculumPath = resolve(__dirname, "..", "docs", "finops-lessons.md");
  return readFileSync(curriculumPath, "utf8");
}

export function registerCcmFinOpsCurriculumTool(server: McpServer): void {
  server.registerTool(
    "harness_ccm_finops_curriculum",
    {
      description:
        "Return the complete FinOps Fluency curriculum and lesson-generation playbook as markdown. " +
        "Call this before generating any FinOps training lesson to understand: " +
        "the five-beat teaching rhythm (Hook / Zoom / Reveal / Pattern / Practice), " +
        "the universal lesson anatomy (YAML frontmatter, body structure, callout vocabulary, metric card tones, chart conventions), " +
        "the step-by-step lesson generation recipe (bootstrap → discover → data pull → directory → charts → author → render → hand-off), " +
        "customer discovery questions, per-lesson specifications for all 7 lessons " +
        "(Visibility, Allocation, Commitments, Anomalies, Right-sizing, Budgets & Forecasts, Maturity), " +
        "authoring do/don't rules, user-facing trigger prompts, and the generated file layout.",
      inputSchema: {},
      annotations: {
        title: "FinOps Fluency Curriculum & Lesson Generation Playbook",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const curriculum = loadCurriculum();
      return {
        content: [{ type: "text", text: curriculum }],
      };
    }
  );
}
