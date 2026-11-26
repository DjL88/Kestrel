# Release test on Windows: external drive, relink, second device

A short hands-on check of the [PRODUCT-SPEC §7](PRODUCT-SPEC.md) scenario. CI already runs a scripted version on folders that stand in for drives (`src/v2/engineClient/releaseAcceptance.test.ts` and `tests/v2-release-relink.spec.ts`). These steps confirm the same behaviour on real Windows hardware, which CI cannot do. About 20 minutes.

**You need:** an optimised build of `main` on the Windows laptop (Settings → Build information shows the commit), a USB stick or external drive, a second device or a second Windows user account, and a few NEF + JPEG pairs you are happy to test with. Any camera's pairs will do. Nothing is uploaded, and your originals are never written.

Write PASS, FAIL or NOT RUN next to each step. If a step fails, a screenshot of the notice is the most useful thing to send.

## A. Import from the external drive

1. Copy a folder of RAW + JPEG pairs (for example `DCIM\100NIKON`) to the drive. Note its letter, for example `E:`.
2. In InFlight, choose **New project**, then **Import**, and pick the files on `E:`.
3. **Expect:** each NEF and its JPEG show as one photo marked **RAW + JPEG**. The photo count is the number of shots, not files.
4. Flag two photos, reject one, give one five stars and change its exposure.
5. In the top bar menu choose **Save backup file…** and save it to the laptop (not to the drive).

## B. Unplug the drive

6. Close InFlight. Eject and unplug the drive.
7. Open InFlight and the project.
8. **Expect:** every photo is still listed, with its flag, rating and edit. A selected photo says **Original not connected, preview only** and offers **Reconnect folder**. Nothing is deleted, and no other photo appears in its place.

## C. Reconnect safely, never to a same-named file

9. Make a folder on the laptop called `Wrong card`, and copy into it **one different photo renamed** to the same name as one of yours (for example rename any JPEG to `DSC_0001.JPG`).
10. Click **Reconnect folder** and choose `Wrong card`.
11. **Expect:** "No file in that folder matches a missing original, so nothing was linked." The photo still says it is not connected. (The harder case, a fake with the same name, size and date, is checked automatically in CI.)
12. Plug the drive back in. If you can, give it a different letter in Disk Management (for example `F:`). Otherwise just plug it into another port.
13. Click **Reconnect folder** and choose the drive (the root of `F:` is fine).
14. **Expect:** "Reconnected N photos. Their contents match the originals exactly." N is the number of files, so a pair counts as 2. The warning goes, full-size views and edits work, and every flag, rating and edit is as you left it.
15. Close and reopen InFlight. **Expect:** the photos open without asking again.

## D. A second device restores the project

16. On the second device (or a second Windows account), install the same build. Copy the backup file from step 5 across, and plug in the drive (any letter).
17. On the projects screen choose **Restore from backup…** and pick the backup file.
18. **Expect:** a project named "… (restored)" with every photo, pair, flag, rating and edit. If the drive has a different letter here, the originals show as not connected yet. If the letter is the same, they may connect straight away after their contents are checked; that is also a PASS.
19. If they are not connected, click **Reconnect folder** and choose the drive. **Expect:** every photo reconnects with the same message as step 14.
20. Check that the backup file is small: a few kilobytes per photo, not megabytes. It holds decisions and recipes only, never image bytes.

## What this does not cover yet

- 500 real Nikon Z8 and Z5II NEFs. The scripted test uses synthetic files, so speed with a full card is unmeasured.
- Cloud backup. The steps above use the backup file. Cloud backup uses the same project format, but the cloud transfer to a second device is not part of this check.
- Style profiles. The project backup carries the project's own settings. A separate style profile restore is not covered here.
- macOS. The code path is the same, but nobody has run these steps on the Mac.
