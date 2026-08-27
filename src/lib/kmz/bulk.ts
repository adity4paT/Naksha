/**
 * Turning a drop into a list of candidate files.
 *
 * Two shapes arrive: a multi-file selection, and a single .zip holding many
 * KMZs — which is how a batch of 130 boundaries actually gets emailed around.
 *
 * The distinction that matters here is that a .kmz IS a zip. Expanding by
 * content rather than by extension would tear every KMZ open and offer up its
 * doc.kml as a separate file. So the rule is by extension and deliberately so:
 * .zip is a container to open, .kmz is a document to keep whole.
 */

import JSZip from 'jszip';

/** One file ready to parse and store. */
export interface DroppedKmzFile {
  readonly filename: string;
  readonly blob: Blob;
  /** The .zip this came out of, or null when it was dropped directly. */
  readonly fromArchive: string | null;
}

/** A dropped item that was not a KMZ, KML, or zip. */
export interface SkippedDrop {
  readonly filename: string;
  readonly reason: string;
}

export interface ExpandResult {
  readonly files: readonly DroppedKmzFile[];
  readonly skipped: readonly SkippedDrop[];
}

const isGeoFile = (name: string): boolean => /\.(kmz|kml)$/i.test(name);
const isZip = (name: string): boolean => /\.zip$/i.test(name);

/**
 * Flatten a drop into individual KMZ/KML files.
 *
 * Zip entries are matched at any depth, because a batch archive routinely
 * carries its files inside a folder. Their basename is what matching later
 * sees, so a nested path does not stop a file from binding to its site.
 */
export async function expandDroppedFiles(
  dropped: readonly File[],
): Promise<ExpandResult> {
  const files: DroppedKmzFile[] = [];
  const skipped: SkippedDrop[] = [];

  for (const file of dropped) {
    if (isGeoFile(file.name)) {
      files.push({ filename: file.name, blob: file, fromArchive: null });
      continue;
    }

    if (!isZip(file.name)) {
      skipped.push({
        filename: file.name,
        reason: 'Not a .kmz, .kml, or .zip file.',
      });
      continue;
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch (error) {
      skipped.push({
        filename: file.name,
        reason: `The archive could not be opened: ${(error as Error).message}`,
      });
      continue;
    }

    const entries = Object.keys(zip.files).filter((name) => {
      const entry = zip.files[name];
      return entry !== undefined && !entry.dir && isGeoFile(name);
    });

    if (entries.length === 0) {
      skipped.push({
        filename: file.name,
        reason: 'The archive holds no .kmz or .kml files.',
      });
      continue;
    }

    for (const entryName of entries) {
      const entry = zip.file(entryName);
      if (entry === null) continue;
      files.push({
        filename: entryName.split('/').pop() ?? entryName,
        blob: await entry.async('blob'),
        fromArchive: file.name,
      });
    }
  }

  return { files, skipped };
}
