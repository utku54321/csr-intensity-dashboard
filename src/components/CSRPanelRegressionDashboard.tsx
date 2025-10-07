import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type DataRow = Record<string, string | number | null | undefined>;

type DescriptiveStat = {
  col: string;
  N: number;
  Mean: number;
  SD: number;
  Min: number;
  Q1: number;
  Median: number;
  Q3: number;
  Max: number;
};

type CorrelationResult = {
  cols: string[];
  corrMatrix: Record<string, Record<string, number>>;
};

const INCLUDED_VARIABLES = [
  "DebtEquity",
  "ROA",
  "ROE",
  "TobinQ",
  "Beta",
  "FirmRisk",
  "Tangibility",
  "SizeLog",
  "Growth",
  "AgeLog",
  "CSR_Expend",
];

const DEFAULT_CORRELATION: CorrelationResult = { cols: [], corrMatrix: {} };

const readAsBinaryString = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Unable to read file"));
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });

const numericColsFrom = (dataset: DataRow[]): string[] => {
  if (!dataset || dataset.length === 0) return [];
  const sample = dataset.find((row) => row && Object.keys(row).length > 0) ?? {};
  return Object.keys(sample).filter((col) => typeof sample[col] === "number" && !["Year", "CSR_pct_std"].includes(col));
};

const calculateDescriptiveStats = (dataset: DataRow[]): DescriptiveStat[] => {
  const numericCols = numericColsFrom(dataset);

  return numericCols.map((col) => {
    const values = dataset
      .map((row) => Number(row[col]))
      .filter((value) => !Number.isNaN(value));

    if (values.length === 0) {
      return { col, N: 0, Mean: 0, SD: 0, Min: 0, Q1: 0, Median: 0, Q3: 0, Max: 0 };
    }

    const N = values.length;
    const mean = values.reduce((acc, value) => acc + value, 0) / N;
    const sd = Math.sqrt(values.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / N);
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];

    return {
      col,
      N,
      Mean: mean,
      SD: sd,
      Min: sorted[0],
      Q1: percentile(0.25),
      Median: percentile(0.5),
      Q3: percentile(0.75),
      Max: sorted[sorted.length - 1],
    };
  });
};

const calculateCorrelation = (dataset: DataRow[]): CorrelationResult => {
  const numericCols = numericColsFrom(dataset);
  if (numericCols.length === 0) return DEFAULT_CORRELATION;

  const corrMatrix: Record<string, Record<string, number>> = {};

  numericCols.forEach((x) => {
    corrMatrix[x] = {};

    numericCols.forEach((y) => {
      const pairs = dataset
        .map((row) => [Number(row[x]), Number(row[y])] as const)
        .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));

      const n = pairs.length;
      if (n === 0) {
        corrMatrix[x][y] = 0;
        return;
      }

      const xs = pairs.map(([value]) => value);
      const ys = pairs.map(([, value]) => value);
      const meanX = xs.reduce((acc, value) => acc + value, 0) / n;
      const meanY = ys.reduce((acc, value) => acc + value, 0) / n;

      const numerator = xs.reduce((acc, value, index) => acc + (value - meanX) * (ys[index] - meanY), 0);
      const varianceX = xs.reduce((acc, value) => acc + Math.pow(value - meanX, 2), 0);
      const varianceY = ys.reduce((acc, value) => acc + Math.pow(value - meanY, 2), 0);
      const denominator = Math.sqrt(varianceX * varianceY);

      corrMatrix[x][y] = denominator === 0 ? 0 : numerator / denominator;
    });
  });

  return { cols: numericCols, corrMatrix };
};

