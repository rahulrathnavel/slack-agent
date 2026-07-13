import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import type { ChartSpec, DataFileInput, DeckPlan, DeckRequest, ResearchSource, SlidePlan } from "../types.js";

const MAX_ROWS_PER_SHEET = 5_000;
const MAX_SAMPLE_VALUES = 4;

export interface DataColumnProfile {
  name: string;
  kind: "number" | "date" | "text";
  missing: number;
  unique: number;
  samples: string[];
  sum?: number;
  average?: number;
  min?: number;
  max?: number;
}

export interface DataSetProfile {
  fileId: string;
  fileName: string;
  sheetName: string;
  rowCount: number;
  columnCount: number;
  columns: DataColumnProfile[];
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  source: "slack" | "upload";
  sourceUrl?: string;
}

export interface DataAnalysisResult {
  datasets: DataSetProfile[];
  sources: ResearchSource[];
}

export async function analyzeDataFiles(files: DataFileInput[]): Promise<DataAnalysisResult> {
  const datasets = (await Promise.all(files.map((file) => analyzeDataFile(file)))).flat();
  return {
    datasets,
    sources: datasets.map((dataset) => ({
      title: `${dataset.fileName} - ${dataset.sheetName}`,
      url: dataset.sourceUrl ?? `urn:pioltppt:upload:${encodeURIComponent(dataset.fileId)}`,
      snippet: `${dataset.rowCount.toLocaleString()} rows, ${dataset.columnCount} columns`,
      sourceType: "user" as const
    }))
  };
}

export async function analyzeDataFile(file: DataFileInput): Promise<DataSetProfile[]> {
  if (file.kind === "csv") {
    const text = await fs.readFile(file.path, "utf8");
    const parsedRecords = parse(text, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      to: MAX_ROWS_PER_SHEET + 1
    }) as Array<Record<string, unknown>>;
    const truncated = parsedRecords.length > MAX_ROWS_PER_SHEET;
    return [profileRecords(file, "CSV data", parsedRecords.slice(0, MAX_ROWS_PER_SHEET), truncated)];
  }

  const workbook = new ExcelJS.Workbook();
  const workbookData: unknown = await fs.readFile(file.path);
  await (workbook.xlsx.load as (data: unknown) => Promise<unknown>)(workbookData);
  const profiles: DataSetProfile[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: Array<Record<string, unknown>> = [];
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      headers[columnNumber - 1] = normaliseHeader(cell.value, columnNumber);
    });
    if (!headers.some(Boolean)) return;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || rows.length >= MAX_ROWS_PER_SHEET) return;
      const record: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        if (!header) return;
        const value = normaliseCell(row.getCell(index + 1).value);
        if (value !== undefined && value !== "") hasValue = true;
        record[header] = value;
      });
      if (hasValue) rows.push(record);
    });
    profiles.push(profileRecords(file, worksheet.name || "Sheet", rows, worksheet.actualRowCount - 1 > rows.length));
  });
  return profiles.length ? profiles : [profileRecords(file, "Workbook", [], false)];
}

export function createDataDeckPlan(request: DeckRequest, analysis: DataAnalysisResult): DeckPlan {
  const title = request.title || request.topic || dataTitle(analysis.datasets);
  const description = request.advancedPrompt || request.customContext || "A source-backed overview of the supplied data.";
  const dataSlides = analysis.datasets.map((dataset) => datasetSlide(dataset));
  const requestedContentSlides = Math.max(2, request.slideCount);
  const availableEvidenceSlides = Math.max(1, requestedContentSlides - 2);
  const needsDisclosureSlide = analysis.datasets.length > availableEvidenceSlides;
  const includedDatasetSlides = needsDisclosureSlide ? Math.max(0, availableEvidenceSlides - 1) : availableEvidenceSlides;
  const omittedDatasets = analysis.datasets.slice(includedDatasetSlides);
  const slides: SlidePlan[] = [
    {
      title,
      subtitle: description.slice(0, 180),
      layout: "title",
      bullets: [],
      speakerNotes: "Opening slide for the data story. Figures in following slides are computed directly from the uploaded source files."
    },
    overviewSlide(analysis.datasets),
    ...dataSlides.slice(0, includedDatasetSlides)
  ];

  if (omittedDatasets.length) {
    slides.push({
      title: "Additional Data Sources",
      layout: "bullets",
      bullets: omittedDatasets.map((dataset) => `${dataset.fileName} / ${dataset.sheetName}: ${dataset.rowCount.toLocaleString()} analyzed rows`),
      dataCitation: sourceListCitation(omittedDatasets),
      speakerNotes: "The selected content-slide limit prevents a dedicated chart for every table. These sources remain available as evidence."
    });
  }

  return {
    title,
    subtitle: "Evidence-backed insights from uploaded spreadsheet data",
    presenters: request.presenters,
    narrative: "Explain the data set, then show the strongest computed patterns with clear evidence.",
    slides,
    sources: analysis.sources,
    recommendedFollowups: [
      "Use the Data Studio to upload another file or select a different worksheet.",
      "Review chart assumptions and source citations before publishing.",
      "Ask PioltPPT to compare specific columns or a selected time range."
    ]
  };
}

