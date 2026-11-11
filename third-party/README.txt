Navio 0.6.0-beta.1 third-party materials

Client changes: https://github.com/poniard-li/Navio
Exact upstream source archives are separate release attachments listed in SOURCE-ARCHIVES.json, including three unmodified Mihomo core revisions. Their GPL license texts accompany this directory. The client LICENSE remains GPL-3.0.

Noto Color Emoji: Copyright 2022 Google Inc. The bundled font retains its embedded SIL OFL 1.1 attribution; NotoColorEmoji-NOTICE.txt explains the provenance boundary, and NotoColorEmoji-OFL.txt contains the full license.

Electron runtime: LICENSE.electron.txt and LICENSES.chromium.html are retained at the portable package root. Individual node_modules package licenses remain in the application archive from the pinned Clash Party runtime. The Windows runtime also includes unchanged upstream sysproxy, enableLoopback, 7-Zip, TrafficMonitor and Sub-Store components; their original notices/resources are retained. The upstream tool source projects are:
https://github.com/mihomo-party-org/clash-party
https://github.com/sub-store-org/Sub-Store
https://github.com/sub-store-org/sub-store-frontend
https://github.com/zhongyang219/TrafficMonitor
https://www.7-zip.org/license.txt
The downloaded current 7-Zip license is included as supplemental project documentation, not a statement that every third-party component is GPL or D.E.X-owned.

Geo databases are NOT bundled in the public portable archive:
ASN.mmdb, country.mmdb, geoip.dat, geoip.metadb, geosite.dat, BundleMRS.7z.
Old snapshots were not reproducibly pinned and included MaxMind-derived data. We do not represent current upstream licenses as proof of the historical snapshots' terms. On the External Resources page, users may explicitly download current databases over HTTPS from their saved geox-url settings. The defaults point to https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/ . The source project documents its aggregate inputs and terms at https://github.com/MetaCubeX/meta-rules-dat . Downloaded datasets remain subject to their own source terms and update requirements. They stay local and are not included in the client source archive. A database request does not upload subscription links or node credentials. Download failure does not enable the OS proxy; dependent rules may not start until current data is available.

Build boundary: the portable uses a hash-pinned upstream Electron runtime/native resources, not a full rebuild of every native dependency. See DEX-BUILD.txt and PINNED-RESOURCES.json. Public source contains neither D.E.X production server credentials nor user configurations.
