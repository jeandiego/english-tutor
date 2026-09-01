import { useQuery, useQueryClient } from "@tanstack/react-query";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { IconDatabaseExport, IconDatabaseImport, IconTrash } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { exportDatabase, getStorageInfo, importDatabase, wipeDatabase } from "../native/storage";
import { storageKeys } from "../queryKeys/storage";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function suggestedExportName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `pako-history-${stamp}.sqlite3`;
}

function StorageSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg" size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

export function StoragePage() {
  const queryClient = useQueryClient();
  const infoQuery = useQuery({
    queryKey: storageKeys.info(),
    queryFn: getStorageInfo,
  });

  const [wiping, setWiping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = wiping || exporting || importing;

  async function refreshAfterChange() {
    await queryClient.invalidateQueries();
  }

  async function handleWipe() {
    setError(null);
    setWiping(true);
    try {
      await wipeDatabase();
      await refreshAfterChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The learning history could not be wiped.");
    } finally {
      setWiping(false);
    }
  }

  async function handleExport() {
    setError(null);
    try {
      const destination = await save({
        defaultPath: suggestedExportName(),
        filters: [{ name: "SQLite database", extensions: ["sqlite3"] }],
      });
      if (!destination) return;
      setExporting(true);
      await exportDatabase(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The learning history could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  async function handlePickImportFile() {
    setError(null);
    try {
      const source = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite database", extensions: ["sqlite3", "db"] }],
      });
      if (!source || Array.isArray(source)) return;
      setPendingImportPath(source);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be opened.");
    }
  }

  async function handleConfirmImport() {
    if (!pendingImportPath) return;
    setError(null);
    setImporting(true);
    try {
      await importDatabase(pendingImportPath);
      await refreshAfterChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The learning history could not be imported.");
    } finally {
      setImporting(false);
      setPendingImportPath(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-caption text-destructive" role="alert">
          {error}
        </p>
      )}

      <StorageSection
        description="The full path and current size of your learning history database."
        title="Database file"
      >
        {infoQuery.isPending ? (
          <p className="text-body text-muted-foreground">Reading database info…</p>
        ) : infoQuery.isError ? (
          <p className="text-body text-destructive">Could not read database info.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-body font-medium text-foreground">
              {formatBytes(infoQuery.data.sizeBytes)}
            </p>
            <code className="block break-all text-caption text-muted-foreground">
              {infoQuery.data.path}
            </code>
          </div>
        )}
      </StorageSection>

      <StorageSection
        description="Save a full copy of your learning history to a file you choose."
        title="Export"
      >
        <Button
          className="w-fit"
          disabled={busy}
          onClick={() => void handleExport()}
          variant="outline"
        >
          <IconDatabaseExport />
          {exporting ? "Exporting…" : "Export database"}
        </Button>
      </StorageSection>

      <StorageSection
        description="Replace your current learning history with a previously exported backup. This overwrites everything currently stored."
        title="Import"
      >
        <AlertDialog
          onOpenChange={(open) => {
            if (!open) setPendingImportPath(null);
          }}
          open={pendingImportPath !== null}
        >
          <Button
            className="w-fit"
            disabled={busy}
            onClick={() => void handlePickImportFile()}
            variant="outline"
          >
            <IconDatabaseImport />
            {importing ? "Importing…" : "Import database"}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your learning history?</AlertDialogTitle>
              <AlertDialogDescription>
                Importing this file replaces all conversations, corrections, and
                progress currently stored with the contents of the backup. This
                can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleConfirmImport()}>
                Replace history
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </StorageSection>

      <StorageSection
        description="Permanently delete all conversations, corrections, and progress from this Mac. This can't be undone."
        title="Wipe"
      >
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button className="w-fit" disabled={busy} variant="destructive" />
            }
          >
            <IconTrash />
            {wiping ? "Wiping…" : "Wipe database"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Wipe your learning history?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every conversation, correction, and
                progress record stored on this Mac. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleWipe()} variant="destructive">
                Wipe everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </StorageSection>
    </div>
  );
}
