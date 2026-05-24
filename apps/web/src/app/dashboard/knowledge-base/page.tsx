import { BookOpenText, FileText, Globe2 } from "lucide-react";
import { CreateKnowledgeFileForm } from "@/components/dashboard/create-knowledge-file-form";
import { CreateKnowledgeTextForm } from "@/components/dashboard/create-knowledge-text-form";
import { CreateKnowledgeWebsiteForm } from "@/components/dashboard/create-knowledge-website-form";
import { EmptyPanel } from "@/components/dashboard/empty-panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getKnowledgeBase } from "@/lib/server-api";
import { formatDateTime } from "@/lib/format";

export default async function KnowledgeBasePage() {
  const { knowledgeBase, total } = await getKnowledgeBase();

  return (
    <div className="space-y-5">
      <section className="border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Knowledge Base</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {total} tenant-scoped source{total === 1 ? "" : "s"} available for retrieval.
          </p>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <CreateKnowledgeTextForm />
        <CreateKnowledgeFileForm />
        <CreateKnowledgeWebsiteForm />
      </section>

      {knowledgeBase.length === 0 ? (
        <EmptyPanel
          title="No knowledge sources indexed"
          actionLabel="Add source"
          icon={BookOpenText}
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {knowledgeBase.map((source) => {
            const SourceIcon = source.sourceType === "website" ? Globe2 : FileText;

            return (
              <Card key={source.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                      <SourceIcon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{source.title}</CardTitle>
                      <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">
                        {source.sourceUri ?? source.contentSha256 ?? source.sourceType}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={source.status} />
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Source Type</p>
                    <p className="mt-1 font-medium">{source.sourceType}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Chunks</p>
                    <p className="mt-1 font-medium">{source._count.embeddings}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--muted-foreground)]">Updated</p>
                    <p className="mt-1 font-medium">{formatDateTime(source.updatedAt)}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
