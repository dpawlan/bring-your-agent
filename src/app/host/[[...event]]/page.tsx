import { HostApp } from "@/app/ui";
export default async function Page({
  params,
}: {
  params: Promise<{ event?: string[] }>;
}) {
  const p = await params;
  return <HostApp slug={p.event?.[0]} />;
}
