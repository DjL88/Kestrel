# Build and install Kestrel from the source code

Until signed installers are published on the website, you can build the desktop app yourself from the latest `main`.
This makes the same optimised build the owner tests. Allow about an hour the first time (mostly downloads and the
first Rust compile) and 10–20 minutes after that. You need about **15 GB of free disk space** while it builds.

Unsigned builds show a warning the first time you open them (SmartScreen on Windows, "unidentified developer" on
macOS). That's expected until the apps are signed.

## Windows 10 or 11

### 1. Install the tools (once)

Open **PowerShell** and run these one at a time (they use Windows' own `winget`):

```powershell
winget install --id Git.Git -e
```

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

```powershell
winget install --id Rustlang.Rustup -e
```

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Close PowerShell and open it again, so it finds the new tools. Windows 11 already has WebView2, which Kestrel uses
to draw its window.

### 2. Get the code (once)

```powershell
git clone https://github.com/DjL88/Kestrel.git $HOME\Code\Kestrel
```

### 3. Build the installer

```powershell
cd $HOME\Code\Kestrel; powershell -ExecutionPolicy Bypass -File scripts\windows\Build-Kestrel.ps1
```

The script checks each tool and says what is missing, updates to the latest `main`, installs the packages, builds the
optimised app and opens the folder with the installer:
`src-tauri\target\release\bundle\nsis\Kestrel_<version>_x64-setup.exe`.

### 4. Install

Double-click the installer. If Windows says it protected your PC, choose **More info**, then **Run anyway**.

To update later, run step 3 again and install the new installer over the old one. Your projects are kept.

## macOS (Apple silicon or Intel)

### 1. Install the tools (once)

Open **Terminal** and run:

```bash
xcode-select --install
```

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

Install Node.js 22 (LTS) from https://nodejs.org, or with Homebrew: `brew install node@22`. Close and reopen Terminal.

### 2. Get the code (once)

```bash
git clone https://github.com/DjL88/Kestrel.git ~/Code/Kestrel
```

### 3. Build the app

```bash
cd ~/Code/Kestrel && git checkout main && git pull --ff-only && npm ci && npm run desktop:build
```

The app and disk image are in `src-tauri/target/release/bundle/`: `macos/Kestrel.app` and `dmg/Kestrel_<version>_<arch>.dmg`.

### 4. Install

Open the `.dmg` and drag **Kestrel** to **Applications**. The first time, right-click Kestrel in Applications,
choose **Open**, then **Open** again.

To update later, run step 3 again and replace the app in Applications. Your projects are kept.

## Check you have the right build

In Kestrel, **Settings → Build information** shows the source revision and build time. On two computers, compare it
before reporting that they behave differently; both should show the same revision from `main`.

## If something goes wrong

- **"out of memory" during the Rust build:** close other apps and run the build again; the Windows script retries
  with one compile job automatically.
- **Not enough disk space:** free at least 15 GB. The build folder `src-tauri/target` can be deleted safely; it is
  rebuilt next time (slower).
- **A tool is "not recognised":** close and reopen PowerShell or Terminal after installing it.
