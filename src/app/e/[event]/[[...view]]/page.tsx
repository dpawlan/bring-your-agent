import { EventApp } from "@/app/ui";
export default async function Page({
  params,
}: {
  params: Promise<{ event: string; view?: string[] }>;
}) {
  const p = await params;
  return <EventApp slug={p.event} view={p.view?.[0] || "landing"} />;
}
