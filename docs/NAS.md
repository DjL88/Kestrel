# Connecting your own NAS

Kestrel can keep project backups, synced decisions and exported copies on a NAS (Synology, QNAP, TrueNAS, Unraid, a Raspberry Pi with Nextcloud, and others). There are three ways, easiest first. Menu names differ between NAS software versions, so use your NAS's own help for the exact clicks.

## 1. As a drive (easiest, works with any NAS)
Connect the NAS to your computer the usual way (Finder: Go, Connect to Server, `smb://nas-name/photos`; Windows: Map network drive). Then in Kestrel, **Where my work is kept, Add a connection, A folder**, and choose the mounted drive. This is also the best way to point Kestrel at the drive your originals are on.

- The drive must be connected when Kestrel looks. If it is not, the connection shows **Not found** and says so; your work stays safe on this device and a backup tries again later.
- In a web browser Kestrel has to be given access to the folder again after the page is closed. The desktop app remembers.

## 2. Directly over WebDAV (no mounting)
Most NAS boxes can serve a folder over WebDAV.
1. On the NAS, turn on its WebDAV service and note the address and port (commonly `https://nas-name:5006/photos` on Synology after installing WebDAV Server, and `https://nas-name:5001/photos` or similar on QNAP).
2. Make a **separate user** for Kestrel that can reach only the photo folder.
3. In Kestrel: **Add a connection, A NAS or server over WebDAV**, enter the address, user name and password, and choose **Test connection**.

Nextcloud or ownCloud: the address looks like `https://cloud.example.com/remote.php/dav/files/YOUR-USER/Photos`, and use an **app password** (Settings, Security) rather than your main password.

**Plain http** is accepted only for addresses on your own network (such as `http://192.168.1.20:5005/photos`). Anything on the internet must use https. If the NAS uses a self-signed certificate, the connection may be refused; use its http address at home, or give the NAS a proper certificate. Do not expose WebDAV to the internet without a VPN.

## 3. As S3 storage
A NAS running MinIO (or Synology's S3-compatible services) can be added as **My cloud storage (S3-compatible)**, with its address, a bucket name and an access key and secret key.

## What Kestrel writes
Only inside a `kestrel` folder (project backups, sync files), and, if you choose a place for **Also save exports to**, inside an `export` folder, each save in its own dated folder so nothing is overwritten. It never changes or deletes your photographs, and never touches anything else on the NAS.

## If it says...
- **Sign in again:** the user name or password was refused, or (if you did not choose to remember the password) Kestrel needs it again. Reconnect.
- **Offline:** the NAS is off, asleep, or not on this network.
- **Not found:** the folder or drive is not there. Mount it again, or choose it again.