function overviewSlide(datasets: DataSetProfile[]): SlidePlan {
  const totalRows = datasets.reduce((sum, dataset) => sum + dataset.rowCount, 0);
  const fileNames = [...new Set(datasets.map((dataset) => dataset.fileName))];
  return {
    title: "Data Overview",
    subtitle: `${fileNames.length} file${fileNames.length === 1 ? "" : "s"}, ${datasets.length} data table${datasets.length === 1 ? "" : "s"}, and ${totalRows.toLocaleString()} analysed rows`,
    layout: "bullets",
    bullets: datasets.slice(0, 5).map((dataset) => {
      const columns = dataset.columns.slice(0, 5).map((column) => column.name).join(", ");
      const samples = dataset.columns.slice(0, 3).flatMap((column) => column.samples.slice(0, 1).map((sample) => `${column.name}: ${sample}`)).join("; ");
      return `${dataset.fileName} / ${dataset.sheetName}: ${dataset.rowCount.toLocaleString()} rows, ${dataset.columnCount} columns (${columns}${dataset.columnCount > 5 ? ", ..." : ""})${samples ? `; examples: ${samples}` : ""}`;
    }),
    dataCitation: sourceListCitation(datasets),
    speakerNotes: "Data profile generated directly from headers and rows. Empty and unsupported values are not used in charts."
  };
}

function datasetSlide(dataset: DataSetProfile): SlidePlan {
  const chart = chooseChart(dataset);
  const numeric = dataset.columns.find((column) => column.kind === "number");
  const citation = sourceCitation(dataset);
  if (!chart) {
    return {
      title: `${dataset.sheetName} Overview`,
      subtitle: `${dataset.rowCount.toLocaleString()} rows across ${dataset.columnCount} columns`,
      layout: "bullets",
      bullets: dataset.columns.slice(0, 5).map((column) => columnSummary(column)),
      dataCitation: citation,
      speakerNotes: "No safe category-and-measure chart was identified, so this slide presents the column profile instead."
    };
  }

  const maxValue = Math.max(...chart.values);
  const topLabel = chart.labels[chart.values.indexOf(maxValue)] ?? "the leading category";
  return {
    title: `${dataset.sheetName}: ${chart.title}`,
    subtitle: numeric ? `${numeric.name} is shown across the strongest available groups.` : "Computed from the supplied data.",
    layout: "chart",
    bullets: [
      `${topLabel} is the largest displayed group at ${formatValue(maxValue)} ${chart.valueLabel}.`,
      `${(chart.sourceRowCount ?? dataset.rowCount).toLocaleString()} source rows contributed valid category and measure values to this chart.`,
      `Interpret this chart alongside the file context; it does not infer causation.`
    ],
    chart,
    dataCitation: sourceCitation(dataset, chart.sourceRowCount),
    speakerNotes: "Chart values are calculated from the uploaded file. Read the source citation before making a decision."
  };
}

