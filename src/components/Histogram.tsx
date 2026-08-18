"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistogramBin } from "@/lib/scoring";

export function Histogram({ data }: { data: HistogramBin[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#eceeF7" />
        <XAxis
          dataKey="range"
          tick={{ fontSize: 11, fill: "#8688a0" }}
          axisLine={{ stroke: "#e4e6f0" }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: "#8688a0" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "#eeecff" }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #e4e6f0",
            fontSize: 12,
          }}
          labelFormatter={(label) => `Score ${label}`}
        />
        <Bar dataKey="count" fill="#5b4bfb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