const CSRPanelRegressionDashboard: React.FC = () => {
  const [data, setData] = useState<DataRow[]>([]);
  const [companyGroups, setCompanyGroups] = useState<Record<string, DataRow[]>>({});
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [showDesc, setShowDesc] = useState(true);
  const [showCorr, setShowCorr] = useState(true);

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const binaryString = await readAsBinaryString(file);
      const workbook = XLSX.read(binaryString, { type: "binary" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      let jsonData = XLSX.utils.sheet_to_json<DataRow>(worksheet, { defval: null });

      jsonData = jsonData.map((row) => {
        const cleaned: DataRow = {};

        Object.entries(row).forEach(([key, value]) => {
          if (!key || key.toLowerCase().includes("empty")) return;
          cleaned[key.trim()] = value;
        });

        return cleaned;
      });

      const grouped = jsonData.reduce<Record<string, DataRow[]>>((acc, row) => {
        const company = (row.Company ?? row.company ?? "Unknown") as string;
        if (!acc[company]) acc[company] = [];
        acc[company].push(row);
        return acc;
      }, {});

      setCompanyGroups(grouped);
      setData(jsonData);
      setSelectedCompany(Object.keys(grouped)[0] ?? "All Companies");
    } catch (error) {
      console.error("Failed to parse Excel file:", error);
    }
  };

  const selectedDataset = useMemo(() => {
    if (!selectedCompany) return [];
    if (selectedCompany === "All Companies") return data;
    return companyGroups[selectedCompany] ?? [];
  }, [data, companyGroups, selectedCompany]);

  const descriptiveStats = useMemo(
    () => (selectedDataset.length > 0 ? calculateDescriptiveStats(selectedDataset) : []),
    [selectedDataset],
  );

  const correlation = useMemo(
    () => (selectedDataset.length > 0 ? calculateCorrelation(selectedDataset) : DEFAULT_CORRELATION),
    [selectedDataset],
  );

  const renderCSRvsVariableCharts = (dataset: DataRow[]) => (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {INCLUDED_VARIABLES.map((variable) => (
        <Card key={variable} className="bg-slate-900 border-slate-700 p-4">
          <h4 className="mb-2 text-lg font-semibold text-white">CSR_pct_std vs {variable}</h4>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dataset}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="Year" stroke="#fff" />
              <YAxis stroke="#fff" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="CSR_pct_std" stroke="#22c55e" name="CSR % Std" dot={false} />
              <Line type="monotone" dataKey={variable} stroke="#60a5fa" name={variable} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      ))}
    </div>
  );

  const renderDataTable = (dataset: DataRow[]) => (
    <div className="max-h-96 overflow-auto rounded-lg border border-slate-700">
      <table className="min-w-full text-sm text-gray-100">
        <thead className="sticky top-0 bg-slate-800">
          <tr>
            {Object.keys(dataset[0] ?? {}).map((header) => (
              <th key={header} className="px-3 py-2 text-left whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.map((row, index) => (
            <tr key={index} className="border-b border-slate-700 hover:bg-slate-900">
              {Object.keys(dataset[0] ?? {}).map((header) => (
                <td key={header} className="px-3 py-1 whitespace-nowrap">
                  {row[header] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen space-y-6 bg-slate-950 p-6 text-gray-100">
      <h1 className="mb-2 text-3xl font-bold text-white">CSR Intensity Dashboard</h1>
      <p className="mb-4 text-sm text-gray-300">Upload Excel (.xlsx). All &quot;empty&quot; columns removed automatically.</p>
      <input type="file" accept=".xlsx" onChange={handleExcelUpload} className="mb-4" />

      {Object.keys(companyGroups).length > 0 && (
        <Card className="bg-slate-900 border-slate-700 p-6 text-white">
          <h2 className="mb-4 text-xl font-semibold">Select Company</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.keys(companyGroups).map((company) => (
              <Button
                key={company}
                onClick={() => setSelectedCompany(company)}
                className={`bg-white text-black hover:bg-gray-200 ${selectedCompany === company ? "ring-2 ring-lime-400" : ""}`}
              >
                {company}
              </Button>
            ))}
            <Button
              onClick={() => setSelectedCompany("All Companies")}
              className={`bg-yellow-200 text-black hover:bg-yellow-300 ${selectedCompany === "All Companies" ? "ring-2 ring-lime-400" : ""}`}
            >
              All Companies
            </Button>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setShowDesc((prev) => !prev)} className="bg-slate-700 text-white hover:bg-slate-600">
              {showDesc ? "Hide" : "Show"} Descriptive Stats
            </Button>
            <Button onClick={() => setShowCorr((prev) => !prev)} className="bg-slate-700 text-white hover:bg-slate-600">
              {showCorr ? "Hide" : "Show"} Correlations
            </Button>
          </div>
        </Card>
      )}

      {selectedCompany && (
        <Card className="bg-slate-900 border-slate-700 p-6">
          <h2 className="text-2xl font-semibold text-white">{selectedCompany} Data Overview</h2>
          {selectedDataset.length > 0 ? (
            <>
              {renderDataTable(selectedDataset)}

              <h3 className="mt-4 text-xl font-semibold">CSR vs Each Variable</h3>
              {renderCSRvsVariableCharts(selectedDataset)}

              {showDesc && (
                <div>
                  <h3 className="mt-4 mb-2 text-xl">Descriptive Statistics</h3>
                  <table className="w-full border-collapse text-sm text-gray-100">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-800">
                        <th className="px-2 py-1 text-left">Variable</th>
                        <th className="px-2 py-1 text-right">Mean</th>
                        <th className="px-2 py-1 text-right">SD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {descriptiveStats.map((stat) => (
                        <tr key={stat.col} className="border-b border-slate-700 hover:bg-slate-700">
                          <td className="px-2 py-1">{stat.col}</td>
                          <td className="px-2 py-1 text-right">{stat.Mean.toFixed(4)}</td>
                          <td className="px-2 py-1 text-right">{stat.SD.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {showCorr && correlation.cols.length > 0 && (
                <div>
                  <h3 className="mt-6 mb-2 text-xl">Correlation Matrix</h3>
                  <div className="overflow-auto">
                    <table className="min-w-max border-collapse text-xs text-gray-100">
                      <thead>
                        <tr className="border-b border-slate-700 bg-slate-800">
                          <th className="px-2 py-1 text-left">Variable</th>
                          {correlation.cols.map((col) => (
                            <th key={col} className="px-2 py-1 text-right">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {correlation.cols.map((row) => (
                          <tr key={row} className="border-b border-slate-700 hover:bg-slate-700">
                            <td className="px-2 py-1 font-medium">{row}</td>
                            {correlation.cols.map((col) => (
                              <td key={col} className="px-2 py-1 text-right">
                                {correlation.corrMatrix[row]?.[col]?.toFixed(2) ?? "0.00"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-300">No rows available for the selected company.</p>
          )}
        </Card>
      )}
    </div>
  );
};

export default CSRPanelRegressionDashboard;