function chooseChart(dataset: DataSetProfile): ChartSpec | undefined {
  const measure = dataset.columns.find((column) => column.kind === "number");
  const dimension = dataset.columns.find((column) => column.kind === "date") ?? dataset.columns.find((column) => column.kind === "text" && column.unique > 1 && column.unique <= 30);
  if (!measure || !dimension || !dataset.rows.length) return undefined;
  const grouped = new Map<string, number>();
  const groupedCounts = new Map<string, number>();
  for (const row of dataset.rows) {
    const rawDimension = row[dimension.name];
    const rawMeasure = toNumber(row[measure.name]);
    if (rawDimension === undefined || rawDimension === "" || rawMeasure === undefined) continue;
    const label = dimension.kind === "date" ? dateBucket(rawDimension) : String(rawDimension).trim();
    if (!label) continue;
    grouped.set(label, (grouped.get(label) ?? 0) + rawMeasure);
    groupedCounts.set(label, (groupedCounts.get(label) ?? 0) + 1);
  }
  const entries = [...grouped.entries()]
    .sort((a, b) => dimension.kind === "date" ? a[0].localeCompare(b[0]) : b[1] - a[1])
    .slice(0, 8);
  if (entries.length < 2) return undefined;
  return {
    type: dimension.kind === "date" ? "line" : "bar",
    title: `${measure.name} by ${dimension.name}`,
    labels: entries.map(([label]) => label),
    values: entries.map(([, value]) => Number(value.toFixed(2))),
    valueLabel: measure.name,
    sourceRowCount: entries.reduce((total, [label]) => total + (groupedCounts.get(label) ?? 0), 0)
  };
}

function profileRecords(file: DataFileInput, sheetName: string, records: Array<Record<string, unknown>>, truncated: boolean): DataSetProfile {
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))].filter(Boolean);
  const columns = names.map((name) => profileColumn(name, records));
  return {
    fileId: file.id,
    fileName: file.name,
    sheetName,
    rowCount: records.length,
    columnCount: names.length,
    columns,
    rows: records,
    truncated,
    source: file.source,
    sourceUrl: file.sourceUrl
  };
}

function profileColumn(name: string, rows: Array<Record<string, unknown>>): DataColumnProfile {
  const values = rows.map((row) => row[name]).filter((value) => value !== undefined && value !== null && value !== "");
  const numericValues = values.map(toNumber).filter((value): value is number => value !== undefined);
  const dateValues = values.map(toDate).filter((value): value is Date => value !== undefined);
  const kind = numericValues.length >= Math.max(2, values.length * 0.8) ? "number" : dateValues.length >= Math.max(2, values.length * 0.8) ? "date" : "text";
  const uniqueValues = new Set(values.map((value) => kind === "date" ? dateBucket(value) : String(value).trim()));
  const base: DataColumnProfile = {
    name,
    kind,
    missing: rows.length - values.length,
    unique: uniqueValues.size,
    samples: [...uniqueValues].slice(0, MAX_SAMPLE_VALUES)
  };
  if (kind === "number" && numericValues.length) {
    const sum = numericValues.reduce((total, value) => total + value, 0);
    return { ...base, sum, average: sum / numericValues.length, min: Math.min(...numericValues), max: Math.max(...numericValues) };
  }
  return base;
}

function normaliseHeader(value: ExcelJS.CellValue | undefined, index: number): string {
  const text = cellText(value).trim();
  return text || `Column ${index}`;
}

function normaliseCell(value: ExcelJS.CellValue | undefined): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && "result" in value && value.result !== undefined) return value.result as unknown;
  return cellText(value).trim();
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text ?? "");
  return String(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[,$₹%\s]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !/[-/]|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateBucket(value: unknown): string {
  const date = toDate(value);
  if (!date) return String(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function columnSummary(column: DataColumnProfile): string {
  if (column.kind === "number") {
    return `${column.name}: ${column.unique.toLocaleString()} unique values, total ${formatValue(column.sum ?? 0)}, average ${formatValue(column.average ?? 0)}`;
  }
  return `${column.name}: ${column.kind} field with ${column.unique.toLocaleString()} unique values; examples: ${column.samples.join(", ") || "none"}`;
}

function sourceCitation(dataset: DataSetProfile, contributingRows = dataset.rowCount): string {
  return `Source: ${dataset.fileName}, Sheet: ${dataset.sheetName}; analyzed ${contributingRows.toLocaleString()} contributing record${contributingRows === 1 ? "" : "s"}${dataset.truncated ? ` (file capped at ${MAX_ROWS_PER_SHEET.toLocaleString()} rows)` : ""}`;
}

function sourceListCitation(datasets: DataSetProfile[]): string {
  const citations = datasets.slice(0, 4).map((dataset) => `${dataset.fileName} / ${dataset.sheetName}`);
  return `Source${datasets.length === 1 ? "" : "s"}: ${citations.join("; ")}${datasets.length > citations.length ? `; +${datasets.length - citations.length} more` : ""}`;
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function dataTitle(datasets: DataSetProfile[]): string {
  const first = datasets[0];
  return first ? `${path.basename(first.fileName, path.extname(first.fileName))} Data Insights` : "Data Insights";
}
