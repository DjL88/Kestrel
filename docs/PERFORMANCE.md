# Catalogue performance and saving (measured 15 November 2026)

## What was measured
A full save of one project record in Chromium's IndexedDB, with realistic photo records (decision, rating, tags, camera data, an edit with a brush mask and 20 history steps):

| Photos | Record size | One full save |
| --- | --- | --- |
| 500 | about 0.6 MB | about 3 ms |
| 2,000 | about 2.3 MB | about 11 ms |

The app saves the whole project on each state change. At these sizes that is cheap, so saves are **not** a bottleneck up to 2,000 photos on this machine. Not measured: Safari and iOS, slower disks, 10,000+ photos, thumbnail loading and grid rendering at 2,000 photos.

## What was tried and dropped
- **Batching saves** (wait until changes pause): cuts writes but opens a window where a change just before closing the page is lost. The page-close save did not reliably complete, so it was removed. Not worth the risk for an 11 ms save.
- **One long-lived database connection** for saves: made the "change then reload at once" case worse in testing, so it was reverted.

## Known weakness (not fixed)
A change made in the last few tens of milliseconds before the page is reloaded or closed may not be saved, because each save opens the database before it writes. This is existing behaviour. It matters most for the desktop app closing right after an edit. A proper fix would save from the page-hide event with a connection that is already open and a transaction started synchronously, and needs real-device testing (Safari behaves differently).

## Tests
`tests/save-on-change.spec.ts`: leaving a project straight after a change keeps the change.
