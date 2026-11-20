# Local recovery: both the device and the photograph source

Kestrel automatically saves reversible edits, decisions, keywords and project
metadata to its local catalogue after changes. Independently it writes rolling
`.kestrel.json` recovery snapshots to Kestrel's own private storage whenever
available (OPFS). On any device, if the photograph source can be written to,
Kestrel **also** saves the snapshot in the source's `kestrel/v1/project-backups/`
subfolder. A connected NAS on a phone is treated exactly like a writable source
on a desktop computer.

Sources with existing write permission: linked native photo folder, a browser
folder handle, or a configured 'Load from' connector such as WebDAV/NAS.
Automatic backup never requests new permission. A user-chosen separate backup
destination is an *additional* copy and does not replace device/source copies.

Snapshots are identified by project, timestamp and nonce, with up to 10 kept
per project at each reachable destination. A failed source write does not
prevent on-device recovery; it is reported and retried. Unavailable separate
device storage does not prevent saving to a writable source.

The file records the RAW processing-cache version but contains **no image data**
or underlying RAW/JPEG files. Locally cached developed previews are kept in
IndexedDB independently, reused on reopening the project and regenerated
after a processing version change. Export still reads original data for
full-resolution quality.

Private app storage is not an independent disaster-recovery backup: if the
app/browser data is erased or uninstalled, that copy can disappear. Folder
snapshots survive that operation only if the photo source remains accessible.
