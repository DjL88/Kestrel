# lensfun lens profiles

`lensfun.txt` is a compacted copy of the [lensfun](https://github.com/lensfun/lensfun) lens database (`data/db/*.xml`),
licensed **Creative Commons Attribution-ShareAlike 3.0** (https://creativecommons.org/licenses/by-sa/3.0/). This file
is an adaptation of it and is under the same licence. Credit: "Lens profiles from the lensfun project
(lensfun.github.io), CC BY-SA 3.0".

Kestrel uses it only for photos whose files carry no lens corrections of their own (`src/lensfun.rs`).

## Rebuilding

Download the XML files from lensfun's `data/db/` folder into one folder, then:

```bash
python generate.py <that folder> > lensfun.txt
```

Built on 26 November 2026 from lensfun's `master` branch (54 database files, 1,236 lenses, 1,049 cameras).
What is kept and left out is described at the top of `generate.py`.
