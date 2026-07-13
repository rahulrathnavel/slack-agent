import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDataFiles, createDataDeckPlan } from "../src/services/dataAnalysis.js";
import type { DataFileInput, DeckRequest } from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("data analysis", () => {
  it("profiles CSV values and builds cited chart slides", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "sales.csv");
    await fs.writeFile(filePath, "Region,Revenue,Month\nNorth,120,2026-01-01\nSouth,90,2026-01-01\nNorth,150,2026-02-01\nSouth,110,2026-02-01\n", "utf8");

    const analysis = await analyzeDataFiles([dataFile("csv-sales", "sales.csv", filePath, "csv")]);
    expect(analysis.datasets).toHaveLength(1);
    expect(analysis.datasets[0]).toMatchObject({ rowCount: 4, columnCount: 3, sheetName: "CSV data", truncated: false });
    expect(analysis.datasets[0]?.columns.find((column) => column.name === "Revenue")).toMatchObject({
      kind: "number",
      sum: 470,
      average: 117.5
    });

    const plan = createDataDeckPlan(request(), analysis);
    const overview = plan.slides.find((slide) => slide.title === "Data Overview");
    const chart = plan.slides.find((slide) => slide.layout === "chart");
    expect(overview?.bullets.join(" ")).toContain("Region: North");
    expect(overview?.dataCitation).toContain("sales.csv / CSV data");
    expect(chart?.chart?.values.reduce((sum, value) => sum + value, 0)).toBe(470);
    expect(chart?.dataCitation).toBe("Source: sales.csv, Sheet: CSV data; analyzed 4 contributing records");
  });

  it("reserves a disclosure slide for data sources omitted by the slide limit", async () => {
    const directory = await temporaryDirectory();
    const files: DataFileInput[] = [];
    for (const name of ["north.csv", "south.csv", "west.csv"]) {
      const filePath = path.join(directory, name);
      await fs.writeFile(filePath, "Region,Revenue\nA,10\nB,20\n", "utf8");
      files.push(dataFile(name, name, filePath, "csv"));
    }
    const analysis = await analyzeDataFiles(files);
    const limitedRequest = { ...request(), slideCount: 4 };
    const plan = createDataDeckPlan(limitedRequest, analysis);
    expect(plan.slides).toHaveLength(4);
    const disclosure = plan.slides.at(-1);
    expect(disclosure?.title).toBe("Additional Data Sources");
    expect(disclosure?.bullets.join(" ")).toContain("south.csv");
    expect(disclosure?.dataCitation).toContain("west.csv");
  });

  it("reads XLSX worksheets and cites the real workbook and sheet", async () => {
    const directory = await temporaryDirectory();
    const filePath = path.join(directory, "pipeline.xlsx");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Forecast");
    sheet.addRow(["Owner", "Value"]);
    sheet.addRow(["Rahul", 25]);
    sheet.addRow(["Mina", 40]);
    await workbook.xlsx.writeFile(filePath);

    const analysis = await analyzeDataFiles([dataFile("xlsx-pipeline", "pipeline.xlsx", filePath, "xlsx")]);
    expect(analysis.datasets[0]).toMatchObject({ fileName: "pipeline.xlsx", sheetName: "Forecast", rowCount: 2, columnCount: 2 });

    const plan = createDataDeckPlan(request(), analysis);
    const evidenceSlides = plan.slides.filter((slide) => slide.title !== request().title);
    expect(evidenceSlides.every((slide) => Boolean(slide.dataCitation))).toBe(true);
    expect(evidenceSlides.some((slide) => slide.dataCitation?.includes("pipeline.xlsx") && slide.dataCitation.includes("Forecast"))).toBe(true);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pioltppt-data-"));
  temporaryDirectories.push(directory);
  return directory;
}

function dataFile(id: string, name: string, filePath: string, kind: "csv" | "xlsx"): DataFileInput {
  return { id, name, path: filePath, kind, source: "upload" };
}

function request(): DeckRequest {
  return {
    topic: "Revenue performance",
    title: "Revenue performance",
    presenters: [],
    audience: "executives",
    slideCount: 5,
    tone: "executive",
    brandStyle: "executive-clean",
    useSlackContext: false,
    useWebResearch: false,
    useLicensedImages: false,
    includeCitations: true,
    includeSpeakerNotes: true,
    includeVideoLinks: false
  };
}
