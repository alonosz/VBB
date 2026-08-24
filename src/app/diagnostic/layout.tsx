import { DiagnosticProvider } from "@/context/DiagnosticContext";

export default function DiagnosticLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DiagnosticProvider>{children}</DiagnosticProvider>;
}
