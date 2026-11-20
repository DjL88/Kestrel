# Local project recovery

Kestrel saves decisions, captions, edit history and reversible adjustments in its
local catalogue as they change. A separate, rolling recovery copy is now saved
automatically even when the user has not configured a cloud or NAS connection.

- **Phone / tablet / browser file picker:** the backup stays in the app's
  private on-device storage (OPFS) when supported, never in the device photo
  library and never online. Browser/app data deletion may also delete this
  local recovery copy; for a truly independent backup, export a project backup.
- **Desktop linked photo folder:** if every original for the project comes
  from the same folder, a `kestrel/v1/project-backups/` directory is created
  inside it. At most ten dated `.kestrel.json` snapshots are kept per
  project. Originals are never overwritten or included.
- **Browser selected folder:** a recovery file is saved there only when write
  permission already exists. No automatic permission prompts; otherwise the
  private local directory is used.
- **Other devices/mixed source folders:** private device storage is used.
- **Explicit chosen backup destination:** the existing connected backup
  location still takes precedence.

The app retries failed writes. A backup is attempted after an edit (with
a five-minute minimum gap after a successful backup), on a periodic check and
when leaving the project. Photos, embedded JPEGs, developed previews, model
weights and other large data are not placed into the small recovery file.
The file records the RAW develop-cache version; the local thumbnail/developed
preview cache is checked separately when opening each photo. Export still reads
the original for full quality. Clearing the app's cache does not touch any
original or recovery file in a photo folder.

Restoring a backup validates the project and reconnects photo originals where
needed. Device-local recovery is *not* disaster-proof when the app itself is
uninstalled or its data is erased.
